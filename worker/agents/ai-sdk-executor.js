***REMOVED***!/usr/bin/env node
/**
 * AI SDK Executor for WorkerMill Multi-Expert Mode
 *
 * Uses Vercel AI SDK to provide a unified interface for multiple AI providers.
 * Supports Anthropic, OpenAI, Google, and Ollama providers.
 *
 * Usage:
 *   node ai-sdk-executor.js --provider anthropic --model claude-haiku-4-5-20251001 --persona backend_developer --prompt-file /tmp/task.txt
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY   - For Anthropic provider
 *   OPENAI_API_KEY      - For OpenAI provider
 *   GOOGLE_API_KEY      - For Google/Gemini provider
 *   OLLAMA_HOST         - For Ollama provider (default: http://localhost:11434)
 */

const fs = require('fs');
const path = require('path');

// Import Vercel AI SDK and providers
let generateText, tool, anthropic, openai, google, createOpenAI;

async function loadDependencies() {
  try {
    const ai = await import('ai');
    generateText = ai.generateText;
    tool = ai.tool;

    const anthropicSdk = await import('@ai-sdk/anthropic');
    anthropic = anthropicSdk.anthropic;

    const openaiSdk = await import('@ai-sdk/openai');
    openai = openaiSdk.openai;
    createOpenAI = openaiSdk.createOpenAI;

    const googleSdk = await import('@ai-sdk/google');
    google = googleSdk.google;
  } catch (err) {
    console.error('[AI SDK] Failed to load dependencies:', err.message);
    console.error('[AI SDK] Run: npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google');
    process.exit(1);
  }
}

// Import zod for schema validation
let z;
async function loadZod() {
  try {
    const zodModule = await import('zod');
    z = zodModule.z;
  } catch (err) {
    console.error('[AI SDK] Failed to load zod:', err.message);
    process.exit(1);
  }
}

// Import tools
const tools = require('./tools');

// ============================================================================
// Configuration
// ============================================================================

const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || '100', 10);
const WORKING_DIR = process.env.AGENT_WORKING_DIR || process.cwd();
const VERBOSE = process.env.AGENT_VERBOSE === 'true';

// Output markers (compatible with WorkerMill worker system)
const MARKERS = {
  RESULT: '::result::',
  PR_URL: '::pr_url::',
  PR_NUMBER: '::pr_number::',
  BRANCH: '::branch::',
  INPUT_TOKENS: '::input_tokens::',
  OUTPUT_TOKENS: '::output_tokens::',
  MODEL: '::model::',
  ERROR: '::error::',
};

// Default models per provider
const PROVIDER_DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.1-codex',
  google: 'gemini-3-pro-preview',
  gemini: 'gemini-3-pro-preview',
  ollama: 'qwen2.5-coder:32b',
};

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create an AI SDK model instance for the given provider
 */
