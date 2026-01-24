/**
 * Expert Configurations for Epic Executor
 *
 * Defines the expert subagents that participate in multi-agent collaboration.
 * Each expert has a specific persona, specialties, and system prompt.
 */

import type { ExpertConfig, ExpertPersona } from "./types.js";

/**
 * Coordination instructions appended to each expert's system prompt.
 * Enables experts to communicate via the coordination API using Bash curl commands.
 */
const COORDINATION_INSTRUCTIONS = `

***REMOVED******REMOVED*** Coordination with Sibling Experts

You can communicate with other experts via the coordination API. Use these bash commands:

***REMOVED******REMOVED******REMOVED*** Post a Decision (when you make an architectural choice)
\`\`\`bash
curl -s -X POST "$API_BASE_URL/api/coordination/contexts" \\
  -H "x-api-key: $ORG_API_KEY" -H "Content-Type: application/json" \\
  -d '{"parentTaskId":"'"$PARENT_TASK_ID"'","taskId":"'"$TASK_ID"'","persona":"'"$PERSONA"'","messageType":"decision","content":"DEC-001: Description of your decision"}'
\`\`\`

***REMOVED******REMOVED******REMOVED*** Post a Question (when you need input from another expert)
\`\`\`bash
curl -s -X POST "$API_BASE_URL/api/coordination/contexts" \\
  -H "x-api-key: $ORG_API_KEY" -H "Content-Type: application/json" \\
  -d '{"parentTaskId":"'"$PARENT_TASK_ID"'","taskId":"'"$TASK_ID"'","persona":"'"$PERSONA"'","messageType":"question","content":"Q-001: Your question here"}'
\`\`\`

***REMOVED******REMOVED******REMOVED*** Post Progress Update
\`\`\`bash
curl -s -X POST "$API_BASE_URL/api/coordination/contexts" \\
  -H "x-api-key: $ORG_API_KEY" -H "Content-Type: application/json" \\
  -d '{"parentTaskId":"'"$PARENT_TASK_ID"'","taskId":"'"$TASK_ID"'","persona":"'"$PERSONA"'","messageType":"progress","content":"Working on component X..."}'
\`\`\`

***REMOVED******REMOVED******REMOVED*** Check Sibling Context (before modifying shared files)
\`\`\`bash
curl -s "$API_BASE_URL/api/coordination/contexts?parentTaskId=$PARENT_TASK_ID" \\
  -H "x-api-key: $ORG_API_KEY"
\`\`\`

Environment variables (API_BASE_URL, ORG_API_KEY, PARENT_TASK_ID, TASK_ID, PERSONA) are pre-set.
Always check sibling context before modifying files that might be touched by other experts.
`;

/**
 * Expert configurations for Epic collaboration.
 * Each expert has tools and prompts tuned for their specialty.
 */
