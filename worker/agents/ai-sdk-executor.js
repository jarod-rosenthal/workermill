#!/usr/bin/env node
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
let generateText, tool, stepCountIs, Output, anthropic, openai, google, createOpenAI, z;

async function loadDependencies() {
  try {
    const ai = await import('ai');
    generateText = ai.generateText;
    tool = ai.tool;
    stepCountIs = ai.stepCountIs;
    Output = ai.Output;

    // Import zod for schema definitions (works with Anthropic)
    const zod = await import('zod');
    z = zod.z;

    const anthropicSdk = await import('@ai-sdk/anthropic');
    anthropic = anthropicSdk.anthropic;

    const openaiSdk = await import('@ai-sdk/openai');
    openai = openaiSdk.openai;
    createOpenAI = openaiSdk.createOpenAI;

    const googleSdk = await import('@ai-sdk/google');
    google = googleSdk.google;
  } catch (err) {
    console.error('[AI SDK] Failed to load dependencies:', err.message);
    console.error('[AI SDK] Run: npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google zod');
    process.exit(1);
  }
}

// Using zod schemas for Anthropic compatibility (not jsonSchema)

// Import tools
const tools = require('./tools');

// ============================================================================
// Configuration
// ============================================================================

const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || '100', 10);
const WORKING_DIR = process.env.AGENT_WORKING_DIR || process.cwd();
const VERBOSE = process.env.AGENT_VERBOSE === 'true';

// Cost tracking metadata - used for future provider usage API reconciliation
const ORG_ID = process.env.ORG_ID || '';
const TASK_ID = process.env.TASK_ID || '';

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

// Provider icons (consistent with Settings.tsx)
const PROVIDER_ICONS = {
  anthropic: '🤖',
  openai: '🔷',
  google: '🔵',
  gemini: '🔵',
  ollama: '🏠',
};

// Persona configs for visibility (emoji lookup)
const PERSONA_CONFIGS = {
  frontend_developer: { emoji: '🎨' },
  backend_developer: { emoji: '⚙️' },
  devops_engineer: { emoji: '🔧' },
  security_engineer: { emoji: '🔒' },
  qa_engineer: { emoji: '🧪' },
  tech_writer: { emoji: '📝' },
  project_manager: { emoji: '📋' },
  api_developer: { emoji: '🔌' },
  database_administrator: { emoji: '🗄️' },
  ml_engineer: { emoji: '🧠' },
  mobile_developer_ios: { emoji: '📱' },
  mobile_developer_android: { emoji: '🤖' },
  data_engineer: { emoji: '📊' },
  manager: { emoji: '👔' },
  tech_lead: { emoji: '👨‍💼' },
};

/**
 * Get formatted log prefix for agent output
 * Format: [🧪 qa_engineer 🔵] for persona + provider visibility
 */
function getLogPrefix(persona, provider) {
  const personaConfig = PERSONA_CONFIGS[persona] || { emoji: '🤖' };
  const providerIcon = PROVIDER_ICONS[provider] || '🤖';
  return `[${personaConfig.emoji} ${persona} ${providerIcon}]`;
}

/**
 * Get short log prefix (without provider - for tool logs)
 */
function getShortPrefix(persona) {
  const personaConfig = PERSONA_CONFIGS[persona] || { emoji: '🤖' };
  return `[${personaConfig.emoji} ${persona}]`;
}

// Global log prefix (set during runAgent initialization)
let LOG_PREFIX = '[Agent]';

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Build provider-specific metadata for cost tracking and reconciliation.
 * This metadata is attached to API requests and can be correlated with
 * provider usage APIs for billing reconciliation.
 *
 * Format: "workermill:{orgId}:{taskId}"
 *
 * Anthropic: Set via experimental_providerMetadata.anthropic.metadata.user_id
 * OpenAI: Set via user parameter
 * Google: Set via experimental_providerMetadata (if supported)
 *
 * @param {string} provider - The AI provider name
 * @returns {object} Provider-specific options to merge into generateText call
 */