function createModel(provider, modelName) {
  switch (provider) {
    case 'anthropic': {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required');
      }
      return anthropic(modelName);
    }

    case 'openai': {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is required');
      }
      return openai(modelName);
    }

    case 'google':
    case 'gemini': {
      if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY environment variable is required');
      }
      return google(modelName);
    }

    case 'ollama': {
      const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
      // Use OpenAI-compatible API for Ollama
      const ollamaClient = createOpenAI({
        baseURL: `${ollamaHost}/v1`,
        apiKey: 'ollama', // Ollama doesn't require a real API key
      });
      return ollamaClient(modelName);
    }

    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, gemini, ollama`);
  }
}

// ============================================================================
// Tool Definitions for AI SDK
// ============================================================================

/**
 * Create AI SDK tool definitions with zod schemas
 */
function createTools() {
  return {
    bash: tool({
      description: 'Execute a shell command. Use for git operations, running scripts, installing packages, etc. Commands run in the working directory.',
      parameters: z.object({
        command: z.string().describe('The shell command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000, max: 600000)'),
      }),
      execute: async ({ command, timeout }) => {
        log(`[Tool:bash] ${command}`);
        const result = await tools.bash.execute({ command, timeout, cwd: WORKING_DIR });
        const output = result.success
          ? result.stdout || 'Command completed successfully'
          : `Error: ${result.error || result.stderr}`;
        log(`[Tool:bash] Exit code: ${result.exitCode}`);
        return output;
      },
    }),

    read_file: tool({
      description: 'Read the contents of a file. Returns the file content as text.',
      parameters: z.object({
        path: z.string().describe('Absolute or relative path to the file to read'),
        offset: z.number().optional().describe('Line number to start reading from (1-based)'),
        limit: z.number().optional().describe('Maximum number of lines to read'),
      }),
      execute: async ({ path: filePath, offset, limit }) => {
        const fullPath = resolvePath(filePath);
        log(`[Tool:read_file] ${fullPath}`);
        const result = await tools.read_file.execute({ path: fullPath, offset, limit });
        return result.success ? result.content : `Error: ${result.error}`;
      },
    }),

    write_file: tool({
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: z.object({
        path: z.string().describe('Absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file'),
      }),
      execute: async ({ path: filePath, content }) => {
        const fullPath = resolvePath(filePath);
        log(`[Tool:write_file] ${fullPath}`);
        const result = await tools.write_file.execute({ path: fullPath, content });
        return result.success ? `Successfully wrote ${content.length} bytes to ${fullPath}` : `Error: ${result.error}`;
      },
    }),

    edit_file: tool({
      description: 'Edit an existing file by replacing text. The old_string must match exactly (including whitespace).',
      parameters: z.object({
        path: z.string().describe('Absolute or relative path to the file to edit'),
        old_string: z.string().describe('The exact text to find and replace'),
        new_string: z.string().describe('The text to replace it with'),
        replace_all: z.boolean().optional().describe('If true, replace all occurrences'),
      }),
      execute: async ({ path: filePath, old_string, new_string, replace_all }) => {
        const fullPath = resolvePath(filePath);
        log(`[Tool:edit_file] ${fullPath}`);
        const result = await tools.edit_file.execute({ path: fullPath, old_string, new_string, replace_all });
        return result.success ? result.message : `Error: ${result.error}`;
      },
    }),

    glob: tool({
      description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match (e.g., "**/*.js", "src/**/*.ts")'),
        path: z.string().optional().describe('Directory to search in (default: current working directory)'),
      }),
      execute: async ({ pattern, path: searchPath }) => {
        const baseDir = searchPath ? resolvePath(searchPath) : WORKING_DIR;
        log(`[Tool:glob] ${pattern} in ${baseDir}`);
        const result = await tools.glob.execute({ pattern, path: baseDir });
        return result.success ? (result.files?.join('\n') || 'No matching files found') : `Error: ${result.error}`;
      },
    }),

    grep: tool({
      description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
      parameters: z.object({
        pattern: z.string().describe('Regular expression pattern to search for'),
        path: z.string().optional().describe('File or directory to search in'),
        include: z.string().optional().describe('File pattern to include (e.g., "*.js")'),
        ignore_case: z.boolean().optional().describe('Case-insensitive search'),
      }),
      execute: async ({ pattern, path: searchPath, include, ignore_case }) => {
        const targetPath = searchPath ? resolvePath(searchPath) : WORKING_DIR;
        log(`[Tool:grep] ${pattern} in ${targetPath}`);
        const result = await tools.grep.execute({ pattern, path: targetPath, include, ignore_case });
        return result.success ? (result.matches || 'No matches found') : `Error: ${result.error}`;
      },
    }),
  };
}

// ============================================================================
// Persona Directives
// ============================================================================

/**
 * Load persona-specific directives
 */
async function loadPersonaDirectives(persona) {
  const directivesDir = process.env.DIRECTIVES_DIR || '/app/directives';
  const personaDir = path.join(directivesDir, persona);

  let instructions = '';

  // Try to load persona-specific instructions
  const instructionFiles = ['INSTRUCTIONS.md', 'instructions.md', 'AGENTS.md'];
  for (const file of instructionFiles) {
    const filePath = path.join(personaDir, file);
    if (fs.existsSync(filePath)) {
      instructions += fs.readFileSync(filePath, 'utf-8') + '\n\n';
      break;
    }
  }

  // Load base AGENTS.md if exists
  const baseAgentsPath = path.join(directivesDir, '..', 'AGENTS.md');
  if (fs.existsSync(baseAgentsPath)) {
    instructions = fs.readFileSync(baseAgentsPath, 'utf-8') + '\n\n' + instructions;
  }

  // Default instructions if none found
  if (!instructions.trim()) {
    instructions = getDefaultInstructions(persona);
  }

  return instructions;
}

/**
 * Get default instructions for a persona
 */
function getDefaultInstructions(persona) {
  const personaDescriptions = {
    backend_developer: 'You are a backend developer expert. Focus on server-side code, APIs, databases, and system architecture.',
    frontend_developer: 'You are a frontend developer expert. Focus on UI/UX, React components, CSS, and user experience.',
    devops_engineer: 'You are a DevOps engineer. Focus on infrastructure, CI/CD, deployments, and system reliability.',
    security_engineer: 'You are a security engineer. Focus on security audits, vulnerability assessment, and secure coding practices.',
    qa_engineer: 'You are a QA engineer. Focus on testing, test automation, quality assurance, and bug detection.',
    tech_writer: 'You are a technical writer. Focus on documentation, README files, and technical communication.',
    project_manager: 'You are a project manager. Focus on planning, coordination, and project organization.',
  };

  return `${personaDescriptions[persona] || 'You are an autonomous coding agent.'}