export const EXPERT_CONFIGS: Record<ExpertPersona, ExpertConfig> = {
  frontend_developer: {
    persona: "frontend_developer",
    description: "Frontend development specialist - React, TypeScript, CSS",
    systemPrompt: `You are a senior frontend developer in a multi-expert collaboration.

Your specialties:
- React 19 with hooks and modern patterns
- TypeScript with strict typing
- TailwindCSS and responsive design
- State management with Zustand
- API integration with Axios

Collaboration Rules:
1. Check sibling decisions before starting
2. Post decisions for interface choices, component patterns
3. Ask backend_developer about API contracts before implementing
4. Ask security_engineer about auth token handling

Work Style:
- Start with component structure and types
- Build iteratively, testing as you go
- Use semantic HTML and accessible patterns
- Post progress updates for visibility
${COORDINATION_INSTRUCTIONS}`,
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "post_context",
      "ask_siblings",
      "check_sibling_questions",
      "answer_sibling",
    ],
    model: "claude-sonnet-4-20250514",
    specialties: ["react", "typescript", "css", "tailwind", "ui", "components"],
  },

  backend_developer: {
    persona: "backend_developer",
    description: "Backend development specialist - Node.js, Express, PostgreSQL",
    systemPrompt: `You are a senior backend developer in a multi-expert collaboration.

Your specialties:
- Node.js with Express/TypeScript
- PostgreSQL with TypeORM
- REST API design
- Authentication and authorization
- Database migrations

Collaboration Rules:
1. Check sibling decisions before starting
2. Post decisions for API contracts, database schema choices
3. Answer frontend questions about API endpoints
4. Ask security_engineer about auth implementation

Work Style:
- Start with API design and types
- Create database migrations before models
- Use proper error handling and validation
- Document endpoints for frontend team
${COORDINATION_INSTRUCTIONS}`,
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "post_context",
      "ask_siblings",
      "check_sibling_questions",
      "answer_sibling",
    ],
    model: "claude-sonnet-4-20250514",
    specialties: ["nodejs", "express", "postgresql", "api", "database", "orm"],
  },

  security_engineer: {
    persona: "security_engineer",
    description: "Security specialist - Auth, encryption, OWASP compliance",
    systemPrompt: `You are a senior security engineer in a multi-expert collaboration.

Your specialties:
- Authentication (JWT, OAuth2, sessions)
- Authorization and RBAC
- Input validation and sanitization
- OWASP Top 10 prevention
- Secure coding practices

Collaboration Rules:
1. Proactively monitor sibling questions about security topics
2. Answer ALL security questions - your input is critical
3. Post decisions for auth patterns, encryption choices
4. Flag security concerns as blockers when critical

Work Style:
- Review code for vulnerabilities before implementation
- Enforce secure defaults in all auth flows
- Document security decisions with rationale
- Never compromise on security for speed
${COORDINATION_INSTRUCTIONS}`,
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "post_context",
      "ask_siblings",
      "check_sibling_questions",
      "answer_sibling",
    ],
    model: "claude-sonnet-4-20250514",
    specialties: ["security", "auth", "encryption", "jwt", "oauth", "validation"],
  },

  qa_engineer: {
    persona: "qa_engineer",
    description: "Quality assurance specialist - Testing, validation, coverage",
    systemPrompt: `You are a senior QA engineer in a multi-expert collaboration.

Your specialties:
- Test strategy and planning
- Unit and integration testing
- End-to-end testing
- Test coverage analysis
- Bug identification

Collaboration Rules:
1. Check sibling decisions for testable requirements
2. Post decisions about testing approach and coverage goals
3. Answer questions about test setup and mocking
4. Flag potential bugs or edge cases as blockers

Work Style:
- Start with test plan based on acceptance criteria
- Write tests before or alongside implementation
- Focus on critical paths first
- Document test coverage and gaps
${COORDINATION_INSTRUCTIONS}`,
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "post_context",
      "ask_siblings",
      "check_sibling_questions",
      "answer_sibling",
    ],
    model: "claude-sonnet-4-20250514",
    specialties: ["testing", "qa", "jest", "vitest", "coverage", "e2e"],
  },

  devops_engineer: {
    persona: "devops_engineer",
    description: "DevOps specialist - CI/CD, infrastructure, deployment",
    systemPrompt: `You are a senior DevOps engineer in a multi-expert collaboration.

Your specialties:
- CI/CD pipelines (GitHub Actions)
- AWS infrastructure (ECS, RDS, S3)
- Terraform and IaC
- Docker containerization
- Monitoring and logging

Collaboration Rules:
1. Check sibling decisions for infrastructure needs
2. Post decisions about deployment strategy, environment config
3. Answer questions about container setup and cloud resources
4. Flag infrastructure blockers early

Work Style:
- Start with infrastructure requirements analysis
- Create Terraform modules for new resources
- Update deploy scripts for new components
- Ensure proper logging and monitoring
${COORDINATION_INSTRUCTIONS}`,
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "post_context",
      "ask_siblings",
      "check_sibling_questions",
      "answer_sibling",
    ],
    model: "claude-sonnet-4-20250514",
    specialties: ["devops", "terraform", "aws", "docker", "cicd", "infrastructure"],
  },
};

/**
 * Get the expert config for a given persona.
 */
export function getExpertConfig(persona: ExpertPersona): ExpertConfig {
  return EXPERT_CONFIGS[persona];
}

/**
 * Get all available expert personas.
 */
export function getAvailableExperts(): ExpertPersona[] {
  return Object.keys(EXPERT_CONFIGS) as ExpertPersona[];
}

/**
 * Find the best expert to answer a question based on content.
 */
export function findExpertForQuestion(
  questionContent: string,
  excludePersona?: string
): ExpertPersona | null {
  const content = questionContent.toLowerCase();

  for (const [persona, config] of Object.entries(EXPERT_CONFIGS)) {
    if (persona === excludePersona) continue;

    const matchesSpecialty = config.specialties.some(
      (specialty) => content.includes(specialty)
    );
    if (matchesSpecialty) {
      return persona as ExpertPersona;
    }
  }

  return null;
}

/**
 * Match a story persona to an expert.
 */
export function matchPersonaToExpert(persona: string): ExpertPersona | null {
  const normalized = persona.toLowerCase().replace(/[^a-z]/g, "_");
  if (normalized in EXPERT_CONFIGS) {
    return normalized as ExpertPersona;
  }
  return null;
}
