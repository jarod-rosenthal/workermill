/**
 * Persona Inference Service
 *
 * Determines the appropriate AI worker persona based on Jira ticket metadata.
 * Supports org-specific custom personas and inference rules.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization, Persona } from "../models/index.js";
import { IsNull } from "typeorm";

// System persona type (built-in personas)
export type SystemPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager"
  | "manager"
  | "tech_lead"
  | "data_ml_engineer"
  | "mobile_developer";

interface JiraIssue {
  summary?: string;
  description?: string | null;
  issueType?: string;
  labels?: string[];
  fields?: Record<string, unknown>;
}

interface OrgInferenceRules {
  labelMappings?: Record<string, string>;
  keywordPatterns?: Record<string, string>;
  defaultPersona?: string;
}

/**
 * Default keyword patterns for system personas
 * Higher matches = stronger fit
 */
const SYSTEM_PERSONA_KEYWORDS: Record<SystemPersona, RegExp> = {
  architect:
    /\b(architecture|system design|decompose|plan|technical design|tradeoff|rfc)\b/gi,
  frontend_developer:
    /\b(react|component|ui|ux|frontend|css|tailwind|mobile|react native|expo|vite|tailwindcss|button|form|modal|page|screen)\b/gi,
  backend_developer:
    /\b(api|endpoint|typeorm|sql|backend|server|lambda|express|route|controller|database|migration|model|rest api|graphql|openapi|swagger|sdk|api design|api contract|endpoint design|api versioning|dba|database admin|postgres|mysql|index|indexing|query optimization|replication|backup|recovery|schema)\b/gi,
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
  manager:
    /\b(manage|management|manager|oversee|delegate|strategy|stakeholder|resource allocation)\b/gi,
  tech_lead:
    /\b(review|code review|pr review|tech lead|lead|design pattern|refactor|technical debt)\b/gi,
  data_ml_engineer:
    /\b(etl|pipeline|data pipeline|dbt|airflow|dagster|kafka|streaming|data warehouse|data lake|spark|machine learning|ml|tensorflow|pytorch|model|training|llm|ai model|mlops|feature engineering)\b/gi,
  mobile_developer:
    /\b(ios|swift|swiftui|uikit|xcode|cocoapods|core data|apple|iphone|ipad|android|kotlin|jetpack|compose|gradle|room|retrofit|hilt|dagger|google play|react native|flutter)\b/gi,
};

/**
 * Default label shortcuts for system personas
 */
const SYSTEM_LABEL_TO_PERSONA: Record<string, SystemPersona> = {
  architect: "architect",
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
  manager: "manager",
  lead: "tech_lead",
  techlead: "tech_lead",
  api: "backend_developer",
  data: "data_ml_engineer",
  etl: "data_ml_engineer",
  dba: "backend_developer",
  database: "backend_developer",
  ml: "data_ml_engineer",
  ai: "data_ml_engineer",
  ios: "mobile_developer",
  android: "mobile_developer",
  mobile: "mobile_developer",
  mobile_ios: "mobile_developer",
  mobile_android: "mobile_developer",
};

export const SYSTEM_PERSONAS: SystemPersona[] = [
  "architect",
  "frontend_developer",
  "backend_developer",
  "devops_engineer",
  "security_engineer",
  "qa_engineer",
  "tech_writer",
  "project_manager",
  "manager",
  "tech_lead",
  "data_ml_engineer",
  "mobile_developer",
];

/**
 * Check if a value is a valid system persona
 */
function isSystemPersona(value: string): value is SystemPersona {
  return SYSTEM_PERSONAS.includes(value.toLowerCase() as SystemPersona);
}

/**
 * Normalize a system persona value
 */
function normalizeSystemPersona(value: string): SystemPersona | null {
  const lower = value.toLowerCase();
  if (SYSTEM_PERSONAS.includes(lower as SystemPersona)) {
    return lower as SystemPersona;
  }
  return null;
}

/**
 * Check if a persona slug is valid for an organization
 * Checks both system personas and org-specific custom personas
 */
