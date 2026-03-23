/**
 * Prompt Builder for Epic Mode
 *
 * Extracted from StoryExecutor — builds system prompts and story execution prompts.
 * Pure prompt construction with no side effects beyond logging and directive fetching.
 */

import type {
  ExpertPersona,
  ReadyStory,
  EpicConfig,
} from "./types.js";
import { getExpertConfig, COORDINATION_INSTRUCTIONS, LEARNING_INSTRUCTIONS } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { GitOps } from "./git-ops.js";
import { isDockerDaemonReachable } from "./gate-utils.js";
import { createRetryableApi } from "./api-retry.js";
import * as fs from "fs/promises";


/**
 * Load directive content from filesystem for a given persona (fallback).
 * Returns empty string if directive not found.
 */
async function loadDirectiveFromFile(persona: ExpertPersona): Promise<string> {
  const directivePath = `/app/directives/${persona}/README.md`;
  try {
    const content = await fs.readFile(directivePath, "utf-8");
    console.log(`[Epic] Loaded directive for ${persona} from file (${content.length} chars)`);
    return content;
  } catch {
    console.log(`[Epic] No directive found for ${persona}, using default prompt`);
    return "";
  }
}


/**
 * Prompt builder for Epic mode story execution.
 * Handles system prompt enrichment and full story prompt construction.
 */
export class PromptBuilder {
  private config: EpicConfig;
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private logsApi: ReturnType<typeof createRetryableApi>;

  // Cache for directive bundles (by persona slug)
  private directiveCache: Map<string, { readme: string | null; common: Record<string, string> } | null> = new Map();

  // Persona/provider icons loaded from Decision API
  personaIcons: Record<string, string> = {};
  providerIcons: Record<string, string> = {};

