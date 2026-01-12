/**
 * Persona Inference Service
 *
 * Determines the appropriate AI worker persona based on Jira ticket metadata.
 * This ensures the RIGHT worker picks up each task.
 */

import type { WorkerPersona } from "../models/index.js";

interface JiraIssue {
  summary?: string;
  description?: string | null;
  issueType?: string;
  labels?: string[];
  fields?: Record<string, unknown>;
}

/**
 * Keyword patterns for each persona
 * Higher matches = stronger fit
 */
const PERSONA_KEYWORDS: Record<WorkerPersona, RegExp> = {
  frontend_developer:
    /\b(react|component|ui|ux|frontend|css|tailwind|mobile|react native|expo|vite|tailwindcss|button|form|modal|page|screen)\b/gi,
  backend_developer:
    /\b(api|endpoint|typeorm|sql|backend|server|lambda|express|route|controller|database|migration|model)\b/gi,
  devops_engineer:
    /\b(terraform|infrastructure|cicd|deployment|docker|kubernetes|aws|cloudfront|s3|rds|cloudwatch|ecs|ecr|vpc|iam|github actions)\b/gi,
  security_engineer:
    /\b(security|vulnerability|cve|encryption|authentication|authorization|cors|xss|sql injection|owasp|audit)\b/gi,
  qa_engineer:
    /\b(test|testing|qa|e2e|unit test|integration test|playwright|jest|coverage|spec|fixture)\b/gi,
  tech_writer:
    /\b(documentation|docs|readme|guide|tutorial|api docs|openapi|docusaurus|jsdoc)\b/gi,
  project_manager:
    /\b(roadmap|planning|coordination|milestone|sprint|epic|backlog|estimate|priorit)\b/gi,
};

/**
 * Label shortcuts for explicit persona assignment
 */
const LABEL_TO_PERSONA: Record<string, WorkerPersona> = {
  backend: "backend_developer",
  frontend: "frontend_developer",
  devops: "devops_engineer",
  infra: "devops_engineer",
  infrastructure: "devops_engineer",
  security: "security_engineer",
  qa: "qa_engineer",
  testing: "qa_engineer",
  docs: "tech_writer",
  documentation: "tech_writer",
  pm: "project_manager",
  manager: "project_manager",
};

const VALID_PERSONAS: WorkerPersona[] = [
  "frontend_developer",
  "backend_developer",
  "devops_engineer",
  "security_engineer",
  "qa_engineer",
  "tech_writer",
  "project_manager",
];

function isValidPersona(value: string): value is WorkerPersona {
  // Case-insensitive check for valid personas
  return VALID_PERSONAS.includes(value.toLowerCase() as WorkerPersona);
}

function normalizePersona(value: string): WorkerPersona | null {
  const lower = value.toLowerCase();
  if (VALID_PERSONAS.includes(lower as WorkerPersona)) {
    return lower as WorkerPersona;
  }
  return null;
}

/**
 * Infer the appropriate worker persona from Jira ticket metadata
 *
 * Priority order:
 * 1. Explicit persona label (persona:backend_developer)
 * 1b. Direct persona label (full name: qa_engineer, backend_developer)
 * 1c. Short-form labels (qa, backend, frontend, etc.)
 * 2. Keyword-based inference from summary/description
 * 3. Component-based inference
 * 4. Default fallback (backend_developer)
 *
 * CRITICAL FIX: Short-form labels (qa, backend) are now Priority 1c instead of Priority 4.
 * This ensures explicit user intent via labels takes precedence over keyword scoring.
 */
