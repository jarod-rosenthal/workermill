/**
 * PRD Inventory Extraction Service
 *
 * Extracts structured work inventory from PRDs using Claude Sonnet.
 * This is Phase 0 of the new planning system - parsing PRDs into
 * countable, scorable artifacts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";

// ============================================================================
// INVENTORY TYPES
// ============================================================================

/**
 * Item complexity level for "small but hard" detection.
 * Used to weight individual items beyond flat counts.
 */
export type ItemComplexity = "simple" | "medium" | "hard";

/**
 * Change type for delta inventory extraction.
 * Indicates whether an item represents new work vs existing infrastructure.
 */
export type ChangeType = "new" | "modify" | "existing" | "unknown";

/**
 * Confidence level for extraction.
 * Indicates how certain the model is about the extraction.
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Delta fields added to inventory items for change tracking.
 * Required for all items to distinguish new work from existing infrastructure.
 */
export interface DeltaFields {
  /** Type of change: new work, modification, or existing infrastructure */
  changeType: ChangeType;
  /** Exact quote from PRD justifying this item - NOT paraphrased */
  evidence: string;
  /** Confidence in the extraction */
  confidence: ConfidenceLevel;
}

/**
 * A user journey extracted from the PRD
 */
export interface PRDJourney extends Partial<DeltaFields> {
  /** The actor performing the journey (e.g., "admin", "end user") */
  actor: string;
  /** What the actor wants to accomplish */
  goal: string;
  /** Conditions that must be true before the journey starts */
  preconditions: string[];
  /** Steps in the happy path */
  happyPathSteps: string[];
  /** Edge cases and error scenarios */
  edgeCases: string[];
  /** Implementation complexity */
  complexity?: ItemComplexity;
}

/**
 * A UI surface (page, modal, component) that needs to be built
 */
export interface PRDUISurface extends Partial<DeltaFields> {
  /** Name of the UI element */
  name: string;
  /** Type of UI surface */
  type: "page" | "modal" | "component" | "widget";
  /** States the UI needs to handle */
  states: string[];
  /** User interactions supported */
  interactions: string[];
  /** Implementation complexity */
  complexity?: ItemComplexity;
}

/**
 * An API endpoint that needs to be implemented
 */
export interface PRDAPIEndpoint extends Partial<DeltaFields> {
  /** API route (e.g., "/api/users/:id") */
  route: string;
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Description of request body/params */
  requestShape: string;
  /** Description of response body */
  responseShape: string;
  /** Error codes this endpoint can return */
  errorCodes: string[];
  /** Implementation complexity */
  complexity?: ItemComplexity;
}

/**
 * A data entity (model/table) that needs to be created or modified
 */
export interface PRDEntity extends Partial<DeltaFields> {
  /** Entity name (e.g., "User", "Order") */
  name: string;
  /** Fields on the entity */
  fields: string[];
  /** Constraints (unique, not null, etc.) */
  constraints: string[];
  /** Relationships to other entities */
  relationships: string[];
  /** Implementation complexity */
  complexity?: ItemComplexity;
}

/**
 * An external integration that needs to be implemented
 */
export interface PRDIntegration extends Partial<DeltaFields> {
  /** External system name (e.g., "Stripe", "SendGrid") */
  system: string;
  /** Authentication method */
  authMethod: string;
  /** Ways the integration can fail */
  failureModes: string[];
  /** What to do when integration fails */
  fallbackStrategy: string;
  /** Implementation complexity */
  complexity?: ItemComplexity;
}

/**
 * A migration that needs to be run
 */
export interface PRDMigration extends Partial<DeltaFields> {
  /** Type of migration */
  type: "schema" | "data" | "config";
  /** What the migration does */
  description: string;
  /** How to roll back if needed */
  rollbackPlan: string;
  /** Risk level of this migration */
  riskLevel: "low" | "medium" | "high";
}

/**
 * A non-functional requirement
 */
export interface PRDNonFunctional extends Partial<DeltaFields> {
  /** Category of the requirement */
  category: "performance" | "security" | "compliance" | "observability" | "accessibility";
  /** The requirement */
  requirement: string;
  /** How to verify it's met */
  acceptanceCriteria: string;
  /** Implementation complexity */
  complexity?: ItemComplexity;
  /** Whether this NFR is actionable (has measurable criteria) */
  actionable?: boolean;
}

/**
 * An unknown or unclear aspect of the PRD
 */
export interface PRDUnknown extends Partial<DeltaFields> {
  /** The question that needs answering */
  question: string;
  /** What part of the system this affects */
  impactArea: string;
  /** Whether this blocks implementation */
  blocking: boolean;
}