function buildCostTrackingMetadata(provider) {
  // Build the tracking ID: workermill:{orgId}:{taskId}
  const trackingId = `workermill:${ORG_ID}:${TASK_ID}`;

  // Skip if no org/task context
  if (!ORG_ID && !TASK_ID) {
    return {};
  }

  switch (provider) {
    case 'anthropic':
      // Anthropic: Use metadata.user_id field
      // Docs: https://docs.anthropic.com/en/docs/build-with-claude/usage-cost-api
      return {
        experimental_providerMetadata: {
          anthropic: {
            metadata: {
              user_id: trackingId,
            },
          },
        },
      };

    case 'openai':
      // OpenAI: Use user parameter
      // Docs: https://platform.openai.com/docs/api-reference/chat/create#user
      // Can be used with Usage API grouping by user_id
      return {
        experimental_providerMetadata: {
          openai: {
            user: trackingId,
          },
        },
      };

    case 'google':
    case 'gemini':
      // Google: No direct user tracking field, but we can add metadata
      // for potential future support
      return {
        experimental_providerMetadata: {
          google: {
            metadata: {
              user_id: trackingId,
            },
          },
        },
      };

    case 'ollama':
      // Ollama: Local execution, no billing, but add for consistency
      return {};

    default:
      return {};
  }
}

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
      // AI SDK expects GOOGLE_GENERATIVE_AI_API_KEY but we also accept GOOGLE_API_KEY
      const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!googleKey) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY environment variable is required');
      }
      // Set the expected env var if only GOOGLE_API_KEY was provided
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
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
 * Zod schemas work correctly with Anthropic's tool format
 */