TOOLS AVAILABLE:
- read_file: Read file contents
- edit_file: Edit existing files (old_string -> new_string)
- write_file: Create/overwrite files
- bash: Run shell commands (git, npm, node scripts, etc.)
- glob: Find files by pattern
- grep: Search file contents

EXECUTION RULES:
- Make one change at a time
- Verify changes work before moving on
- Use git to commit and push changes
- Output completion markers when done

OUTPUT MARKERS:
When you complete the task, output these markers:
- ::result::review_requested - PR created and needs human review
- ::result::deployed - Changes deployed successfully
- ::result::completed - Task completed without code changes
- ::result::failed - Task could not be completed
- ::pr_url::URL - The URL of any created PR
`;
}

// ============================================================================
// Main Agent Function
// ============================================================================

/**
 * Run the AI agent with the specified configuration
 */
async function runAgent(config) {
  const { provider, model: modelName, persona, prompt } = config;

  // Determine actual model to use
  const actualModel = modelName || PROVIDER_DEFAULT_MODELS[provider] || PROVIDER_DEFAULT_MODELS.anthropic;

  console.log(`\n${'='.repeat(60)}`);
  console.log('AI SDK Executor - Multi-Expert Mode');
  console.log(`Provider: ${provider} | Model: ${actualModel}`);
  console.log(`Persona: ${persona}`);
  console.log(`Working Directory: ${WORKING_DIR}`);
  console.log(`Max Steps: ${MAX_STEPS}`);
  console.log(`${'='.repeat(60)}\n`);

  // Create model instance
  const modelInstance = createModel(provider, actualModel);

  // Load persona directives
  const systemInstructions = await loadPersonaDirectives(persona);

  // Create tools
  const agentTools = createTools();

  // Track token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Run the agent with maxSteps for autonomous execution
    const result = await generateText({
      model: modelInstance,
      system: systemInstructions,
      prompt: prompt,
      tools: agentTools,
      maxSteps: MAX_STEPS,
      onStepFinish: async (event) => {
        // Log each step
        if (event.text) {
          console.log(`\n[Agent] ${event.text}\n`);
        }

        // Track tool calls
        if (event.toolCalls) {
          for (const call of event.toolCalls) {
            console.log(`[Tool Call] ${call.toolName}: ${JSON.stringify(call.args).substring(0, 200)}`);
          }
        }

        // Track tool results
        if (event.toolResults) {
          for (const result of event.toolResults) {
            const output = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
            console.log(`[Tool Result] ${result.toolName}: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`);
          }
        }

        // Track token usage
        if (event.usage) {
          totalInputTokens += event.usage.promptTokens || 0;
          totalOutputTokens += event.usage.completionTokens || 0;
        }
      },
    });

    // Output final result
    console.log('\n--- Agent Complete ---\n');

    if (result.text) {
      console.log(`\nFinal Output:\n${result.text}\n`);
    }

    // Extract and output markers
    emitMarkers(result.text || '', actualModel);

    // Output token usage
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      console.log(`\n${MARKERS.INPUT_TOKENS}${totalInputTokens}`);
      console.log(`${MARKERS.OUTPUT_TOKENS}${totalOutputTokens}`);
    }
    console.log(`${MARKERS.MODEL}${actualModel}`);

    return result;
  } catch (error) {
    console.error(`\n${MARKERS.ERROR}${error.message}`);
    console.error(error.stack);

    // Output failure marker
    console.log(`\n${MARKERS.RESULT}failed`);

    throw error;
  }
}

// ============================================================================
// Marker Extraction
// ============================================================================

/**
 * Extract and emit WorkerMill markers from agent output
 */
function emitMarkers(content, model) {
  if (!content) return;

  // Check for result markers
  const resultPatterns = [
    /::result::(\w+)/,
    /task\s+complete[d]?/i,
    /PR\s+(?:has\s+been\s+)?created/i,
    /no\s+changes\s+(?:needed|required)/i,
  ];

  let resultEmitted = false;

  // Explicit result marker
  const resultMatch = content.match(/::result::(\w+)/);
  if (resultMatch) {
    console.log(`\n${MARKERS.RESULT}${resultMatch[1]}`);
    resultEmitted = true;
  }

  // PR URL marker
  const prUrlMatch = content.match(/::pr_url::(https?:\/\/[^\s]+)/);
  if (prUrlMatch) {
    const prUrl = prUrlMatch[1].replace(/[\r\n].*$/, ''); // Clean up URL
    console.log(`\n${MARKERS.PR_URL}${prUrl}`);

    // Also extract PR number if present
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    if (prNumberMatch) {
      console.log(`${MARKERS.PR_NUMBER}${prNumberMatch[1]}`);
    }

    // If PR was created but no explicit result, assume review_requested
    if (!resultEmitted) {
      console.log(`${MARKERS.RESULT}review_requested`);
      resultEmitted = true;
    }
  }

  // Branch marker
  const branchMatch = content.match(/::branch::([^\s]+)/);
  if (branchMatch) {
    console.log(`\n${MARKERS.BRANCH}${branchMatch[1]}`);
  }

  // If no result emitted and content suggests completion, emit completed
  if (!resultEmitted) {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('task complete') || lowerContent.includes('no changes needed') || lowerContent.includes('no changes required')) {
      console.log(`\n${MARKERS.RESULT}completed`);
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Resolve a path relative to the working directory
 */
function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(WORKING_DIR, filePath);
}

/**
 * Log helper (respects VERBOSE flag)
 */
function log(message) {
  if (VERBOSE) {
    console.log(`[DEBUG] ${message}`);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const parsed = {
    provider: 'anthropic',
    model: null,
    persona: 'backend_developer',
    prompt: null,
    promptFile: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--provider':
      case '-p':
        parsed.provider = next;
        i++;
        break;
      case '--model':
      case '-m':
        parsed.model = next;
        i++;
        break;
      case '--persona':
        parsed.persona = next;
        i++;
        break;
      case '--prompt':
        parsed.prompt = next;
        i++;
        break;
      case '--prompt-file':
        parsed.promptFile = next;
        i++;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        if (!arg.startsWith('-') && !parsed.prompt) {
          parsed.prompt = arg;
        }
    }
  }

  // Load prompt from file if specified
  if (parsed.promptFile && !parsed.prompt) {
    try {
      parsed.prompt = fs.readFileSync(parsed.promptFile, 'utf-8').trim();
    } catch (err) {
      console.error(`Error reading prompt file: ${err.message}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