export async function isValidPersonaForOrg(
  slug: string,
  orgId: string | null
): Promise<boolean> {
  // Check system personas first
  if (isSystemPersona(slug)) {
    return true;
  }

  // Check org-specific personas
  if (orgId) {
    const personaRepo = AppDataSource.getRepository(Persona);
    const orgPersona = await personaRepo.findOne({
      where: { slug: slug.toLowerCase(), orgId, enabled: true },
    });
    if (orgPersona) {
      return true;
    }
  }

  return false;
}

/**
 * Full persona info with keyword patterns for inference
 */
interface PersonaWithPatterns {
  slug: string;
  name: string;
  isSystem: boolean;
  keywordPattern: string | null;
  labelShortcuts: string[] | null;
}

/**
 * Get all valid personas for an organization (system + custom)
 */
export async function getValidPersonasForOrg(
  orgId: string
): Promise<Array<{ slug: string; name: string; isSystem: boolean }>> {
  const personas = await getPersonasWithPatternsForOrg(orgId);
  return personas.map((p) => ({
    slug: p.slug,
    name: p.name,
    isSystem: p.isSystem,
  }));
}

/**
 * Get all personas with their keyword patterns for inference
 */
async function getPersonasWithPatternsForOrg(
  orgId: string
): Promise<PersonaWithPatterns[]> {
  const personaRepo = AppDataSource.getRepository(Persona);

  // Get org-specific personas
  const orgPersonas = await personaRepo.find({
    where: { orgId, enabled: true },
    order: { priority: "ASC", name: "ASC" },
  });

  // Get system personas (orgId is null)
  const systemPersonas = await personaRepo.find({
    where: { orgId: IsNull(), isSystem: true, enabled: true },
    order: { priority: "ASC", name: "ASC" },
  });

  // Combine results - org personas take precedence (can override system)
  const result: PersonaWithPatterns[] = [];
  const seenSlugs = new Set<string>();

  // Add org personas first
  for (const p of orgPersonas) {
    result.push({
      slug: p.slug,
      name: p.name,
      isSystem: false,
      keywordPattern: p.keywordPattern,
      labelShortcuts: p.labelShortcuts,
    });
    seenSlugs.add(p.slug);
  }

  // Add system personas that aren't overridden
  for (const p of systemPersonas) {
    if (!seenSlugs.has(p.slug)) {
      result.push({
        slug: p.slug,
        name: p.name,
        isSystem: true,
        keywordPattern: p.keywordPattern,
        labelShortcuts: p.labelShortcuts,
      });
    }
  }

  // If no DB personas, fall back to hardcoded list
  if (result.length === 0) {
    return SYSTEM_PERSONAS.map((slug) => ({
      slug,
      name: getPersonaDisplayName(slug),
      isSystem: true,
      keywordPattern: PERSONA_KEYWORDS[slug] || null,
      labelShortcuts: Object.entries(SYSTEM_LABEL_TO_PERSONA)
        .filter(([, personaSlug]) => personaSlug === slug)
        .map(([label]) => label),
    }));
  }

  return result;
}

/**
 * Infer the appropriate worker persona from Jira ticket metadata
 *
 * Priority order:
 * 1. Explicit persona label (persona:custom_persona or persona:backend_developer)
 * 1b. Direct persona label (full name as label, case-insensitive)
 * 1c. Org-specific label mappings
 * 1d. System short-form labels (qa, backend, frontend, etc.)
 * 2. Keyword-based inference (org patterns + system patterns)
 * 3. Component-based inference
 * 4. Org default persona or system default (backend_developer)
 *
 * @param jiraIssue - The Jira issue metadata
 * @param orgId - Organization ID for org-specific inference rules
 * @param explicitPersona - Explicit persona override (from API)
 */