/**
 * Complexity flags for "small but hard" work patterns.
 * These indicate intricate implementation even when scope is small.
 */
export type ComplexityFlag =
  | "oauth2_oidc"           // OAuth2/OIDC flows are intricate
  | "cryptography"          // Encryption, signing, key management
  | "real_time_sync"        // WebSockets, SSE, live updates
  | "distributed_transactions" // Sagas, 2PC, eventual consistency
  | "machine_learning"      // ML model integration/training
  | "financial_calculations" // Money math, rounding, compliance
  | "file_processing"       // Large file uploads, streaming, parsing
  | "search_indexing"       // Full-text search, Elasticsearch
  | "caching_strategy"      // Multi-tier caching, invalidation
  | "rate_limiting"         // Throttling, quotas, abuse prevention
  | "audit_logging"         // Compliance audit trails
  | "multi_tenancy";        // Tenant isolation, data partitioning

/**
 * Complete inventory extracted from a PRD
 */
export interface PRDInventory {
  /** User journeys */
  journeys: PRDJourney[];
  /** UI surfaces to build */
  uiSurfaces: PRDUISurface[];
  /** API endpoints to implement */
  apiEndpoints: PRDAPIEndpoint[];
  /** Data entities to create/modify */
  entities: PRDEntity[];
  /** External integrations */
  integrations: PRDIntegration[];
  /** Database/data migrations */
  migrations: PRDMigration[];
  /** Non-functional requirements */
  nonFunctionals: PRDNonFunctional[];
  /** Unknowns and open questions */
  unknowns: PRDUnknown[];
  /** Subsystems touched by this PRD */
  subsystems: string[];
  /** Complexity flags for "small but hard" patterns */
  complexityFlags: ComplexityFlag[];
  /** Raw extraction metadata */
  _metadata?: {
    extractionModel: string;
    extractionDurationMs: number;
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// VALIDATION CONSTANTS (for deterministic post-extraction filtering)
// ============================================================================

/**
 * Keywords that indicate a truly blocking unknown (requires spike story).
 * Only mark unknowns as blocking if evidence contains these phrases.
 */
export const BLOCKING_UNKNOWN_KEYWORDS = [
  "tbd",
  "to be determined",
  "unclear",
  "undecided",
  "pending decision",
  "need to decide",
  "not yet defined",
  "decision required",
  "awaiting input",
];

/**
 * Keywords that indicate actual schema changes (justify migrations).
 * Migrations without these verbs in their description are likely over-extractions.
 */
export const SCHEMA_CHANGE_KEYWORDS = [
  "add column",
  "create table",
  "alter table",
  "new field",
  "new table",
  "schema change",
  "migrate data",
  "drop column",
  "rename column",
  "add index",
  "new entity",
  "new model",
];

/**
 * Known existing integrations that don't need new integration stories.
 * If an integration matches this list, mark as changeType: existing.
 */
export const EXISTING_INTEGRATIONS = [
  "pagerduty",
  "opsgenie",
  "jira",
  "slack",
  "github",
  "datadog",
  "cloudwatch",
  "prometheus",
  "stripe",
  "s3",
  "cognito",
  "aws",
  "auth0",
  "sendgrid",
  "twilio",
];

/**
 * Maximum blocking unknowns per journey.
 * Cap to prevent over-extraction of spikes.
 */
export const MAX_BLOCKING_UNKNOWNS_PER_JOURNEY = 2;

/**
 * Maximum total blocking unknowns for a single PRD.
 */
export const MAX_TOTAL_BLOCKING_UNKNOWNS = 5;

// ============================================================================
// INVENTORY EXTRACTION
// ============================================================================

// Use Sonnet for inventory extraction (Haiku is too weak for this task)
const INVENTORY_MODEL = "claude-sonnet-4-20250514";

/**
 * Tool definition for structured inventory extraction
 */
const INVENTORY_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_inventory",
  description: "Extract structured work inventory from a PRD. Be exhaustive - if something is implied but not explicit, include it with appropriate flags.",
  input_schema: {
    type: "object" as const,
    properties: {
      journeys: {
        type: "array",
        description: "User journeys in the PRD. Each journey describes what a user/actor wants to accomplish.",
        items: {
          type: "object",
          properties: {
            actor: { type: "string", description: "Who is performing this journey (e.g., 'admin', 'end user', 'API consumer')" },
            goal: { type: "string", description: "What the actor wants to accomplish" },
            preconditions: { type: "array", items: { type: "string" }, description: "Conditions that must be true before starting" },
            happyPathSteps: { type: "array", items: { type: "string" }, description: "Steps in the successful flow" },
            edgeCases: { type: "array", items: { type: "string" }, description: "Edge cases, error scenarios, alternative paths" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (linear flow, 3-5 steps, no branching), medium (some branching, 6-10 steps, 1-2 edge cases), hard (complex state machine, 10+ steps, multiple actors)" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (doesn't exist, must be built), modify (exists but needs changes), existing (mentioned but no work needed), unknown (unclear from PRD)" },
            evidence: { type: "string", description: "EXACT quote from the PRD that justifies this item. Must be verbatim text, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "How confident you are in this extraction: high (explicit in PRD), medium (implied), low (inferred)" },
          },
          required: ["actor", "goal", "preconditions", "happyPathSteps", "edgeCases", "complexity", "changeType", "evidence", "confidence"],
        },
      },
      uiSurfaces: {
        type: "array",
        description: "UI elements that need to be built (pages, modals, components).",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the UI element" },
            type: { type: "string", enum: ["page", "modal", "component", "widget"], description: "Type of UI surface" },
            states: { type: "array", items: { type: "string" }, description: "States to handle (loading, error, empty, success, etc.)" },
            interactions: { type: "array", items: { type: "string" }, description: "User interactions (click, hover, drag, form submit, etc.)" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (static content, 1-2 states, basic interactions), medium (form with validation, 3-4 states, conditional rendering), hard (data visualization, real-time updates, drag-and-drop, complex state)" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (doesn't exist), modify (exists but needs changes), existing (mentioned but no work needed), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this item. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit), medium (implied), low (inferred)" },
          },
          required: ["name", "type", "states", "interactions", "complexity", "changeType", "evidence", "confidence"],
        },
      },
      apiEndpoints: {
        type: "array",
        description: "API endpoints that need to be implemented.",
        items: {
          type: "object",
          properties: {
            route: { type: "string", description: "API route (e.g., '/api/users/:id')" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], description: "HTTP method" },
            requestShape: { type: "string", description: "Description of request body/params" },
            responseShape: { type: "string", description: "Description of response body" },
            errorCodes: { type: "array", items: { type: "string" }, description: "Error codes/statuses this endpoint returns" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (simple CRUD, single model, basic auth), medium (pagination, filtering, 2-3 models, input validation), hard (complex aggregation, transactions, rate limiting, caching)" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (doesn't exist), modify (exists but needs changes), existing (mentioned but no work needed), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this item. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit), medium (implied), low (inferred)" },
          },
          required: ["route", "method", "requestShape", "responseShape", "errorCodes", "complexity", "changeType", "evidence", "confidence"],
        },
      },
      entities: {
        type: "array",
        description: "Data entities (database tables/models) to create or modify.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Entity name (e.g., 'User', 'Order')" },
            fields: { type: "array", items: { type: "string" }, description: "Fields on the entity" },
            constraints: { type: "array", items: { type: "string" }, description: "Constraints (unique, not null, foreign key, etc.)" },
            relationships: { type: "array", items: { type: "string" }, description: "Relationships to other entities" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (1-5 fields, no relationships, simple types), medium (6-15 fields, 1-2 relationships, computed fields), hard (15+ fields, 3+ relationships, polymorphism, audit trail)" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (new table/model), modify (add/change fields), existing (mentioned but no schema changes), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this item. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit), medium (implied), low (inferred)" },
          },
          required: ["name", "fields", "constraints", "relationships", "complexity", "changeType", "evidence", "confidence"],
        },
      },
      integrations: {
        type: "array",
        description: "External system integrations required.",
        items: {
          type: "object",
          properties: {
            system: { type: "string", description: "External system name (e.g., 'Stripe', 'SendGrid', 'AWS S3')" },
            authMethod: { type: "string", description: "How to authenticate (API key, OAuth, etc.)" },
            failureModes: { type: "array", items: { type: "string" }, description: "Ways this integration can fail" },
            fallbackStrategy: { type: "string", description: "What to do when the integration fails" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (well-documented REST API, API key auth), medium (OAuth2 flow, multiple operations, webhooks), hard (legacy/SOAP, custom auth, retry logic, data transformation)" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (new integration to build), modify (change existing integration), existing (already integrated, just using it), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this item. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit), medium (implied), low (inferred)" },
          },
          required: ["system", "authMethod", "failureModes", "fallbackStrategy", "complexity", "changeType", "evidence", "confidence"],
        },
      },
      migrations: {
        type: "array",
        description: "Database schema changes, data migrations, or config changes required. Only include if there are actual schema/data changes needed.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["schema", "data", "config"], description: "Type of migration" },
            description: { type: "string", description: "What the migration does - must include specific schema verbs like 'add column', 'create table', etc." },
            rollbackPlan: { type: "string", description: "How to roll back if needed" },
            riskLevel: { type: "string", enum: ["low", "medium", "high"], description: "Risk level" },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (new migration), modify (update existing), existing (no migration needed), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this migration. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit schema change), medium (implied), low (inferred)" },
          },
          required: ["type", "description", "rollbackPlan", "riskLevel", "changeType", "evidence", "confidence"],
        },
      },
      nonFunctionals: {
        type: "array",
        description: "Non-functional requirements (performance, security, compliance, observability). Only include actionable requirements with measurable criteria.",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: ["performance", "security", "compliance", "observability", "accessibility"], description: "Category" },
            requirement: { type: "string", description: "The requirement" },
            acceptanceCriteria: { type: "string", description: "How to verify it's met - MUST be measurable (e.g., '< 200ms response time')" },
            complexity: { type: "string", enum: ["simple", "medium", "hard"], description: "Implementation complexity: simple (add logging, basic validation), medium (RBAC, performance benchmarking, alerting), hard (encryption at rest, SOC2 compliance, distributed tracing)" },
            actionable: { type: "boolean", description: "Whether this NFR has measurable criteria that can be verified. True if criteria includes specific metrics (e.g., '< 200ms'), false if vague (e.g., 'should be fast')." },
            changeType: { type: "string", enum: ["new", "modify", "existing", "unknown"], description: "Type of change: new (new requirement), modify (update existing), existing (already met), unknown (unclear)" },
            evidence: { type: "string", description: "EXACT quote from PRD justifying this item. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level: high (explicit), medium (implied), low (inferred)" },
          },
          required: ["category", "requirement", "acceptanceCriteria", "complexity", "actionable", "changeType", "evidence", "confidence"],
        },
      },
      unknowns: {
        type: "array",
        description: "Unclear aspects, open questions, or ambiguities in the PRD. Only mark as blocking if implementation truly cannot proceed.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question that needs answering" },
            impactArea: { type: "string", description: "What part of the system this affects" },
            blocking: { type: "boolean", description: "ONLY true if evidence contains TBD/unclear keywords AND work cannot proceed without an answer. Most questions are non-blocking." },
            evidence: { type: "string", description: "EXACT quote from PRD showing this is unclear. Must be verbatim, NOT paraphrased." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence this is truly an unknown: high (explicit TBD in PRD), medium (implied gap), low (nice-to-clarify)" },
          },
          required: ["question", "impactArea", "blocking", "evidence", "confidence"],
        },
      },
      subsystems: {
        type: "array",
        items: { type: "string" },
        description: "Subsystems/areas of the codebase this PRD touches (e.g., 'auth', 'billing', 'notifications', 'api', 'frontend', 'database')",
      },
      complexityFlags: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "oauth2_oidc",
            "cryptography",
            "real_time_sync",
            "distributed_transactions",
            "machine_learning",
            "financial_calculations",
            "file_processing",
            "search_indexing",
            "caching_strategy",
            "rate_limiting",
            "audit_logging",
            "multi_tenancy",
          ],
        },
        description: "Complexity flags indicating 'small but hard' patterns. Add these when the PRD involves intricate implementation even if scope seems small.",
      },
    },
    required: ["journeys", "uiSurfaces", "apiEndpoints", "entities", "integrations", "migrations", "nonFunctionals", "unknowns", "subsystems", "complexityFlags"],
  },
};