AI SDK Executor - Multi-Expert Mode for WorkerMill

USAGE:
  node ai-sdk-executor.js [OPTIONS] [PROMPT]

OPTIONS:
  --provider, -p <name>   AI provider (anthropic, openai, google, gemini, ollama)
  --model, -m <name>      Model name (defaults to provider's default)
  --persona <name>        Worker persona (backend_developer, frontend_developer, etc.)
  --prompt <text>         Task prompt
  --prompt-file <path>    Read prompt from file
  --help, -h              Show this help

DEFAULT MODELS:
  anthropic: claude-haiku-4-5-20251001
  openai: gpt-5.1-codex
  google/gemini: gemini-3-pro-preview
  ollama: qwen2.5-coder:32b

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY       API key for Anthropic
  OPENAI_API_KEY          API key for OpenAI
  GOOGLE_API_KEY          API key for Google/Gemini
  OLLAMA_HOST             Ollama server URL (default: http://localhost:11434)
  AGENT_MAX_STEPS         Max agent execution steps (default: 100)
  AGENT_VERBOSE           Enable verbose logging (true/false)
  AGENT_WORKING_DIR       Working directory for file operations

EXAMPLES:
  ***REMOVED*** Using Anthropic Claude
  node ai-sdk-executor.js --provider anthropic --persona backend_developer --prompt "Fix the bug in auth.js"

  ***REMOVED*** Using OpenAI
  node ai-sdk-executor.js -p openai -m gpt-4o --persona qa_engineer "Write tests for api.js"

  ***REMOVED*** Using Ollama locally
  node ai-sdk-executor.js -p ollama -m qwen2.5-coder:32b "Refactor the database module"
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  // Load dependencies first
  await loadDependencies();
  await loadZod();

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.prompt) {
    console.error('Error: No prompt provided. Use --prompt or --prompt-file.');
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  try {
    await runAgent({
      provider: args.provider,
      model: args.model,
      persona: args.persona,
      prompt: args.prompt,
    });
    process.exit(0);
  } catch (error) {
    console.error(`\n${MARKERS.ERROR}${error.message}`);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = {
  runAgent,
  createModel,
  createTools,
  loadPersonaDirectives,
  PROVIDER_DEFAULT_MODELS,
  MARKERS,
};

// Run if executed directly
if (require.main === module) {
  main();
}