export async function inferPersonaFromJiraIssue(
  jiraIssue?: JiraIssue,
  explicitPersona?: string,
  orgId?: string
): Promise<string> {
  // Load org-specific inference rules if orgId provided
  let orgRules: OrgInferenceRules = {};
  let orgPersonaSlugs: Set<string> = new Set();

  if (orgId) {
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (org?.personaInferenceRules) {
      orgRules = org.personaInferenceRules;
    }

    // Get org's custom persona slugs
    const personaRepo = AppDataSource.getRepository(Persona);
    const orgPersonas = await personaRepo.find({
      where: { orgId, enabled: true },
      select: ["slug"],
    });
    orgPersonaSlugs = new Set(orgPersonas.map((p) => p.slug));
  }

  // If explicit persona provided via API, validate and use it
  if (explicitPersona) {
    const isValid = await isValidPersonaForOrg(explicitPersona, orgId || null);
    if (isValid) {
      return explicitPersona.toLowerCase();
    }
  }

  if (!jiraIssue) {
    return orgRules.defaultPersona || "backend_developer";
  }

  const labels = jiraIssue.labels || [];
  const summary = (jiraIssue.summary || "").toLowerCase();
  const description = (jiraIssue.description || "").toLowerCase();
  const text = `${summary} ${description}`;

  // Priority 1: Explicit persona label (persona:xxx format)
  const personaLabel = labels.find((l) => l.toLowerCase().startsWith("persona:"));
  if (personaLabel) {
    const persona = personaLabel.replace(/^persona:/i, "").toLowerCase();
    const isValid = await isValidPersonaForOrg(persona, orgId || null);
    if (isValid) {
      return persona;
    }
  }

  // Priority 1b: Direct persona label (full name as label)
  for (const label of labels) {
    const lower = label.toLowerCase();
    // Check org custom personas
    if (orgPersonaSlugs.has(lower)) {
      return lower;
    }
    // Check system personas
    const normalized = normalizeSystemPersona(lower);
    if (normalized) {
      return normalized;
    }
  }

  // Priority 1c: Org-specific label mappings
  if (orgRules.labelMappings) {
    for (const label of labels) {
      const mapped = orgRules.labelMappings[label.toLowerCase()];
      if (mapped) {
        const isValid = await isValidPersonaForOrg(mapped, orgId || null);
        if (isValid) {
          return mapped.toLowerCase();
        }
      }
    }
  }

  // Priority 1d: Label shortcuts from DB personas (includes system + custom)
  // Load all personas with their label shortcuts
  const allPersonas = orgId
    ? await getPersonasWithPatternsForOrg(orgId)
    : SYSTEM_PERSONAS.map((slug) => ({
        slug,
        name: getPersonaDisplayName(slug),
        isSystem: true,
        keywordPattern: PERSONA_KEYWORDS[slug] || null,
        labelShortcuts: Object.entries(SYSTEM_LABEL_TO_PERSONA)
          .filter(([, personaSlug]) => personaSlug === slug)
          .map(([label]) => label),
      }));

  // Build label-to-persona map from DB personas
  const dbLabelToPersona: Record<string, string> = {};
  for (const persona of allPersonas) {
    if (persona.labelShortcuts) {
      for (const shortcut of persona.labelShortcuts) {
        dbLabelToPersona[shortcut.toLowerCase()] = persona.slug;
      }
    }
  }

  // Check DB label shortcuts first
  for (const label of labels) {
    const mapped = dbLabelToPersona[label.toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }

  // Fall back to system short-form labels (qa, backend, frontend, etc.)
  for (const label of labels) {
    const mapped = SYSTEM_LABEL_TO_PERSONA[label.toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }

  // Priority 1e: "Persona: X" pattern in description text
  const personaPatternMatch = text.match(
    /persona:\s*([a-z][a-z0-9_]*(?:[_ ][a-z0-9]+)*)/i
  );
  if (personaPatternMatch) {
    const matchedValue = personaPatternMatch[1].toLowerCase().replace(/\s+/g, "_");
    const isValid = await isValidPersonaForOrg(matchedValue, orgId || null);
    if (isValid) {
      return matchedValue;
    }
    // Check short-form mapping
    const mapped = SYSTEM_LABEL_TO_PERSONA[matchedValue.replace(/_/g, "")];
    if (mapped) {
      return mapped;
    }
  }

  // Priority 2: Keyword-based scoring
  const scores: Record<string, number> = {};

  // Score org-specific keyword patterns from settings
  if (orgRules.keywordPatterns) {
    for (const [persona, pattern] of Object.entries(orgRules.keywordPatterns)) {
      try {
        const regex = new RegExp(pattern, "gi");
        const matches = text.match(regex);
        if (matches) {
          scores[persona] = (scores[persona] || 0) + matches.length * 2; // Org patterns get 2x weight
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }
  }

  // Score using DB persona keyword patterns (includes both system and custom)
  for (const persona of allPersonas) {
    if (persona.keywordPattern) {
      try {
        const regex = new RegExp(`\\b(${persona.keywordPattern})\\b`, "gi");
        const matches = text.match(regex);
        if (matches) {
          // Custom personas get 1.5x weight to prioritize org-specific personas
          const weight = persona.isSystem ? 1 : 1.5;
          scores[persona.slug] = (scores[persona.slug] || 0) + matches.length * weight;
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }
  }

  // Fall back to hardcoded system patterns if no DB patterns matched
  if (Object.keys(scores).length === 0) {
    for (const [persona, pattern] of Object.entries(SYSTEM_PERSONA_KEYWORDS)) {
      const matches = text.match(pattern);
      if (matches) {
        scores[persona] = (scores[persona] || 0) + matches.length;
      }
    }
  }

  // Find highest scoring persona
  let maxScore = 0;
  let bestPersona: string | null = null;

  for (const [persona, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestPersona = persona;
    }
  }

  if (bestPersona && maxScore > 0) {
    return bestPersona;
  }

  // Priority 3: Component-based inference
  const components =
    (jiraIssue.fields as { components?: Array<{ name: string }> })?.components || [];
  for (const component of components) {
    const name = (component.name || "").toLowerCase();
    if (name.includes("frontend") || name.includes("ui")) return "frontend_developer";
    if (name.includes("backend") || name.includes("api")) return "backend_developer";
    if (name.includes("infrastructure") || name.includes("devops"))
      return "devops_engineer";
    if (name.includes("security")) return "security_engineer";
    if (name.includes("qa") || name.includes("test")) return "qa_engineer";
    if (name.includes("docs")) return "tech_writer";
  }

  // Priority 4: Org default or system default
  return orgRules.defaultPersona || "backend_developer";
}

/**
 * Synchronous version for backward compatibility (uses system defaults only)
 * @deprecated Use async inferPersonaFromJiraIssue instead
 */
export function inferPersonaFromJiraIssueSync(
  jiraIssue?: JiraIssue,
  explicitPersona?: string
): string {
  // If explicit persona provided via API, use it
  if (explicitPersona && isSystemPersona(explicitPersona)) {
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
    if (isSystemPersona(persona)) {
      return persona;
    }
  }

  // Priority 1b: Direct persona label
  for (const label of labels) {
    const normalized = normalizeSystemPersona(label);
    if (normalized) {
      return normalized;
    }
  }

  // Priority 1c: Short-form labels
  for (const label of labels) {
    const mapped = SYSTEM_LABEL_TO_PERSONA[label.toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }

  // Priority 2: Keyword-based scoring
  const scores: Record<SystemPersona, number> = {} as Record<SystemPersona, number>;
  for (const persona of SYSTEM_PERSONAS) {
    scores[persona] = 0;
  }

  for (const [persona, pattern] of Object.entries(SYSTEM_PERSONA_KEYWORDS)) {
    const matches = text.match(pattern);
    if (matches) {
      scores[persona as SystemPersona] = matches.length;
    }
  }

  let maxScore = 0;
  let bestPersona: SystemPersona | null = null;

  for (const [persona, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestPersona = persona as SystemPersona;
    }
  }

  if (bestPersona && maxScore > 0) {
    return bestPersona;
  }

  // Priority 3: Component-based inference
  const components =
    (jiraIssue.fields as { components?: Array<{ name: string }> })?.components || [];
  for (const component of components) {
    const name = (component.name || "").toLowerCase();
    if (name.includes("frontend") || name.includes("ui")) return "frontend_developer";
    if (name.includes("backend") || name.includes("api")) return "backend_developer";
    if (name.includes("infrastructure") || name.includes("devops"))
      return "devops_engineer";
    if (name.includes("security")) return "security_engineer";
    if (name.includes("qa") || name.includes("test")) return "qa_engineer";
    if (name.includes("docs")) return "tech_writer";
  }

  return "backend_developer";
}

/**
 * Get human-readable description of why a persona was chosen
 */
export function getPersonaRationale(
  jiraIssue?: JiraIssue,
  inferredPersona?: string
): string {
  if (!jiraIssue || !inferredPersona) {
    return "Default persona (no Jira data available)";
  }

  const labels = jiraIssue.labels || [];
  const summary = (jiraIssue.summary || "").toLowerCase();
  const description = (jiraIssue.description || "").toLowerCase();
  const text = `${summary} ${description}`;

  // Check explicit label
  const personaLabel = labels.find((l) => l.toLowerCase().startsWith("persona:"));
  if (personaLabel) {
    return `Explicit label: ${personaLabel}`;
  }

  // Check "Persona: X" pattern in text
  const personaPatternMatch = text.match(/persona:\s*([a-z][a-z0-9_]*(?:[_ ][a-z0-9]+)*)/i);
  if (personaPatternMatch) {
    return `Description pattern: "Persona: ${personaPatternMatch[1]}"`;
  }

  // Calculate scores for rationale
  const scores: Record<string, number> = {};
  for (const [persona, pattern] of Object.entries(SYSTEM_PERSONA_KEYWORDS)) {
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
    if (SYSTEM_LABEL_TO_PERSONA[label.toLowerCase()]) {
      return `Label shortcut: ${label}`;
    }
  }

  return "Default inference (no keywords matched)";
}

/**
 * Get display name for a persona
 */
export function getPersonaDisplayName(persona: string): string {
  const names: Record<string, string> = {
    architect: "Architect",
    frontend_developer: "Frontend Developer",
    backend_developer: "Backend Developer",
    devops_engineer: "DevOps Engineer",
    security_engineer: "Security Engineer",
    qa_engineer: "QA Engineer",
    tech_writer: "Technical Writer",
    project_manager: "Project Manager",
    manager: "Manager",
    tech_lead: "Tech Lead",
    data_ml_engineer: "Data & ML Engineer",
    mobile_developer: "Mobile Developer",
  };
  // Return custom name or format slug
  return (
    names[persona] ||
    persona
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

// =============================================================================
// Exported Constants for API Responses
// =============================================================================

/**
 * Default keyword patterns as strings (for API responses)
 * The actual inference uses compiled RegExp objects internally
 */
export const PERSONA_KEYWORDS: Record<string, string> = {
  architect:
    "architecture|system design|decompose|plan|technical design|tradeoff|rfc",
  frontend_developer:
    "react|component|ui|ux|frontend|css|tailwind|mobile|react native|expo|vite|tailwindcss|button|form|modal|page|screen",
  backend_developer:
    "api|endpoint|typeorm|sql|backend|server|lambda|express|route|controller|database|migration|model|rest api|graphql|openapi|swagger|sdk|api design|api contract|endpoint design|api versioning|dba|database admin|postgres|mysql|index|indexing|query optimization|replication|backup|recovery|schema",
  devops_engineer:
    "terraform|infrastructure|cicd|deployment|docker|kubernetes|aws|cloudfront|s3|rds|cloudwatch|ecs|ecr|vpc|iam|github actions",
  security_engineer:
    "security|vulnerability|cve|encryption|authentication|authorization|cors|xss|sql injection|owasp|audit",
  qa_engineer:
    "test|testing|qa|e2e|unit test|integration test|playwright|jest|coverage|spec|fixture",
  tech_writer:
    "documentation|docs|readme|guide|tutorial|api docs|openapi|docusaurus|jsdoc",
  project_manager:
    "roadmap|planning|coordination|milestone|sprint|epic|backlog|estimate|priorit",
  manager:
    "manage|management|manager|oversee|delegate|strategy|stakeholder|resource allocation",
  tech_lead:
    "review|code review|pr review|tech lead|lead|design pattern|refactor|technical debt",
  data_ml_engineer:
    "etl|pipeline|data pipeline|dbt|airflow|dagster|kafka|streaming|data warehouse|data lake|spark|machine learning|ml|tensorflow|pytorch|model|training|llm|ai model|mlops|feature engineering",
  mobile_developer:
    "ios|swift|swiftui|uikit|xcode|cocoapods|core data|apple|iphone|ipad|android|kotlin|jetpack|compose|gradle|room|retrofit|hilt|dagger|google play|react native|flutter",
};