const INVENTORY_EXTRACTION_PROMPT = `You are a technical analyst extracting structured DELTA work inventory from a Product Requirements Document (PRD).

## YOUR TASK

Analyze the PRD below and extract work items that represent ACTUAL CHANGES - not everything mentioned.

**CRITICAL RULES:**
1. Only extract items that represent NEW work or MODIFICATIONS to existing code
2. Do NOT extract items that are "existing" infrastructure being used as-is
3. Every item MUST have evidence: an EXACT QUOTE from the PRD (not paraphrased)
4. Be CONSERVATIVE - when in doubt, use changeType: "existing" or omit the item

## DELTA EXTRACTION RULES (MANDATORY)

### changeType Field
Every item MUST have a changeType:
- **new**: Doesn't exist in the codebase, must be built from scratch
- **modify**: Exists but needs changes to support this PRD
- **existing**: Mentioned in PRD but no work needed (using existing infrastructure)
- **unknown**: Can't determine from PRD text

**IMPORTANT:** Items with changeType "existing" will NOT generate stories. Only extract them if they provide context.

### evidence Field
- MUST be an EXACT QUOTE from the PRD text
- NOT paraphrased or summarized
- If you can't find a direct quote, the item might not belong in the inventory

### confidence Field
- **high**: Directly stated in PRD (explicit requirement)
- **medium**: Implied by PRD requirements
- **low**: Inferred from context (may be over-extraction)

## EXTRACTION GUIDELINES

### Journeys (IMPORTANT: read carefully)
A **journey** is a complete user goal, NOT individual steps.
- "User can log in" = ONE journey (even though it has multiple steps)
- "User can reset password" = SEPARATE journey (different goal)
- "User can browse and purchase products" = TWO journeys (browse vs purchase are distinct goals)

**How to count journeys:**
- Each distinct ACTOR + GOAL combination = 1 journey
- If the same actor has multiple independent goals, they're separate journeys
- If steps are part of achieving one goal, they're ONE journey with multiple steps

**Examples:**
- PRD says "Users can sign up, log in, and manage profile" → 3 journeys (signup, login, profile)
- PRD says "Admin can create and edit products" → 1 journey (CRUD on products is one goal)
- PRD says "User can checkout (add to cart, enter shipping, pay)" → 1 journey (checkout is the goal)

### UI Surfaces
- Include all pages, modals, dialogs, and significant components
- Don't miss states: loading, error, empty, success, permission denied
- Include all user interactions: click, hover, submit, drag, etc.
- A "settings page" is ONE UI surface even if it has tabs

### API Endpoints
- Infer endpoints from UI requirements if not explicit
- Include standard error codes: 400, 401, 403, 404, 500
- If CRUD operations are implied, list all of them
- Each HTTP method + route = ONE endpoint (GET /users and POST /users = 2 endpoints)

### Entities
- Include all data models mentioned or implied
- Infer fields from UI and API requirements
- Include audit fields (createdAt, updatedAt) if the system uses them

### Integrations (BE CONSERVATIVE)
- Only include integrations that need NEW setup or MODIFICATIONS
- If using an existing integration (e.g., "upload to S3" when S3 is already set up), use changeType: "existing"
- Common existing integrations: S3, Cognito, Stripe, GitHub, Slack, PagerDuty, Jira
- Only NEW integrations (never used before) get changeType: "new"

### Migrations (ONLY IF SCHEMA CHANGES)
- ONLY include if there are actual schema changes needed
- If using existing tables/entities, do NOT add a migration
- Evidence MUST include schema verbs: "add column", "create table", "new field", etc.
- No schema change keywords in evidence = NO migration needed

### Non-Functionals (ONLY IF ACTIONABLE)
- ONLY include NFRs with measurable acceptance criteria
- "Should be fast" = NOT actionable (vague)
- "Response time < 200ms" = ACTIONABLE (measurable)
- Set actionable: true only for measurable requirements
- NFRs with actionable: false will NOT generate stories

### Unknowns (STRICT BLOCKING CRITERIA)
An unknown is **blocking** ONLY if:
1. The evidence contains TBD/unclear keywords like "TBD", "to be determined", "unclear", "pending decision"
2. AND implementation truly CANNOT proceed without an answer

**Blocking examples (evidence must contain TBD keywords):**
- "Auth provider: TBD" → blocking (explicit TBD)
- "Data retention: to be determined" → blocking (explicit uncertainty)

**Non-blocking examples (most questions):**
- "Should we add dark mode?" → non-blocking (can defer)
- "What color should the button be?" → non-blocking (design detail)
- "Should we add analytics tracking?" → non-blocking (can add later)
- "How should errors be displayed?" → non-blocking (implementation detail)

**IMPORTANT:** Most unknowns are NON-BLOCKING. Default to blocking: false unless evidence contains explicit TBD keywords.

### Subsystems
- List all areas of the codebase that will be touched
- Common subsystems: auth, api, frontend, database, notifications, billing, admin, reports

### Complexity Flags (for "small but hard" work)
Add these flags when the PRD involves intricate implementation patterns:
- **oauth2_oidc**: OAuth2/OIDC flows (token refresh, scopes, PKCE)
- **cryptography**: Encryption, signing, key management
- **real_time_sync**: WebSockets, SSE, live updates
- **distributed_transactions**: Sagas, 2PC, eventual consistency
- **machine_learning**: ML model integration or training
- **financial_calculations**: Money math, rounding, compliance
- **file_processing**: Large file uploads, streaming, parsing
- **search_indexing**: Full-text search, Elasticsearch
- **caching_strategy**: Multi-tier caching, invalidation logic
- **rate_limiting**: Throttling, quotas, abuse prevention
- **audit_logging**: Compliance audit trails (not just logging)
- **multi_tenancy**: Tenant isolation, data partitioning

### Per-Item Complexity Classification (REQUIRED)
Every item (journey, UI surface, API endpoint, entity, integration, non-functional) MUST have a complexity level:
- **simple**: Baseline effort, straightforward implementation
- **medium**: Moderate effort, some edge cases or state management
- **hard**: Significant effort, complex logic or coordination required

**Complexity Rubrics by Item Type:**

**Journeys:**
| simple | Linear flow, 3-5 steps, no branching, single actor |
| medium | Some branching, 6-10 steps, error handling, 1-2 edge cases |
| hard | Complex state machine, 10+ steps, multiple actors, many edge cases |

**UI Surfaces:**
| simple | Static content, 1-2 states, basic interactions |
| medium | Form with validation, 3-4 states, conditional rendering |
| hard | Data visualization, real-time updates, drag-and-drop, complex state |

**API Endpoints:**
| simple | Simple CRUD, single model, basic auth |
| medium | Pagination, filtering, 2-3 models, input validation |
| hard | Complex aggregation, transactions, rate limiting, caching |

**Entities:**
| simple | 1-5 fields, no relationships, simple types |
| medium | 6-15 fields, 1-2 relationships, computed fields |
| hard | 15+ fields, 3+ relationships, polymorphism, audit trail |

**Integrations:**
| simple | Well-documented REST API, API key auth |
| medium | OAuth2 flow, multiple operations, webhooks |
| hard | Legacy/SOAP, custom auth, retry logic, data transformation |

**Non-Functionals:**
| simple | Add logging, basic validation |
| medium | RBAC, performance benchmarking, alerting |
| hard | Encryption at rest, SOC2 compliance, distributed tracing |

**Note:** Migrations use their riskLevel field (low/medium/high) instead of complexity.

## CODEBASE CONTEXT

{{CODEBASE_CONTEXT}}

## PRD TO ANALYZE

**Summary:** {{SUMMARY}}

**Description:**
{{DESCRIPTION}}

Now call the extract_inventory tool with the complete inventory.`;