  // Server-side prompt templates loaded from Decision API
  serverCoordinationInstructions: string | null = null;
  serverLearningInstructions: string | null = null;

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    gitOps: GitOps,
    logsApi: ReturnType<typeof createRetryableApi>
  ) {
    this.config = config;
    this.coordination = coordination;
    this.gitOps = gitOps;
    this.logsApi = logsApi;
  }

  /**
   * Get formatted log prefix with persona emoji and provider icon.
   * Format: [🧪 qa_engineer 🤖] for persona + provider visibility
   */
  private getLogPrefix(expert: ExpertPersona, provider?: string): string {
    const emoji = this.personaIcons[expert] || "🤖";
    const effectiveProvider = provider || this.config.workerProvider || "anthropic";
    const providerIcon = this.providerIcons[effectiveProvider] || "🤖";
    return `[${emoji} ${expert} ${providerIcon}]`;
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   * This makes agent output visible in the task logs panel.
   */
  private async postLog(
    message: string,
    expert: ExpertPersona,
    type: "system" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = this.getLogPrefix(expert);

    // Also log to CloudWatch
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Load directive content for a persona.
   * Tries API first (supports org customizations), falls back to file system.
   * Also records directive usage for effectiveness tracking.
   */
  async loadDirective(persona: ExpertPersona): Promise<string> {
    // Check cache first
    if (this.directiveCache.has(persona)) {
      const cached = this.directiveCache.get(persona);
      return cached?.readme || "";
    }

    // Try API first
    try {
      const response = await this.logsApi.get<{ directives?: { readme?: string | null; common?: Record<string, string>; readmeMeta?: { id: string; version: number } | null; commonMeta?: Record<string, { id: string; version: number }> } }>(`/api/personas/worker/${persona}/bundle`);
      const bundle = response.data;

      const directives = bundle?.directives;
      if (directives && (directives.readme || Object.keys(directives.common || {}).length > 0)) {
        console.log(`[Epic] Loaded directive for ${persona} from API`);
        const cacheEntry = { readme: directives.readme ?? null, common: directives.common ?? {} };
        this.directiveCache.set(persona, cacheEntry);

        // Record directive usage for effectiveness tracking
        await this.recordDirectiveUsage(persona, directives);

        return directives.readme || "";
      }
    } catch {
      // API doesn't have directives, fall back to file system
    }

    // Fall back to file system
    this.directiveCache.set(persona, null);
    return loadDirectiveFromFile(persona);
  }

  /**
   * Record which directives were used for this task.
   * This data is used to track directive effectiveness over time.
   */
  async recordDirectiveUsage(
    persona: ExpertPersona,
    directives: {
      readme?: string | null;
      readmeMeta?: { id: string; version: number } | null;
      common?: Record<string, string>;
      commonMeta?: Record<string, { id: string; version: number }>;
    }
  ): Promise<void> {
    try {
      const usageRecords: Array<{
        directiveId: string;
        version: number;
        type: "readme" | "common";
        filename?: string;
        personaSlug: string;
      }> = [];

      // Add readme directive if present
      if (directives.readmeMeta?.id) {
        usageRecords.push({
          directiveId: directives.readmeMeta.id,
          version: directives.readmeMeta.version,
          type: "readme",
          personaSlug: persona,
        });
      }

      // Add common directives if present
      if (directives.commonMeta) {
        for (const [filename, meta] of Object.entries(directives.commonMeta)) {
          if (meta?.id) {
            usageRecords.push({
              directiveId: meta.id,
              version: meta.version,
              type: "common",
              filename,
              personaSlug: persona,
            });
          }
        }
      }

      if (usageRecords.length > 0) {
        await this.logsApi.post("/api/directives/usage", {
          taskId: this.config.parentTaskId,
          directives: usageRecords,
        });
        console.log(`[Epic] Recorded ${usageRecords.length} directive(s) usage for ${persona}`);
      }
    } catch (error) {
      // Don't fail the task if directive tracking fails
      console.warn(`[Epic] Failed to record directive usage: ${error}`);
    }
  }

  /**
   * Build enriched system prompt for an expert.
   * Layers:
   * 1. Core identity (from experts.ts systemPrompt)
   * 2. Domain expertise (loaded from directives/{persona}/README.md)
   * 3. Coordination protocol (only if multi-story task)
   */
  async buildEnrichedSystemPrompt(
    expert: ExpertPersona,
    totalStories: number
  ): Promise<string> {
    const expertConfig = getExpertConfig(expert);
    let prompt = expertConfig.systemPrompt;

    // Load domain expertise from directive
    const directive = await this.loadDirective(expert);
    if (directive) {
      prompt += "\n\n## Domain Expertise\n\n" + directive;
    }

    // Inject org-level AI guidelines (intent engineering)
    if (this.config.orgGuidelines) {
      prompt += `\n\n## Organization Guidelines\n\nThe following guidelines are set by this organization and take precedence over general best practices. Treat these as hard constraints, not suggestions:\n\n${this.config.orgGuidelines}`;
    }

    // Only add coordination instructions for multi-story tasks (saves ~1K tokens for single-story)
    if (totalStories > 1) {
      prompt += this.serverCoordinationInstructions ?? COORDINATION_INSTRUCTIONS;
    } else {
      console.log(`[Epic] Skipping coordination instructions for single-story task`);
    }

    // Always add learning instructions so experts can report discoveries
    prompt += this.serverLearningInstructions ?? LEARNING_INSTRUCTIONS;

    // Communication tone — keep status updates professional and direct
    prompt += `

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative.

When summarizing your work at the end, describe decisions in plain language. The internal DEC-xxx markers are parsed by the system automatically — your summary should restate decisions in readable form. For example, instead of repeating "DEC-001: Created repository-level config", write "Decision 1: Created a repository-level configuration file for..." with enough context for a non-technical reader to understand.`;

    // Docker environment — ALWAYS include instructions.
    // Even if `docker info` fails at startup (e.g., socket permission race, native mode),
    // the Claude agent may be able to use Docker at runtime, and the instructions
    // serve as a strong signal to prefer real services over mocks.
    const dockerAvailable = isDockerDaemonReachable();
    if (!dockerAvailable) {
      console.log("[Epic] Docker daemon not reachable at startup — Docker instructions still included in prompt");
    }
    prompt += `

## Development Environment (MANDATORY)

You have \`docker\` and \`docker compose\` available. **You MUST spin up real service dependencies** (databases, caches, message queues, etc.) using Docker containers before writing any application code that depends on them. Do NOT mock or stub external services — connect to real instances running in Docker.

### Required Workflow
1. **Before writing application code**: Start all required service containers
2. **Configure your code** to connect to \`localhost\` on the container ports. The worker uses host networking, so Docker services are reachable at localhost.
3. **Run tests against real services** — integration tests must hit real databases, not mocks
4. **Clean up containers** when you're done (\`docker stop <name>\`)

### Common Services
- MongoDB: \`docker run -d --rm -p 27017:27017 --name mongo-test mongo:7\`
- Redis: \`docker run -d --rm -p 6379:6379 --name redis-test redis:7-alpine\`
- PostgreSQL: \`docker run -d --rm -p 5432:5432 -e POSTGRES_PASSWORD=test --name postgres-test postgres:16-alpine\`
- MySQL: \`docker run -d --rm -p 3306:3306 -e MYSQL_ROOT_PASSWORD=test --name mysql-test mysql:8\`
- RabbitMQ: \`docker run -d --rm -p 5672:5672 --name rabbitmq-test rabbitmq:3-alpine\`
- If the project has a \`docker-compose.yml\`, use \`docker compose up -d\`
- Connect to services at \`localhost\` on the mapped ports. For example: \`postgresql://user:pass@localhost:5432/db\`

### Why This Matters
Mocking produces code full of assumptions and interface mismatches that break on first contact with real services. Real containers catch connection strings, schema mismatches, query errors, and serialization bugs immediately — not after deployment. **Tests that pass against mocks but fail against real services are worthless.**

### If Docker Is Not Working
If \`docker\` commands fail, DO NOT fall back to mocking. Instead:
1. Report the Docker error as a blocker
2. If the quality gate commands include env vars like MONGODB_URI or REDIS_URL, the test infrastructure expects REAL services
3. Never write test stubs or mock implementations as a workaround — the quality gates will catch and reject them

### CI/CD Workflows Must Include Service Containers
When creating GitHub Actions CI workflows that run tests requiring databases or other services, you **MUST** add \`services:\` blocks so the CI runner has real service instances. Example for PostgreSQL:
\`\`\`yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
\`\`\`
The same pattern applies to Redis, MongoDB, MySQL, etc. **Tests that pass locally with Docker but fail in CI because there's no database are a waste of CI fix cycles.** Always match your local Docker setup with CI service containers.`;

    // Version trust instruction — generic, not hardcoded to any specific version
    prompt += `

## ⚠️ Technology Versions — Trust the Spec

**If the ticket, PRD, or task description specifies a dependency version, USE THAT VERSION.** Do NOT downgrade or "fix" versions you don't recognize — your training data has a cutoff and newer releases exist. Trust the spec over your knowledge.`;

    return prompt;
  }

  /**
   * Extract acceptance criteria from story description.
   * Looks for GIVEN/WHEN/THEN format or bullet points.
   */
  extractAcceptanceCriteria(description: string): string[] {
    const criteria: string[] = [];

    // Look for GIVEN/WHEN/THEN blocks
    const gwtPattern = /(?:GIVEN|WHEN|THEN|AND)[:\s]+([^\n]+)/gi;
    let match;
    while ((match = gwtPattern.exec(description)) !== null) {
      criteria.push(match[1].trim());
    }

    // If no GWT found, look for bullet points
    if (criteria.length === 0) {
      const bulletPattern = /^[\s]*[-*•]\s+(.+)$/gm;
      while ((match = bulletPattern.exec(description)) !== null) {
        criteria.push(match[1].trim());
      }
    }

    // If still nothing, use the whole description as a single criterion
    if (criteria.length === 0 && description.trim()) {
      criteria.push(description.trim());
    }

    return criteria;
  }

  /**
   * Build the prompt for story execution with worktree path.
   */
  async buildPromptWithWorktree(
    story: ReadyStory,
    expert: ExpertPersona,
    worktreePath: string,
    userFeedback?: string,
    dependencyMergeContext?: string,
    mergedSiblingFiles?: string[]
  ): Promise<string> {
    return this.buildPrompt(story, expert, userFeedback, worktreePath, dependencyMergeContext, mergedSiblingFiles);
  }

  /**
   * Build the prompt for story execution.
   * Includes pending questions, Q&A history, sibling context, and user feedback.
   * @param repoPathOverride - Optional worktree path to use instead of main repo path
   */
  async buildPrompt(
    story: ReadyStory,
    expert: ExpertPersona,
    userFeedback?: string,
    repoPathOverride?: string,
    dependencyMergeContext?: string,
    mergedSiblingFiles?: string[]
  ): Promise<string> {
    // Get constraints
    const constraints = await this.coordination.getConstraints();
    const constraintsText = constraints
      .map((c) => "- " + c.content)
      .join("\n");

    // Build file scope guidance from targetFiles
    let fileScopeConstraint = "";
    if (story.targetFiles && story.targetFiles.length > 0) {
      fileScopeConstraint = [
        "",
        "📋 TARGET FILES — These are the files planned for this story:",
        ...story.targetFiles.map((f) => `  - ${f}`),
        "",
        "Focus your work on these files. These are the files assigned to your scope by the planner.",
        "If the ticket requirements clearly need additional files not listed here, you may create them.",
        "",
        "**Fixing issues outside your target files:**",
        "You MAY fix formatting, lint, and import errors in files outside your target list if they block",
        "your quality gates. These are mechanical fixes (missing imports, unused variables, formatting).",
        "",
        "You MUST NOT change behavior, return codes, business logic, API contracts, or fix bugs in files",
        "outside your target list. If a sibling story's code has a behavioral bug (wrong status code,",
        "missing route registration, broken logic), post Q-BLOCKING-BUG with a description of the issue.",
        "Do NOT fix it yourself — the owning expert must address it to avoid merge conflicts.",
        "",
        "Only ask Q-BLOCKING-SCOPE if you're unsure whether a LARGE architectural change outside your",
        "scope is the right approach (e.g., restructuring a shared module, changing a database schema).",
      ].join("\n");
    }

    // Get sibling decisions
    const decisions = await this.coordination.getSiblingDecisions();
    const decisionsText = decisions
      .map((d) => "- [" + d.persona + "] " + d.content)
      .join("\n");

    // Get file changes from siblings
    const fileChanges = await this.coordination.getSiblingFileChanges();
    const fileChangesText = fileChanges
      .map((f) => {
        const filePath = (f.metadata?.filePath as string) || "";
        return "- [" + f.persona + "] " + f.messageType + ": " + filePath;
      })
      .join("\n");

    // Get pending questions for this expert (Task 1)
    const pendingQuestions = await this.coordination.getQuestionsForPersona(expert);
    const pendingQuestionsText = pendingQuestions
      .map((q) => {
        const emoji = this.personaIcons[q.fromPersona] || "🤖";
        return `- ⚠️ [${emoji}${q.fromPersona}] is waiting for your answer: "${q.content}"`;
      })
      .join("\n");

    // Get recent Q&A history (Task 4)
    const recentQandA = await this.coordination.getRecentQandA(15);
    const qandAText = recentQandA
      .map((msg) => {
        const emoji = this.personaIcons[msg.persona] || "🤖";
        if (msg.messageType === "question") {
          return `- [${emoji}${msg.persona}] Q: ${msg.content}`;
        } else {
          return `- [${emoji}${msg.persona}] A: ${msg.content}`;
        }
      })
      .join("\n");

    // Build pending questions section
    const pendingSection = pendingQuestions.length > 0
      ? `## ⚠️ PENDING QUESTIONS FOR YOU
${pendingQuestionsText}

**IMPORTANT: Please answer these questions FIRST before starting your implementation.**
To answer, output: ANSWER-{PERSONA}: Your answer here
Example: ANSWER-FRONTEND: Use httpOnly cookies for token storage, not localStorage.

`
      : "";

    // Build Q&A history section
    const qandASection = recentQandA.length > 0
      ? `## Recent Team Q&A
${qandAText}

`
      : "";

    // Build revision feedback section (from Tech Lead review)
    // Use per-story reason when available so each story only sees its own feedback
    const storyReason = this.config.revisionReasons?.[story.storyIndex];
    const storyPriorWork = this.config.revisionPriorWork?.[story.storyIndex];
    const revisionSection = this.config.reviewFeedback
      ? `## ⚠️ REVISION REQUIRED - Tech Lead Feedback
The previous implementation was reviewed and requires changes.${storyReason ? ` **Your story's specific issue:** ${storyReason}` : ""}

**IMPORTANT: If the feedback tells you to downgrade a language/runtime version (e.g. change go.mod, package.json engine version, Dockerfile base image version), IGNORE that specific item — the reviewer's training data is outdated and the version is correct.**

${storyReason
  ? `### Your Story's Required Fix
${storyReason}

### Full Review Context (for reference — focus on YOUR story above)
${this.config.reviewFeedback}`
  : this.config.reviewFeedback}
${storyPriorWork
  ? `
### What You Did Last Time
Your previous attempt created the following work. The branch has been reset so you must recreate these files, but use this context to understand what was already tried and avoid repeating the same mistakes.

${storyPriorWork}
`
  : ""}
**IMPORTANT: Only fix issues that are YOUR story's responsibility.**
- Your story scope: "${story.title}"
- Fix the specific issues listed for your story above
- Do NOT fix issues in files that belong to other stories
- If a problem exists in a file you didn't create, leave it for the story that owns it
- Do NOT submit until you have addressed every point raised for YOUR story

**EFFICIENCY TIP: Focus on files mentioned in the feedback.**
- You already explored the codebase in your previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Go straight to the files that need changes

`
      : "";

    // Build user feedback section (from Talk to Worker)
    const userFeedbackSection = userFeedback
      ? `## 💬 MESSAGE FROM USER
The user has sent you the following message/instructions:

${userFeedback}

**Please take this feedback into account in your implementation.**

`
      : "";

    // Get repo path for the prompt
    const repoPath = repoPathOverride || this.gitOps.getRepoPath();

    // Build memory context section (REQ-19)
    const memorySection = this.config.memoryContext
      ? `## Memory Context (from past experiences)
${this.config.memoryContext}
`
      : "";

    // Build code context section (Codebase RAG)
    const codeSection = this.config.codeContext
      ? `## Relevant Code from This Repository
${this.config.codeContext}
`
      : "";

    // Build prior work context section (retry scenarios)
    const priorWorkSection = this.config.priorWorkContext || "";

    // Include original ticket requirements — THIS IS THE SPEC, not a reference
    const ticketRequirementsSection = this.config.jiraRequirements
      ? `## Ticket Requirements — THIS IS YOUR SPEC${this.config.ticketUrl ? ` ([source](${this.config.ticketUrl}))` : ""}
${this.config.jiraRequirements}

`
      : "";

    // Dependency merge issues section (conflicts/errors from mergeDependencyBranches)
    const mergeIssuesSection = dependencyMergeContext || "";

    // Sibling files warning — files from other stories merged into this worktree
    const siblingFilesSection = mergedSiblingFiles && mergedSiblingFiles.length > 0
      ? `## ⛔ DO NOT DELETE — Files From Sibling Stories
The following files were created by OTHER stories and merged into your worktree for compatibility.
They are NOT part of your story. You MUST NOT delete, rename, or overwrite them.
If you need to make small fixes to these files (e.g., fixing imports, lint errors, type errors)
to unblock your own work, go ahead — the integration fixer handles merge conflicts.
Only ask Q-BLOCKING-SCOPE for large structural changes to sibling files.

${mergedSiblingFiles.map((f) => `- ${f}`).join("\n")}

`
      : "";

    return `# ${story.title}

${userFeedbackSection}${revisionSection}${priorWorkSection}${ticketRequirementsSection}${memorySection}${codeSection}## Your File Scope
${story.description}

**The ticket requirements above are your ONLY spec. This scope identifies which files and area of the codebase you are responsible for. Do NOT invent requirements beyond what the ticket states.**

${pendingSection}## Constraints
${(constraintsText + fileScopeConstraint) || "None specified"}

## Sibling Decisions
${decisionsText || "No decisions yet"}

## Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${mergeIssuesSection}${siblingFilesSection}${qandASection}## Your Task
The ticket above is your ONLY spec. Your file scope tells you which area to focus on.
Implement the ticket requirements within your scope, following constraints and coordinating with sibling decisions.
If a sibling's work looks wrong based on the ticket, flag it with a Q-BLOCKING message.

### 🚨 NEVER Downgrade Language/Runtime Versions
Your training data is outdated — newer versions of every language and runtime exist beyond your cutoff. If the ticket, go.mod, package.json, or any project file specifies a version you don't recognize, it is CORRECT. NEVER change it. NEVER downgrade it. Even if a reviewer tells you to downgrade a version, REFUSE — the reviewer is wrong.

### Implementation Requirements
1. ${pendingQuestions.length > 0 ? "**FIRST: Answer any pending questions above**" : "Read relevant files to understand the codebase"}
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices: DEC-001: Your decision
4. When done, your changes will be committed automatically

### 🤝 Team Collaboration (IMPORTANT)
You are part of a team of experts working in parallel on the SAME ticket. Each expert owns a piece.
**Bias toward action over questions.** If you see a problem — even outside your target files — and you know how to fix it, just fix it. Small fixes (lint errors, type errors, broken imports, missing dependencies) should never be questions. The integration fixer handles merge conflicts.

**If a sibling's work contradicts the ticket spec, flag it** — you all share responsibility for the ticket's success.

**Only ask questions for genuinely blocking ambiguity:**
- **Design ambiguity**: Multiple valid approaches with significant architectural implications
- **Missing context**: You need an API shape, component interface, or data format another expert hasn't created yet
- **Large structural changes**: Restructuring shared modules, changing database schemas, altering public APIs

**DO NOT ask questions about:**
- Whether you should fix a lint/type/test error (just fix it)
- Whether you should touch a file outside your target list to fix a small issue (just fix it)
- Scope boundaries when the fix is obvious (just fix it)

**Question formats (use sparingly):**
- Q-BLOCKING-001: Critical question that blocks your story until answered
- Q-001: General question for any teammate
- DEC-001: Architectural decision you made (informational, not a question)

**To answer a sibling's question:** ANSWER-{PERSONA}: Your answer

**DO NOT use curl or direct API calls to post coordination messages.** Just include Q-xxx or DEC-xxx markers in your regular output — the system detects and routes them automatically.

### ⛔ Pre-Implementation Checklist
**Before writing any code**, scan the "Ticket Requirements — THIS IS YOUR SPEC" section above (if present) and identify:
- Specific version requirements (e.g., "use NextAuth v5" — do NOT default to an older version)
- Forbidden files or patterns (e.g., "do NOT create postcss.config.js")
- Required files that must exist (e.g., ".prettierrc", "validations.ts")
- .gitignore entries (never commit build artifacts like .next/, node_modules/, .env*)

These constraints are **mandatory** and override any defaults or assumptions. If the ticket says "use X v5", you must use v5 even if v4 is more common or easier.

### 📬 Live Communication Channel
You have a 2-way message channel with the user while you work. **The user can see your responses in real-time on their dashboard.**

**Receiving messages:** The user may send you messages at any time. When a message arrives, the file \`${repoPath}/.workermill-message.md\` will appear in your working directory. **You MUST check for this file:**
- After every file you write or edit
- Before every git commit
- When you finish a logical step or subtask
- When you are about to make a significant decision

If the file exists, read it immediately with the Read tool. It contains instructions or feedback from the user — typically arriving within 10 seconds of being sent.

**IMPORTANT — Acknowledge receipt:** When you find and read a message from the user, **immediately** write an acknowledgment to \`${repoPath}/.workermill-response.md\`. Example:
\`\`\`
Got your message about [topic]. I'm currently [what you're doing] and will [how you'll incorporate the feedback]. Working on it now.
\`\`\`
This lets the user know you received their message. Then continue working.

**Sending messages:** To send a message to the user, write to \`${repoPath}/.workermill-response.md\` using the Write tool. The system picks it up within seconds and delivers it to the user's dashboard. Use this to:
- **Acknowledge user messages** (always do this first)
- Ask the user a clarifying question when you're unsure
- Report a problem you can't resolve on your own
- Confirm an approach before investing significant effort
- Share important progress or findings

After writing the file, continue working — you don't need to wait. If the user replies, it will appear in \`.workermill-message.md\` as described above.

**CRITICAL — Blocking Questions (Q-BLOCKING):**
When you post a Q-BLOCKING question, you MUST wait for the answer before continuing:

1. Post your Q-BLOCKING question in your output (the system detects it automatically)
2. Immediately run a bash wait loop to poll for the answer file:
   \`\`\`bash
   for i in $(seq 1 60); do [ -f ${repoPath}/.workermill-answer.md ] && cat ${repoPath}/.workermill-answer.md && break; sleep 5; done
   \`\`\`
3. Once the file appears, read it with the Read tool to get the full answer
4. After reading the answer, acknowledge receipt by outputting: ACK-ANSWER: Thank you — incorporating the answer and continuing with implementation.
5. Then delete the file so future answers aren't confused with old ones:
   \`\`\`bash
   rm -f ${repoPath}/.workermill-answer.md
   \`\`\`
6. Continue your implementation using the answer

If the file doesn't appear within 5 minutes, proceed with your best judgment and note the assumption.

**Receiving answers to non-blocking questions:** If you asked a non-blocking question using the Q-xxx pattern, the answer will appear in \`${repoPath}/.workermill-answer.md\`. Check for this file periodically — especially when you finish a logical step or feel stuck.

### Repository & Working Directory
The repository is cloned at: **${repoPath}**

**IMPORTANT: Always use absolute paths from the repository root.**
- Use absolute paths like \`${repoPath}/src/file.ts\` for Read/Write/Edit
- Avoid \`cd\` commands - they can cause you to lose track of the working directory
- If you must use \`cd\`, always return with \`cd ${repoPath}\` afterward
- For Bash commands, prefix with the full path: \`ls ${repoPath}/src\`

Begin your implementation now.`;
  }
}