export function inferPersonaFromJiraIssue(
  jiraIssue?: JiraIssue,
  explicitPersona?: WorkerPersona
): WorkerPersona {
  // If explicit persona provided via API, use it
  if (explicitPersona && isValidPersona(explicitPersona)) {
    return explicitPersona;
  }

  if (!jiraIssue) {
    return "backend_developer";
  }

  const labels = jiraIssue.labels || [];
  const summary = (jiraIssue.summary || "").toLowerCase();
  const description = (jiraIssue.description || "").toLowerCase();
  const text = `${summary} ${description}`;

  // Priority 1: Explicit persona label (persona:backend_developer format)
  const personaLabel = labels.find((l) => l.startsWith("persona:"));
  if (personaLabel) {
    const persona = personaLabel.replace("persona:", "");
    if (isValidPersona(persona)) {
      return persona;
    }
  }

  // Priority 1b: Direct persona label (qa_engineer, backend_developer, etc.)
  // This allows using the full persona name as a label (case-insensitive)
  for (const label of labels) {
    const normalized = normalizePersona(label);
    if (normalized) {
      return normalized;
    }
  }

  // Priority 1c: Short-form labels (qa, backend, frontend, etc.)
  // MOVED FROM PRIORITY 4: Short-form labels should be checked early as they represent
  // explicit user intent via ticket labels. This takes precedence over keyword scoring.
  for (const label of labels) {
    const mapped = LABEL_TO_PERSONA[label.toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }

  // Priority 2: Keyword-based scoring
  const scores: Record<WorkerPersona, number> = {
    frontend_developer: 0,
    backend_developer: 0,
    devops_engineer: 0,
    security_engineer: 0,
    qa_engineer: 0,
    tech_writer: 0,
    project_manager: 0,
  };

  for (const [persona, pattern] of Object.entries(PERSONA_KEYWORDS)) {
    const matches = text.match(pattern);
    if (matches) {
      scores[persona as WorkerPersona] = matches.length;
    }
  }

  // Find highest scoring persona
  let maxScore = 0;
  let bestPersona: WorkerPersona | null = null;

  for (const [persona, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestPersona = persona as WorkerPersona;
    }
  }

  if (bestPersona && maxScore > 0) {
    return bestPersona;
  }

  // Priority 3: Component-based inference
  const components = (jiraIssue.fields as { components?: Array<{ name: string }> })?.components || [];
  for (const component of components) {
    const name = (component.name || "").toLowerCase();
    if (name.includes("frontend") || name.includes("ui")) return "frontend_developer";
    if (name.includes("backend") || name.includes("api")) return "backend_developer";
    if (name.includes("infrastructure") || name.includes("devops")) return "devops_engineer";
    if (name.includes("security")) return "security_engineer";
    if (name.includes("qa") || name.includes("test")) return "qa_engineer";
    if (name.includes("docs")) return "tech_writer";
  }

  // Priority 4: Default
  return "backend_developer";
}

/**
 * Get human-readable description of why a persona was chosen
 */
export function getPersonaRationale(
  jiraIssue?: JiraIssue,
  inferredPersona?: WorkerPersona
): string {
  if (!jiraIssue || !inferredPersona) {
    return "Default persona (no Jira data available)";
  }

  const labels = jiraIssue.labels || [];
  const summary = (jiraIssue.summary || "").toLowerCase();
  const description = (jiraIssue.description || "").toLowerCase();
  const text = `${summary} ${description}`;

  // Check explicit label
  const personaLabel = labels.find((l) => l.startsWith("persona:"));
  if (personaLabel) {
    return `Explicit label: ${personaLabel}`;
  }

  // Calculate scores for rationale
  const scores: Record<string, number> = {};
  for (const [persona, pattern] of Object.entries(PERSONA_KEYWORDS)) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      scores[persona] = matches.length;
    }
  }

  if (Object.keys(scores).length > 0) {
    const scoreStr = Object.entries(scores)
      .map(([p, s]) => `${p.replace("_", " ")}=${s}`)
      .join(", ");
    return `Keyword scoring: ${scoreStr}`;
  }

  // Check label shortcuts
  for (const label of labels) {
    if (LABEL_TO_PERSONA[label.toLowerCase()]) {
      return `Label shortcut: ${label}`;
    }
  }

  return "Default inference (no keywords matched)";
}

/**
 * Get display name for a persona
 */
export function getPersonaDisplayName(persona: WorkerPersona): string {
  const names: Record<WorkerPersona, string> = {
    frontend_developer: "Frontend Developer",
    backend_developer: "Backend Developer",
    devops_engineer: "DevOps Engineer",
    security_engineer: "Security Engineer",
    qa_engineer: "QA Engineer",
    tech_writer: "Technical Writer",
    project_manager: "Project Manager",
  };
  return names[persona] || persona;
}