/**
 * Extract structured inventory from a PRD
 */
export async function extractInventory(
  summary: string,
  description: string,
  codebaseContext?: {
    fileTree?: string;
    readme?: string | null;
    techStack?: Record<string, unknown> | null;
  }
): Promise<PRDInventory> {
  const startTime = Date.now();

  // Build codebase context string
  let contextStr = "No codebase context available";
  if (codebaseContext) {
    const parts: string[] = [];
    if (codebaseContext.fileTree) {
      parts.push(`File Tree:\n\`\`\`\n${codebaseContext.fileTree.slice(0, 2000)}\n\`\`\``);
    }
    if (codebaseContext.readme) {
      parts.push(`README Summary:\n${codebaseContext.readme.slice(0, 1000)}`);
    }
    if (codebaseContext.techStack) {
      parts.push(`Tech Stack: ${JSON.stringify(codebaseContext.techStack).slice(0, 500)}`);
    }
    if (parts.length > 0) {
      contextStr = parts.join("\n\n");
    }
  }

  const prompt = INVENTORY_EXTRACTION_PROMPT
    .replace("{{SUMMARY}}", summary || "No summary provided")
    .replace("{{DESCRIPTION}}", description || "No description provided")
    .replace("{{CODEBASE_CONTEXT}}", contextStr);

  const anthropic = new Anthropic();

  try {
    const response = await anthropic.messages.create({
      model: INVENTORY_MODEL,
      max_tokens: 8192,
      temperature: 0, // Deterministic extraction
      tools: [INVENTORY_EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_inventory" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find(c => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Inventory extraction did not return tool_use response");
    }

    const raw = toolUse.input as Record<string, unknown>;

    // Map the raw response to our typed inventory
    const inventory: PRDInventory = {
      journeys: (raw.journeys as PRDJourney[]) || [],
      uiSurfaces: (raw.uiSurfaces as PRDUISurface[]) || [],
      apiEndpoints: (raw.apiEndpoints as PRDAPIEndpoint[]) || [],
      entities: (raw.entities as PRDEntity[]) || [],
      integrations: (raw.integrations as PRDIntegration[]) || [],
      migrations: (raw.migrations as PRDMigration[]) || [],
      nonFunctionals: (raw.nonFunctionals as PRDNonFunctional[]) || [],
      unknowns: (raw.unknowns as PRDUnknown[]) || [],
      subsystems: (raw.subsystems as string[]) || [],
      complexityFlags: (raw.complexityFlags as ComplexityFlag[]) || [],
      _metadata: {
        extractionModel: INVENTORY_MODEL,
        extractionDurationMs: Date.now() - startTime,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };

    // Validate: every journey should have at least one UI surface or API endpoint
    validateInventory(inventory);

    logger.info("Inventory extraction completed", {
      journeys: inventory.journeys.length,
      uiSurfaces: inventory.uiSurfaces.length,
      apiEndpoints: inventory.apiEndpoints.length,
      entities: inventory.entities.length,
      integrations: inventory.integrations.length,
      migrations: inventory.migrations.length,
      nonFunctionals: inventory.nonFunctionals.length,
      unknowns: inventory.unknowns.length,
      subsystems: inventory.subsystems.length,
      complexityFlags: inventory.complexityFlags.length,
      durationMs: inventory._metadata?.extractionDurationMs,
    });

    return inventory;
  } catch (error) {
    logger.error("Inventory extraction failed", { error, summary });
    throw error;
  }
}

/**
 * Validate and filter the extracted inventory using deterministic rules.
 * This applies post-extraction sanity checks to prevent over-extraction.
 */
export function validateInventory(inventory: PRDInventory): void {
  const originalCounts = {
    unknowns: inventory.unknowns.length,
    migrations: inventory.migrations.length,
    integrations: inventory.integrations.length,
    apiEndpoints: inventory.apiEndpoints.length,
    uiSurfaces: inventory.uiSurfaces.length,
  };

  // 1. Filter unknowns - only blocking if evidence contains TBD keywords
  filterUnknowns(inventory);

  // 2. Filter migrations - require schema change evidence
  filterMigrations(inventory);

  // 3. Filter integrations - mark existing ones appropriately
  filterIntegrations(inventory);

  // 4. Deduplicate API endpoints by method+route
  deduplicateEndpoints(inventory);

  // 5. Deduplicate UI surfaces by name
  deduplicateUISurfaces(inventory);

  // 6. Ensure subsystems is populated
  if (inventory.subsystems.length === 0) {
    const inferred: Set<string> = new Set();
    if (inventory.uiSurfaces.length > 0) inferred.add("frontend");
    if (inventory.apiEndpoints.length > 0) inferred.add("api");
    if (inventory.entities.length > 0) inferred.add("database");
    if (inventory.integrations.length > 0) inferred.add("integrations");
    if (inventory.migrations.length > 0) inferred.add("database");
    inventory.subsystems = Array.from(inferred);
  }

  // 7. Warn if we have journeys but no UI or API to support them
  if (inventory.journeys.length > 0 && inventory.uiSurfaces.length === 0 && inventory.apiEndpoints.length === 0) {
    logger.warn("Inventory has journeys but no UI surfaces or API endpoints", {
      journeyCount: inventory.journeys.length,
    });
  }

  // Log filtering results
  const filteredCounts = {
    unknowns: originalCounts.unknowns - inventory.unknowns.length,
    migrations: originalCounts.migrations - inventory.migrations.length,
    integrations: inventory.integrations.filter(i => i.changeType === "existing").length,
    apiEndpoints: originalCounts.apiEndpoints - inventory.apiEndpoints.length,
    uiSurfaces: originalCounts.uiSurfaces - inventory.uiSurfaces.length,
  };

  if (Object.values(filteredCounts).some(v => v > 0)) {
    logger.info("Inventory validation filtered items", {
      ...filteredCounts,
      remainingBlockingUnknowns: inventory.unknowns.filter(u => u.blocking).length,
    });
  }
}

/**
 * Filter unknowns - only truly blocking if evidence contains TBD keywords
 */
function filterUnknowns(inventory: PRDInventory): void {
  let blockingCount = 0;

  inventory.unknowns = inventory.unknowns.map(unknown => {
    const evidenceLower = (unknown.evidence || "").toLowerCase();
    const hasTBDKeyword = BLOCKING_UNKNOWN_KEYWORDS.some(kw => evidenceLower.includes(kw));

    // If marked as blocking but no TBD keyword, demote to non-blocking
    if (unknown.blocking && !hasTBDKeyword) {
      logger.debug("Demoting unknown to non-blocking (no TBD keyword)", {
        question: unknown.question.slice(0, 50),
      });
      return { ...unknown, blocking: false };
    }

    // Cap blocking unknowns
    if (unknown.blocking) {
      blockingCount++;
      if (blockingCount > MAX_TOTAL_BLOCKING_UNKNOWNS) {
        logger.debug("Capping blocking unknown", {
          question: unknown.question.slice(0, 50),
        });
        return { ...unknown, blocking: false };
      }
    }

    return unknown;
  });
}

/**
 * Filter migrations - remove if no schema change evidence
 */
function filterMigrations(inventory: PRDInventory): void {
  // Check if any entities actually need schema changes
  const hasEntityChanges = inventory.entities.some(
    e => e.changeType === "new" || e.changeType === "modify"
  );

  inventory.migrations = inventory.migrations.filter(migration => {
    const descLower = (migration.description || "").toLowerCase();
    const evidenceLower = (migration.evidence || "").toLowerCase();
    const combinedText = `${descLower} ${evidenceLower}`;

    // Check for schema change keywords
    const hasSchemaKeyword = SCHEMA_CHANGE_KEYWORDS.some(kw => combinedText.includes(kw));

    if (!hasSchemaKeyword && !hasEntityChanges) {
      logger.debug("Filtering migration (no schema evidence)", {
        description: migration.description.slice(0, 50),
      });
      return false;
    }

    return true;
  });
}

/**
 * Filter integrations - mark existing ones appropriately
 */
function filterIntegrations(inventory: PRDInventory): void {
  inventory.integrations = inventory.integrations.map(integration => {
    const systemLower = (integration.system || "").toLowerCase();

    // Check against existing integrations list
    const isKnownExisting = EXISTING_INTEGRATIONS.some(existing =>
      systemLower.includes(existing.toLowerCase())
    );

    if (isKnownExisting && integration.changeType === "new") {
      logger.debug("Marking integration as existing", {
        system: integration.system,
      });
      return { ...integration, changeType: "existing" as ChangeType };
    }

    return integration;
  });
}

/**
 * Deduplicate API endpoints by method + normalized route
 */
function deduplicateEndpoints(inventory: PRDInventory): void {
  const seen = new Set<string>();
  inventory.apiEndpoints = inventory.apiEndpoints.filter(endpoint => {
    // Normalize route (remove trailing slashes, standardize params)
    const normalizedRoute = endpoint.route
      .replace(/\/+$/, "")
      .replace(/:\w+/g, ":param")
      .toLowerCase();
    const key = `${endpoint.method}:${normalizedRoute}`;

    if (seen.has(key)) {
      logger.debug("Deduplicating endpoint", {
        method: endpoint.method,
        route: endpoint.route,
      });
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicate UI surfaces by normalized name
 */
function deduplicateUISurfaces(inventory: PRDInventory): void {
  const seen = new Set<string>();
  inventory.uiSurfaces = inventory.uiSurfaces.filter(surface => {
    const normalizedName = surface.name.toLowerCase().replace(/\s+/g, "-");
    if (seen.has(normalizedName)) {
      logger.debug("Deduplicating UI surface", {
        name: surface.name,
      });
      return false;
    }
    seen.add(normalizedName);
    return true;
  });
}

/**
 * Get a summary of the inventory for logging/display
 */
export function getInventorySummary(inventory: PRDInventory): string {
  const parts: string[] = [];

  if (inventory.journeys.length > 0) {
    parts.push(`${inventory.journeys.length} journey(s)`);
  }
  if (inventory.uiSurfaces.length > 0) {
    parts.push(`${inventory.uiSurfaces.length} UI surface(s)`);
  }
  if (inventory.apiEndpoints.length > 0) {
    parts.push(`${inventory.apiEndpoints.length} API endpoint(s)`);
  }
  if (inventory.entities.length > 0) {
    parts.push(`${inventory.entities.length} entit(ies)`);
  }
  if (inventory.integrations.length > 0) {
    parts.push(`${inventory.integrations.length} integration(s)`);
  }
  if (inventory.migrations.length > 0) {
    parts.push(`${inventory.migrations.length} migration(s)`);
  }
  if (inventory.nonFunctionals.length > 0) {
    parts.push(`${inventory.nonFunctionals.length} non-functional(s)`);
  }
  if (inventory.unknowns.length > 0) {
    const blocking = inventory.unknowns.filter(u => u.blocking).length;
    parts.push(`${inventory.unknowns.length} unknown(s) (${blocking} blocking)`);
  }
  if (inventory.complexityFlags.length > 0) {
    parts.push(`${inventory.complexityFlags.length} complexity flag(s)`);
  }

  return parts.join(", ");
}