function createTools() {
  return {
    bash: tool({
      description: 'Execute a shell command. Use for git operations, running scripts, installing packages, etc.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
      }),
      execute: async ({ command, timeout }) => {
        log(`[Tool:bash] ${command}`);
        const result = await tools.bash.execute({ command, timeout: timeout || 120000, cwd: WORKING_DIR });
        const output = result.success
          ? result.stdout || 'Command completed successfully'
          : `Error: ${result.error || result.stderr}`;
        log(`[Tool:bash] Exit code: ${result.exitCode}`);
        return output;
      },
    }),

    read_file: tool({
      description: 'Read the contents of a file. Returns the file content as text.',
      inputSchema: z.object({
        path: z.string().describe('Absolute or relative path to the file to read'),
      }),
      execute: async ({ path: filePath }) => {
        const fullPath = resolvePath(filePath);
        log(`[Tool:read_file] ${fullPath}`);
        const result = await tools.read_file.execute({ path: fullPath });
        return result.success ? result.content : `Error: ${result.error}`;
      },
    }),

    write_file: tool({
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      inputSchema: z.object({
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
      inputSchema: z.object({
        path: z.string().describe('Absolute or relative path to the file to edit'),
        old_string: z.string().describe('The exact text to find and replace'),
        new_string: z.string().describe('The text to replace it with'),
        replaceAll: z.boolean().optional().describe('If true, replace all occurrences'),
      }),
      execute: async ({ path: filePath, old_string, new_string, replaceAll }) => {
        const fullPath = resolvePath(filePath);
        log(`[Tool:edit_file] ${fullPath}`);
        const result = await tools.edit_file.execute({ path: fullPath, old_string, new_string, replaceAll: replaceAll || false });
        if (!result.success) {
          return `Error: ${result.error}${result.hint ? ` (${result.hint})` : ''}`;
        }
        return `Successfully edited ${fullPath}: ${result.replacements} replacement(s), ${result.linesDiff} lines`;
      },
    }),

    glob: tool({
      description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern to match (e.g., "**/*.js", "src/**/*.ts")'),
        path: z.string().optional().describe('Directory to search in (default: current working directory)'),
      }),
      execute: async ({ pattern, path: searchPath }) => {
        const baseDir = searchPath ? resolvePath(searchPath) : WORKING_DIR;
        log(`[Tool:glob] ${pattern} in ${baseDir}`);
        const result = await tools.glob.execute({ pattern, cwd: baseDir });
        if (!result.success) {
          return `Error: ${result.error}`;
        }
        if (!result.matches || result.matches.length === 0) {
          return 'No matching files found';
        }
        return `Found ${result.count} file(s):\n${result.matches.join('\n')}`;
      },
    }),

    grep: tool({
      description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
      inputSchema: z.object({
        pattern: z.string().describe('Regular expression pattern to search for'),
        path: z.string().optional().describe('File or directory to search in'),
        filePattern: z.string().optional().describe('File pattern to filter (e.g., "*.js", "*.ts")'),
        ignoreCase: z.boolean().optional().describe('Case-insensitive search'),
      }),
      execute: async ({ pattern, path: searchPath, filePattern, ignoreCase }) => {
        const targetPath = searchPath ? resolvePath(searchPath) : WORKING_DIR;
        log(`[Tool:grep] ${pattern} in ${targetPath}`);
        const result = await tools.grep.execute({ pattern, path: targetPath, filePattern: filePattern || '*', ignoreCase: ignoreCase || false });
        if (!result.success) {
          return `Error: ${result.error}`;
        }
        if (result.matchCount === 0) {
          return 'No matches found';
        }
        // Format results as readable output
        let output = `Found ${result.matchCount} match(es) in ${result.fileCount} file(s):\n`;
        for (const [file, matches] of Object.entries(result.results)) {
          for (const match of matches) {
            output += `${file}:${match.line}: ${match.content}\n`;
          }
        }
        return output;
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
  // Check for explicit system prompt from environment (used by inline-reviewer.ts)
  if (process.env.AGENT_SYSTEM_PROMPT) {
    return process.env.AGENT_SYSTEM_PROMPT;
  }

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
    manager: 'You are a Virtual Manager reviewing code and making decisions. Focus on code quality, security, and adherence to requirements.',
  };

  // Manager persona has specialized instructions
  if (persona === 'manager') {
    return `${personaDescriptions.manager}

TOOLS AVAILABLE:
- read_file: Read file contents
- bash: Run shell commands (gh pr diff, gh pr review, etc.)
- glob: Find files by pattern
- grep: Search file contents

EXECUTION RULES:
1. Read the instructions file provided via --prompt-file
2. Follow the review process exactly as described
3. Use 'gh pr diff' to review the PR changes
4. Use 'gh pr review' to submit your review to GitHub
5. Output decision markers in the required format

OUTPUT MARKERS (required):
- ::review_decision::approved OR ::review_decision::revision_needed OR ::review_decision::rejected
- ::code_quality_score::1-10
- ::feedback::Your detailed feedback here (single line, no newlines)

IMPORTANT: You MUST submit a review to GitHub using 'gh pr review' command AND output the decision markers.
`;
  }

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
 * Review schema for tech_lead and manager personas.
 * Uses Output.object() for guaranteed structured output (AI SDK 6.0+).
 */
function getReviewOutputSchema() {
  return Output.object({
    schema: z.object({
      decision: z.enum(['approved', 'revision_needed', 'rejected']).describe('The review decision'),
      codeQualityScore: z.number().min(1).max(10).describe('Code quality score from 1-10'),
      feedback: z.string().describe('Detailed feedback explaining the decision'),
    }),
    name: 'ReviewDecision',
    description: 'The code review decision with quality score and feedback',
  });
}

/**
 * Check if persona requires structured review output.
 */
function isReviewPersona(persona) {
  return persona === 'tech_lead' || persona === 'manager';
}

/**
 * Run the AI agent with the specified configuration
 */
async function runAgent(config) {
  const { provider, model: modelName, persona, prompt } = config;

  // Determine actual model to use
  const actualModel = modelName || PROVIDER_DEFAULT_MODELS[provider] || PROVIDER_DEFAULT_MODELS.anthropic;

  // Set global log prefix for this agent run
  LOG_PREFIX = getLogPrefix(persona, provider);
  const SHORT_PREFIX = getShortPrefix(persona);
  const providerIcon = PROVIDER_ICONS[provider] || '🤖';

  // Clean header output (Epic style)
  console.log(`${LOG_PREFIX} Starting agent execution`);
  console.log(`${LOG_PREFIX} Provider: ${provider} | Model: ${actualModel}`);

  // Create model instance
  const modelInstance = createModel(provider, actualModel);

  // Load persona directives
  let systemInstructions = await loadPersonaDirectives(persona);

  // OpenAI models don't naturally output reasoning between tool calls like Claude/Gemini
  // Add explicit instructions to encourage visible thinking
  if (provider === 'openai') {
    systemInstructions += `

## Important: Explain Your Reasoning
Before each tool call, briefly explain what you're about to do and why. This helps with debugging and transparency. For example:
- "I'll check the PR diff to understand the changes..."
- "Now I'll run the tests to verify the implementation..."
- "Looking at the code quality metrics..."

Always output your thinking as text before using tools.`;
  }

  // Create tools
  const agentTools = createTools();

  // Build cost tracking metadata for provider usage correlation
  const costTrackingMetadata = buildCostTrackingMetadata(provider);
  if (ORG_ID || TASK_ID) {
    console.log(`${LOG_PREFIX} Cost tracking: org=${ORG_ID} task=${TASK_ID}`);
  }

  // Track token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Check if this is a review persona that needs structured output
  const useStructuredOutput = isReviewPersona(persona);
  if (useStructuredOutput) {
    console.log(`${LOG_PREFIX} Using structured output for review decision`);
  }

  try {
    // Build generateText options
    const generateOptions = {
      model: modelInstance,
      system: systemInstructions,
      prompt: prompt,
      tools: agentTools,
      stopWhen: stepCountIs(MAX_STEPS),
      // Spread cost tracking metadata (provider-specific user/metadata fields)
      ...costTrackingMetadata,
      onStepFinish: async (event) => {
        // Log text output (full text for visibility)
        if (event.text) {
          const text = event.text.replace(/\n/g, ' ').trim();
          if (text) {
            console.log(`${LOG_PREFIX} ${text}`);
          }
        }

        // Track tool calls (Epic style - just tool name and brief summary)
        if (event.toolCalls) {
          for (const call of event.toolCalls) {
            const toolSummary = formatToolSummary(call.toolName, call.args);
            console.log(`${LOG_PREFIX} Tool: ${call.toolName}${toolSummary ? ` - ${toolSummary}` : ''}`);
          }
        }

        // Track tool results (minimal - just confirmation)
        if (event.toolResults) {
          for (const result of event.toolResults) {
            console.log(`${LOG_PREFIX} Tool result received`);
          }
        }

        // Track token usage
        if (event.usage) {
          totalInputTokens += event.usage.promptTokens || 0;
          totalOutputTokens += event.usage.completionTokens || 0;
        }
      },
    };

    // Add structured output for review personas (AI SDK 6.0+ Output.object)
    if (useStructuredOutput) {
      generateOptions.output = getReviewOutputSchema();
    }

    // Run the agent with stopWhen for autonomous execution (AI SDK 6.0+)
    const result = await generateText(generateOptions);

    // Output final result (Epic style - clean completion message)
    console.log(`${LOG_PREFIX} Agent execution completed`);

    if (result.text) {
      // Output full result text (no truncation)
      console.log(`${LOG_PREFIX} Result: ${result.text}`);
    }

    // Handle structured output for review personas
    if (useStructuredOutput && result.output) {
      // Emit structured review markers (guaranteed format from Output.object)
      console.log(`${LOG_PREFIX} Structured review output received`);
      console.log(`::review_decision::${result.output.decision}`);
      console.log(`::code_quality_score::${result.output.codeQualityScore}`);
      console.log(`::feedback::${result.output.feedback}`);

      // Also emit in the text marker format for compatibility
      console.log(`REVIEW_DECISION: ${result.output.decision}`);
      console.log(`CODE_QUALITY_SCORE: ${result.output.codeQualityScore}`);
      console.log(`FEEDBACK: ${result.output.feedback}`);
    } else {
      // Extract and output markers (for worker tasks)
      emitMarkers(result.text || '', actualModel);

      // For manager persona without structured output, try text parsing
      if (persona === 'manager') {
        emitManagerMarkers(result.text || '');
      }
    }

    // Output token usage (markers only, no verbose logging)
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      console.log(`${MARKERS.INPUT_TOKENS}${totalInputTokens}`);
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

/**
 * Extract and emit manager-specific markers (for Virtual Manager PR review)
 * These markers are used by manager-entrypoint.sh to report review decisions
 */
function emitManagerMarkers(content) {
  if (!content) return;

  // Review decision marker
  const decisionMatch = content.match(/::review_decision::(approved|revision_needed|rejected)/i);
  if (decisionMatch) {
    console.log(`::review_decision::${decisionMatch[1].toLowerCase()}`);
  }

  // Code quality score marker
  const scoreMatch = content.match(/::code_quality_score::(\d+)/);
  if (scoreMatch) {
    console.log(`::code_quality_score::${scoreMatch[1]}`);
  }

  // Feedback marker (capture to end of line)
  const feedbackMatch = content.match(/::feedback::([^\n]+)/);
  if (feedbackMatch) {
    console.log(`::feedback::${feedbackMatch[1]}`);
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
    console.log(`${LOG_PREFIX} [DEBUG] ${message}`);
  }
}

/**
 * Format a brief summary of tool arguments (Epic style)
 */
function formatToolSummary(toolName, args) {
  if (!args) return '';

  switch (toolName) {
    case 'bash':
      // Show the command being run
      return args.command ? args.command.substring(0, 80) : '';
    case 'read_file':
      return args.path || '';
    case 'write_file':
      return args.path || '';
    case 'edit_file':
      return args.path || '';
    case 'glob':
      return args.pattern || '';
    case 'grep':
      return args.pattern ? `"${args.pattern}"` : '';
    default:
      return '';
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
  # Using Anthropic Claude
  node ai-sdk-executor.js --provider anthropic --persona backend_developer --prompt "Fix the bug in auth.js"

  # Using OpenAI
  node ai-sdk-executor.js -p openai -m gpt-4o --persona qa_engineer "Write tests for api.js"

  # Using Ollama locally
  node ai-sdk-executor.js -p ollama -m qwen2.5-coder:32b "Refactor the database module"
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  // Load dependencies first
  await loadDependencies();

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
  getLogPrefix,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_ICONS,
  PERSONA_CONFIGS,
  MARKERS,
};

// Run if executed directly
if (require.main === module) {
  main();
}
