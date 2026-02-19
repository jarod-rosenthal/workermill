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

// ============================================================================
// ACTIONS - The Atomic Unit of Work (V5 Action Registry)
// ============================================================================

/**
 * Action types that map 1:1 to BDD "When" steps or API calls.
 * These are the atomic, testable units of work.
 */
export type ActionType =
  | "UI_INTERACTION"      // User clicks, types, selects, drags
  | "API_CALL"            // HTTP request/response
  | "SYSTEM_PROCESS"      // Validation, calculation, transformation
  | "DATA_MUTATION"       // Database write, state change
  | "INTEGRATION_CALL";   // External service call

/**
 * An atomic action extracted from the PRD.
 *
 * Actions are the fundamental unit of work that anchor story generation.
 * Each action should map 1:1 to a BDD "When" step or a single API call.
 *
 * Good actions: "User clicks Submit button", "API validates email format", "System generates JWT token"
 * Bad actions: "User registers" (too vague), "System handles data" (break down further)
 */
export interface PRDAction {
  /** Unique action identifier (ACT-01, ACT-02, etc.) */
  id: string;

  /** Atomic action description - should be a specific verb phrase */
  description: string;

  /** Type of action for categorization */
  type: ActionType;

  /** Source in the PRD where this action was found */
  source: string;

  /** Implementation complexity */
  complexity: ItemComplexity;

  /** Parent item this action was derived from (e.g., "journey:0", "endpoint:2") */
  sourceItemType: "journey" | "uiSurface" | "apiEndpoint" | "entity" | "integration" | "migration" | "nfr" | "expanded";
  sourceItemIndex: number;

  /** For expanded actions, the parent action ID (e.g., ACT-05 -> ACT-05a, ACT-05b) */
  parentActionId?: string;

  /** Subsystem this action touches */
  subsystem?: string;

  /** Whether this is an implicit/expanded action (not directly in PRD) */
  isImplicit: boolean;
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

  // =========================================================================
  // V5: ACTION REGISTRY - The atomic units of work
  // =========================================================================

  /**
   * Atomic actions flattened from all inventory items.
   * This is the canonical list that anchors story generation.
   * Actions are derived from journeys, endpoints, UI surfaces, etc.
   * Each action maps 1:1 to a BDD "When" step.
   */
  actions: PRDAction[];

  /**
   * Action count metrics for coverage validation
   */
  actionMetrics?: {
    /** Total actions extracted */
    total: number;
    /** Actions by type */
    byType: Record<ActionType, number>;
    /** Actions by source item type */
    bySource: Record<string, number>;
    /** Implicit/expanded actions count */
    implicitCount: number;
  };

  /** Raw extraction metadata */
  _metadata?: {
    extractionModel: string;
    extractionDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    /** V5: Action flattening metrics */
    actionFlatteningDurationMs?: number;
    actionExpanderRuns?: number;
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
const INVENTORY_MODEL = "claude-sonnet-4-6";

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

***REMOVED******REMOVED*** YOUR TASK

Analyze the PRD below and extract work items that represent ACTUAL CHANGES - not everything mentioned.

**CRITICAL RULES:**
1. Only extract items that represent NEW work or MODIFICATIONS to existing code
2. Do NOT extract items that are "existing" infrastructure being used as-is
3. Every item MUST have evidence: an EXACT QUOTE from the PRD (not paraphrased)
4. Be CONSERVATIVE - when in doubt, use changeType: "existing" or omit the item

***REMOVED******REMOVED*** DELTA EXTRACTION RULES (MANDATORY)

***REMOVED******REMOVED******REMOVED*** changeType Field
Every item MUST have a changeType:
- **new**: Doesn't exist in the codebase, must be built from scratch
- **modify**: Exists but needs changes to support this PRD
- **existing**: Mentioned in PRD but no work needed (using existing infrastructure)
- **unknown**: Can't determine from PRD text

**IMPORTANT:** Items with changeType "existing" will NOT generate stories. Only extract them if they provide context.

***REMOVED******REMOVED******REMOVED*** evidence Field
- MUST be an EXACT QUOTE from the PRD text
- NOT paraphrased or summarized
- If you can't find a direct quote, the item might not belong in the inventory

***REMOVED******REMOVED******REMOVED*** confidence Field
- **high**: Directly stated in PRD (explicit requirement)
- **medium**: Implied by PRD requirements
- **low**: Inferred from context (may be over-extraction)

***REMOVED******REMOVED*** EXTRACTION GUIDELINES

***REMOVED******REMOVED******REMOVED*** Journeys (IMPORTANT: read carefully)
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

***REMOVED******REMOVED******REMOVED*** UI Surfaces
- Include all pages, modals, dialogs, and significant components
- Don't miss states: loading, error, empty, success, permission denied
- Include all user interactions: click, hover, submit, drag, etc.
- A "settings page" is ONE UI surface even if it has tabs

***REMOVED******REMOVED******REMOVED*** API Endpoints
- Infer endpoints from UI requirements if not explicit
- Include standard error codes: 400, 401, 403, 404, 500
- If CRUD operations are implied, list all of them
- Each HTTP method + route = ONE endpoint (GET /users and POST /users = 2 endpoints)

***REMOVED******REMOVED******REMOVED*** Entities
- Include all data models mentioned or implied
- Infer fields from UI and API requirements
- Include audit fields (createdAt, updatedAt) if the system uses them

***REMOVED******REMOVED******REMOVED*** Integrations (BE CONSERVATIVE)
- Only include integrations that need NEW setup or MODIFICATIONS
- If using an existing integration (e.g., "upload to S3" when S3 is already set up), use changeType: "existing"
- Common existing integrations: S3, Cognito, Stripe, GitHub, Slack, PagerDuty, Jira
- Only NEW integrations (never used before) get changeType: "new"

***REMOVED******REMOVED******REMOVED*** Migrations (ONLY IF SCHEMA CHANGES)
- ONLY include if there are actual schema changes needed
- If using existing tables/entities, do NOT add a migration
- Evidence MUST include schema verbs: "add column", "create table", "new field", etc.
- No schema change keywords in evidence = NO migration needed

***REMOVED******REMOVED******REMOVED*** Non-Functionals (ONLY IF ACTIONABLE)
- ONLY include NFRs with measurable acceptance criteria
- "Should be fast" = NOT actionable (vague)
- "Response time < 200ms" = ACTIONABLE (measurable)
- Set actionable: true only for measurable requirements
- NFRs with actionable: false will NOT generate stories

***REMOVED******REMOVED******REMOVED*** Unknowns (STRICT BLOCKING CRITERIA)
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

***REMOVED******REMOVED******REMOVED*** Subsystems
- List all areas of the codebase that will be touched
- Common subsystems: auth, api, frontend, database, notifications, billing, admin, reports

***REMOVED******REMOVED******REMOVED*** Complexity Flags (for "small but hard" work)
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

***REMOVED******REMOVED******REMOVED*** Per-Item Complexity Classification (REQUIRED)
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

***REMOVED******REMOVED*** CODEBASE CONTEXT

{{CODEBASE_CONTEXT}}

***REMOVED******REMOVED*** PRD TO ANALYZE

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
      actions: [], // V5: Will be populated by enrichInventoryWithActions
      _metadata: {
        extractionModel: INVENTORY_MODEL,
        extractionDurationMs: Date.now() - startTime,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };

    // Validate: every journey should have at least one UI surface or API endpoint
    validateInventory(inventory);

    // V5: Flatten actions from inventory items (the atomic work units)
    enrichInventoryWithActions(inventory);

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
      actions: inventory.actions.length,
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
  // V5: Include action count
  if (inventory.actions?.length > 0) {
    parts.push(`${inventory.actions.length} action(s)`);
  }

  return parts.join(", ");
}

// ============================================================================
// V5: ACTION FLATTENER - Extract atomic actions from inventory items
// ============================================================================

/**
 * Patterns for expanding vague actions into atomic sub-actions.
 * Maps vague verb patterns to their atomic expansions.
 */
const ACTION_EXPANSION_PATTERNS: Record<string, { type: ActionType; description: string }[]> = {
  // Authentication patterns
  "log in": [
    { type: "UI_INTERACTION", description: "User enters email/username" },
    { type: "UI_INTERACTION", description: "User enters password" },
    { type: "UI_INTERACTION", description: "User clicks login button" },
    { type: "API_CALL", description: "API receives login request" },
    { type: "SYSTEM_PROCESS", description: "System validates credentials" },
    { type: "DATA_MUTATION", description: "System creates session/token" },
  ],
  "sign up": [
    { type: "UI_INTERACTION", description: "User enters registration details" },
    { type: "UI_INTERACTION", description: "User submits registration form" },
    { type: "API_CALL", description: "API receives registration request" },
    { type: "SYSTEM_PROCESS", description: "System validates email uniqueness" },
    { type: "SYSTEM_PROCESS", description: "System hashes password" },
    { type: "DATA_MUTATION", description: "System creates user record" },
  ],
  "register": [
    { type: "UI_INTERACTION", description: "User enters registration details" },
    { type: "UI_INTERACTION", description: "User submits registration form" },
    { type: "API_CALL", description: "API receives registration request" },
    { type: "SYSTEM_PROCESS", description: "System validates input" },
    { type: "DATA_MUTATION", description: "System creates new record" },
  ],
  "reset password": [
    { type: "UI_INTERACTION", description: "User enters email for reset" },
    { type: "UI_INTERACTION", description: "User clicks reset button" },
    { type: "API_CALL", description: "API receives reset request" },
    { type: "SYSTEM_PROCESS", description: "System generates reset token" },
    { type: "INTEGRATION_CALL", description: "System sends reset email" },
  ],
  // CRUD patterns
  "create": [
    { type: "UI_INTERACTION", description: "User fills creation form" },
    { type: "UI_INTERACTION", description: "User clicks submit" },
    { type: "API_CALL", description: "API receives create request" },
    { type: "SYSTEM_PROCESS", description: "System validates input" },
    { type: "DATA_MUTATION", description: "System persists new record" },
  ],
  "update": [
    { type: "UI_INTERACTION", description: "User modifies form fields" },
    { type: "UI_INTERACTION", description: "User clicks save" },
    { type: "API_CALL", description: "API receives update request" },
    { type: "SYSTEM_PROCESS", description: "System validates changes" },
    { type: "DATA_MUTATION", description: "System updates record" },
  ],
  "delete": [
    { type: "UI_INTERACTION", description: "User clicks delete" },
    { type: "UI_INTERACTION", description: "User confirms deletion" },
    { type: "API_CALL", description: "API receives delete request" },
    { type: "SYSTEM_PROCESS", description: "System checks permissions" },
    { type: "DATA_MUTATION", description: "System removes record" },
  ],
  // Search/Filter patterns
  "search": [
    { type: "UI_INTERACTION", description: "User enters search query" },
    { type: "UI_INTERACTION", description: "User submits search" },
    { type: "API_CALL", description: "API receives search request" },
    { type: "SYSTEM_PROCESS", description: "System executes query" },
  ],
  "filter": [
    { type: "UI_INTERACTION", description: "User selects filter criteria" },
    { type: "API_CALL", description: "API receives filter request" },
    { type: "SYSTEM_PROCESS", description: "System applies filters" },
  ],
  // Payment patterns
  "checkout": [
    { type: "UI_INTERACTION", description: "User reviews cart" },
    { type: "UI_INTERACTION", description: "User enters payment details" },
    { type: "UI_INTERACTION", description: "User confirms purchase" },
    { type: "API_CALL", description: "API receives checkout request" },
    { type: "INTEGRATION_CALL", description: "System processes payment" },
    { type: "DATA_MUTATION", description: "System creates order record" },
  ],
  "pay": [
    { type: "UI_INTERACTION", description: "User enters payment details" },
    { type: "UI_INTERACTION", description: "User confirms payment" },
    { type: "API_CALL", description: "API receives payment request" },
    { type: "INTEGRATION_CALL", description: "System processes payment" },
    { type: "DATA_MUTATION", description: "System records transaction" },
  ],
  // Upload patterns
  "upload": [
    { type: "UI_INTERACTION", description: "User selects file" },
    { type: "UI_INTERACTION", description: "User initiates upload" },
    { type: "API_CALL", description: "API receives file" },
    { type: "SYSTEM_PROCESS", description: "System validates file" },
    { type: "DATA_MUTATION", description: "System stores file" },
  ],
  // Notification patterns
  "notify": [
    { type: "SYSTEM_PROCESS", description: "System prepares notification" },
    { type: "INTEGRATION_CALL", description: "System sends notification" },
  ],
  "send email": [
    { type: "SYSTEM_PROCESS", description: "System renders email template" },
    { type: "INTEGRATION_CALL", description: "System sends email via provider" },
  ],
};

/**
 * Flatten inventory items into atomic actions.
 * This is the core of the V5 action registry system.
 *
 * Actions are extracted from:
 * - Journey steps (happyPathSteps, edgeCases)
 * - API endpoints (each endpoint = API_CALL action)
 * - UI surfaces (each interaction = UI_INTERACTION action)
 * - Entities with changeType new/modify (each = DATA_MUTATION action)
 * - Integrations (each = INTEGRATION_CALL action)
 * - Migrations (each = DATA_MUTATION action)
 */
export function flattenActionsFromInventory(inventory: PRDInventory): PRDAction[] {
  const actions: PRDAction[] = [];
  let actionIndex = 0;

  const createActionId = () => `ACT-${String(actionIndex++).padStart(2, "0")}`;

  // Extract actions from journeys
  inventory.journeys.forEach((journey, journeyIdx) => {
    // Only process journeys that represent real work
    if (journey.changeType === "existing") return;

    // Each happy path step is an action
    journey.happyPathSteps.forEach((step, stepIdx) => {
      const actionType = inferActionType(step);
      actions.push({
        id: createActionId(),
        description: step,
        type: actionType,
        source: `Journey ${journeyIdx + 1}: ${journey.goal}`,
        complexity: journey.complexity || "medium",
        sourceItemType: "journey",
        sourceItemIndex: journeyIdx,
        subsystem: inferSubsystem(step, actionType),
        isImplicit: false,
      });
    });

    // Each edge case is an action (typically SYSTEM_PROCESS for error handling)
    journey.edgeCases.forEach((edgeCase) => {
      actions.push({
        id: createActionId(),
        description: `Handle: ${edgeCase}`,
        type: "SYSTEM_PROCESS",
        source: `Journey ${journeyIdx + 1}: ${journey.goal} (edge case)`,
        complexity: "medium",
        sourceItemType: "journey",
        sourceItemIndex: journeyIdx,
        subsystem: "error-handling",
        isImplicit: false,
      });
    });
  });

  // Extract actions from API endpoints
  inventory.apiEndpoints.forEach((endpoint, endpointIdx) => {
    if (endpoint.changeType === "existing") return;

    // The endpoint itself is an API_CALL action
    actions.push({
      id: createActionId(),
      description: `${endpoint.method} ${endpoint.route}`,
      type: "API_CALL",
      source: `API Endpoint: ${endpoint.method} ${endpoint.route}`,
      complexity: endpoint.complexity || "medium",
      sourceItemType: "apiEndpoint",
      sourceItemIndex: endpointIdx,
      subsystem: "api",
      isImplicit: false,
    });

    // Add validation action if request has params
    if (endpoint.requestShape && endpoint.requestShape !== "none") {
      actions.push({
        id: createActionId(),
        description: `Validate request for ${endpoint.method} ${endpoint.route}`,
        type: "SYSTEM_PROCESS",
        source: `API Endpoint: ${endpoint.method} ${endpoint.route}`,
        complexity: "simple",
        sourceItemType: "apiEndpoint",
        sourceItemIndex: endpointIdx,
        subsystem: "api",
        isImplicit: true,
      });
    }
  });

  // Extract actions from UI surfaces
  inventory.uiSurfaces.forEach((surface, surfaceIdx) => {
    if (surface.changeType === "existing") return;

    // Each interaction is a UI_INTERACTION action
    surface.interactions.forEach((interaction) => {
      actions.push({
        id: createActionId(),
        description: `${surface.name}: ${interaction}`,
        type: "UI_INTERACTION",
        source: `UI Surface: ${surface.name}`,
        complexity: surface.complexity || "medium",
        sourceItemType: "uiSurface",
        sourceItemIndex: surfaceIdx,
        subsystem: "frontend",
        isImplicit: false,
      });
    });

    // Each state is an implicit render action
    surface.states.forEach((state) => {
      actions.push({
        id: createActionId(),
        description: `${surface.name}: Render ${state} state`,
        type: "UI_INTERACTION",
        source: `UI Surface: ${surface.name}`,
        complexity: "simple",
        sourceItemType: "uiSurface",
        sourceItemIndex: surfaceIdx,
        subsystem: "frontend",
        isImplicit: true,
      });
    });
  });

  // Extract actions from entities (schema changes)
  inventory.entities.forEach((entity, entityIdx) => {
    if (entity.changeType !== "new" && entity.changeType !== "modify") return;

    const actionDesc = entity.changeType === "new"
      ? `Create ${entity.name} entity schema`
      : `Modify ${entity.name} entity schema`;

    actions.push({
      id: createActionId(),
      description: actionDesc,
      type: "DATA_MUTATION",
      source: `Entity: ${entity.name}`,
      complexity: entity.complexity || "medium",
      sourceItemType: "entity",
      sourceItemIndex: entityIdx,
      subsystem: "database",
      isImplicit: false,
    });
  });

  // Extract actions from integrations
  inventory.integrations.forEach((integration, integrationIdx) => {
    if (integration.changeType === "existing") return;

    actions.push({
      id: createActionId(),
      description: `Integrate with ${integration.system}`,
      type: "INTEGRATION_CALL",
      source: `Integration: ${integration.system}`,
      complexity: integration.complexity || "hard",
      sourceItemType: "integration",
      sourceItemIndex: integrationIdx,
      subsystem: "integrations",
      isImplicit: false,
    });

    // Add auth setup action if needed
    if (integration.authMethod && integration.authMethod !== "none") {
      actions.push({
        id: createActionId(),
        description: `Configure ${integration.authMethod} auth for ${integration.system}`,
        type: "SYSTEM_PROCESS",
        source: `Integration: ${integration.system}`,
        complexity: "medium",
        sourceItemType: "integration",
        sourceItemIndex: integrationIdx,
        subsystem: "integrations",
        isImplicit: true,
      });
    }
  });

  // Extract actions from migrations
  inventory.migrations.forEach((migration, migrationIdx) => {
    if (migration.changeType === "existing") return;

    actions.push({
      id: createActionId(),
      description: migration.description,
      type: "DATA_MUTATION",
      source: `Migration: ${migration.type}`,
      complexity: migration.riskLevel === "high" ? "hard" : migration.riskLevel === "medium" ? "medium" : "simple",
      sourceItemType: "migration",
      sourceItemIndex: migrationIdx,
      subsystem: "database",
      isImplicit: false,
    });
  });

  // Extract actions from actionable NFRs
  inventory.nonFunctionals.forEach((nfr, nfrIdx) => {
    if (!nfr.actionable || nfr.changeType === "existing") return;

    actions.push({
      id: createActionId(),
      description: `Implement: ${nfr.requirement}`,
      type: "SYSTEM_PROCESS",
      source: `NFR: ${nfr.category}`,
      complexity: nfr.complexity || "medium",
      sourceItemType: "nfr",
      sourceItemIndex: nfrIdx,
      subsystem: nfr.category,
      isImplicit: false,
    });
  });

  logger.info("Actions flattened from inventory", {
    totalActions: actions.length,
    fromJourneys: actions.filter(a => a.sourceItemType === "journey").length,
    fromEndpoints: actions.filter(a => a.sourceItemType === "apiEndpoint").length,
    fromUISurfaces: actions.filter(a => a.sourceItemType === "uiSurface").length,
    fromEntities: actions.filter(a => a.sourceItemType === "entity").length,
    fromIntegrations: actions.filter(a => a.sourceItemType === "integration").length,
    fromMigrations: actions.filter(a => a.sourceItemType === "migration").length,
    fromNFRs: actions.filter(a => a.sourceItemType === "nfr").length,
    implicitActions: actions.filter(a => a.isImplicit).length,
  });

  return actions;
}

/**
 * Infer action type from description text
 */
function inferActionType(description: string): ActionType {
  const descLower = description.toLowerCase();

  // UI interaction patterns
  if (/\b(click|tap|press|select|enter|type|drag|drop|scroll|hover|focus|submit|toggle)\b/.test(descLower)) {
    return "UI_INTERACTION";
  }

  // API call patterns
  if (/\b(api|endpoint|request|response|fetch|get|post|put|delete|patch|call)\b/.test(descLower)) {
    return "API_CALL";
  }

  // Data mutation patterns
  if (/\b(create|insert|update|delete|save|store|persist|write|modify|remove)\b/.test(descLower)) {
    return "DATA_MUTATION";
  }

  // Integration patterns
  if (/\b(send|email|sms|notification|webhook|external|third.party|integrate)\b/.test(descLower)) {
    return "INTEGRATION_CALL";
  }

  // Default to system process
  return "SYSTEM_PROCESS";
}

/**
 * Infer subsystem from action description and type
 */
function inferSubsystem(description: string, actionType: ActionType): string {
  const descLower = description.toLowerCase();

  if (actionType === "UI_INTERACTION") return "frontend";
  if (actionType === "API_CALL") return "api";
  if (actionType === "INTEGRATION_CALL") return "integrations";

  if (/\b(database|db|table|record|entity|schema)\b/.test(descLower)) return "database";
  if (/\b(auth|login|password|token|session)\b/.test(descLower)) return "auth";
  if (/\b(email|notification|sms)\b/.test(descLower)) return "notifications";
  if (/\b(payment|billing|charge|invoice)\b/.test(descLower)) return "billing";

  return "core";
}

/**
 * Expand vague actions into atomic sub-actions.
 * This is the "Implicit Action Expander" that fills gaps.
 *
 * Input: [ACT-05] User logs in
 * Output: [ACT-05a] Enter creds, [ACT-05b] Click login, [ACT-05c] Validate, [ACT-05d] Create token
 */
export function expandVagueActions(actions: PRDAction[]): PRDAction[] {
  const expandedActions: PRDAction[] = [];
  let expansionCount = 0;

  for (const action of actions) {
    const descLower = action.description.toLowerCase();

    // Check if this action matches an expansion pattern
    let expanded = false;
    for (const [pattern, expansions] of Object.entries(ACTION_EXPANSION_PATTERNS)) {
      if (descLower.includes(pattern)) {
        // Add the expanded sub-actions
        expansions.forEach((expansion, idx) => {
          const subId = `${action.id}${String.fromCharCode(97 + idx)}`; // ACT-05a, ACT-05b, etc.
          expandedActions.push({
            id: subId,
            description: expansion.description,
            type: expansion.type,
            source: action.source,
            complexity: action.complexity,
            sourceItemType: "expanded",
            sourceItemIndex: -1,
            parentActionId: action.id,
            subsystem: inferSubsystem(expansion.description, expansion.type),
            isImplicit: true,
          });
        });
        expanded = true;
        expansionCount++;
        break;
      }
    }

    // If not expanded, keep the original action
    if (!expanded) {
      expandedActions.push(action);
    }
  }

  if (expansionCount > 0) {
    logger.info("Vague actions expanded", {
      originalCount: actions.length,
      expandedCount: expandedActions.length,
      expansionsApplied: expansionCount,
    });
  }

  return expandedActions;
}

/**
 * Compute action metrics for the inventory
 */
export function computeActionMetrics(actions: PRDAction[]): PRDInventory["actionMetrics"] {
  const byType: Record<ActionType, number> = {
    UI_INTERACTION: 0,
    API_CALL: 0,
    SYSTEM_PROCESS: 0,
    DATA_MUTATION: 0,
    INTEGRATION_CALL: 0,
  };

  const bySource: Record<string, number> = {};
  let implicitCount = 0;

  for (const action of actions) {
    byType[action.type]++;

    const sourceKey = action.sourceItemType;
    bySource[sourceKey] = (bySource[sourceKey] || 0) + 1;

    if (action.isImplicit) {
      implicitCount++;
    }
  }

  return {
    total: actions.length,
    byType,
    bySource,
    implicitCount,
  };
}

/**
 * Process inventory to add flattened actions.
 * This should be called after extractInventory and validateInventory.
 */
export function enrichInventoryWithActions(inventory: PRDInventory): PRDInventory {
  const startTime = Date.now();

  // Step 1: Flatten actions from inventory items
  let actions = flattenActionsFromInventory(inventory);

  // Step 2: Expand vague actions into atomic sub-actions
  actions = expandVagueActions(actions);

  // Step 3: Compute metrics
  const actionMetrics = computeActionMetrics(actions);

  // Update inventory
  inventory.actions = actions;
  inventory.actionMetrics = actionMetrics;

  // Update metadata
  if (inventory._metadata) {
    inventory._metadata.actionFlatteningDurationMs = Date.now() - startTime;
    inventory._metadata.actionExpanderRuns = 1;
  }

  logger.info("Inventory enriched with actions", {
    totalActions: actions.length,
    metrics: actionMetrics,
    durationMs: Date.now() - startTime,
  });

  return inventory;
}

// ============================================================================
// V5 COVERAGE VALIDATOR - Action-to-Story Ratio Checks
// ============================================================================

/**
 * Thresholds for action-to-story ratios.
 * Ratios outside these bounds trigger warnings/errors.
 */
export const COVERAGE_THRESHOLDS = {
  /** Ideal actions per story (target) */
  IDEAL_RATIO: 4,
  /** Minimum actions per story (below = story too granular) */
  MIN_RATIO: 2,
  /** Maximum actions per story (above = monolith story) */
  MAX_RATIO: 8,
  /** Danger threshold - story is way too big */
  DANGER_RATIO: 15,
};

/**
 * Result of coverage validation for a single story
 */
export interface StoryCoverageCheck {
  storyTitle: string;
  storyIndex: number;
  themeId: string;
  coveredActionCount: number;
  ratio: number;
  status: "healthy" | "too_granular" | "too_large" | "monolith";
  message: string;
}

/**
 * Result of coverage validation for the entire plan
 */
export interface PlanCoverageReport {
  /** Total actions in the inventory */
  totalActions: number;
  /** Total stories in the plan */
  totalStories: number;
  /** Overall action-to-story ratio */
  overallRatio: number;
  /** Actions covered by at least one story */
  coveredActionCount: number;
  /** Coverage percentage (0-100) */
  coveragePercent: number;
  /** Actions not covered by any story */
  uncoveredActions: string[];
  /** Actions covered by multiple stories (should be 0) */
  duplicateCoverage: string[];
  /** Per-story coverage checks */
  storyChecks: StoryCoverageCheck[];
  /** Overall health assessment */
  health: "healthy" | "warning" | "unhealthy";
  /** Summary message */
  summary: string;
  /** Detailed issues found */
  issues: string[];
  /** Recommendations for improvement */
  recommendations: string[];
}

/**
 * Validate action coverage across the entire execution plan.
 * Ensures all actions are covered and ratios are healthy.
 *
 * Thresholds are DYNAMIC based on the target story count:
 * - expectedRatio = totalActions / targetStories (what we expect)
 * - Thresholds are relative to this expected ratio
 *
 * @param actions - All actions from the inventory
 * @param stories - All stories from the plan (with coveredActionIds)
 * @param targetStories - Target story count from complexity scorer (optional, defaults to actual story count)
 * @returns Coverage report with health assessment
 */
export function validatePlanCoverage(
  actions: PRDAction[],
  stories: Array<{
    title: string;
    index: number;
    themeId: string;
    coveredActionIds?: string[];
  }>,
  targetStories?: number
): PlanCoverageReport {
  const allActionIds = new Set(actions.map((a) => a.id));
  const coveredActionIds = new Set<string>();
  const duplicates: string[] = [];
  const storyChecks: StoryCoverageCheck[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Calculate DYNAMIC thresholds based on target story count
  // If target is 4 stories and 160 actions, expected is 40 actions/story
  // We shouldn't flag that as "monolith" since it matches the target
  const effectiveTarget = targetStories || stories.length;
  const expectedRatio = actions.length > 0 && effectiveTarget > 0
    ? Math.ceil(actions.length / effectiveTarget)
    : COVERAGE_THRESHOLDS.IDEAL_RATIO;

  // Dynamic thresholds relative to expected ratio
  // Allow 50% variance before warning, 100% before danger
  const dynamicThresholds = {
    ideal: expectedRatio,
    min: Math.max(1, Math.floor(expectedRatio * 0.5)),  // 50% below expected
    max: Math.ceil(expectedRatio * 1.5),                 // 50% above expected
    danger: Math.ceil(expectedRatio * 2.0),              // 100% above expected
  };

  // Process each story
  for (const story of stories) {
    const covered = story.coveredActionIds || [];
    let validCoverage = 0;

    for (const actionId of covered) {
      if (!allActionIds.has(actionId)) {
        issues.push(`Story "${story.title}" references unknown action: ${actionId}`);
        continue;
      }
      if (coveredActionIds.has(actionId)) {
        duplicates.push(actionId);
        issues.push(`Action ${actionId} covered by multiple stories (including "${story.title}")`);
      } else {
        coveredActionIds.add(actionId);
        validCoverage++;
      }
    }

    // Calculate ratio and status using DYNAMIC thresholds
    const ratio = validCoverage;
    let status: StoryCoverageCheck["status"] = "healthy";
    let message = `${validCoverage} actions - good size (expected ~${expectedRatio})`;

    if (ratio >= dynamicThresholds.danger) {
      status = "monolith";
      message = `DANGER: ${validCoverage} actions is way above expected ~${expectedRatio}. Consider splitting.`;
      issues.push(`Monolith story detected: "${story.title}" with ${validCoverage} actions (expected ~${expectedRatio})`);
    } else if (ratio > dynamicThresholds.max) {
      status = "too_large";
      message = `Warning: ${validCoverage} actions is above expected ~${expectedRatio}. Consider splitting.`;
      issues.push(`Large story: "${story.title}" with ${validCoverage} actions (expected ~${expectedRatio})`);
    } else if (ratio < dynamicThresholds.min && ratio > 0) {
      status = "too_granular";
      message = `${validCoverage} actions may be too granular (expected ~${expectedRatio}). Consider merging.`;
    }

    storyChecks.push({
      storyTitle: story.title,
      storyIndex: story.index,
      themeId: story.themeId,
      coveredActionCount: validCoverage,
      ratio,
      status,
      message,
    });
  }

  // Find uncovered actions
  const uncovered = actions.filter((a) => !coveredActionIds.has(a.id)).map((a) => a.id);

  // Calculate overall metrics
  const totalActions = actions.length;
  const totalStories = stories.length;
  const overallRatio = totalStories > 0 ? totalActions / totalStories : 0;
  const coveragePercent =
    totalActions > 0 ? Math.round((coveredActionIds.size / totalActions) * 100) : 100;

  // Determine overall health
  let health: PlanCoverageReport["health"] = "healthy";
  if (coveragePercent < 100 || duplicates.length > 0) {
    health = "unhealthy";
  } else if (storyChecks.some((c) => c.status === "monolith" || c.status === "too_large")) {
    health = "warning";
  }

  // Generate recommendations
  if (uncovered.length > 0) {
    recommendations.push(
      `${uncovered.length} actions are not covered. Assign them to stories or create new stories.`
    );
  }
  if (duplicates.length > 0) {
    recommendations.push(
      `${duplicates.length} actions are covered by multiple stories. Each action should be in exactly one story.`
    );
  }
  const monolithCount = storyChecks.filter((c) => c.status === "monolith").length;
  if (monolithCount > 0) {
    recommendations.push(
      `${monolithCount} monolith stories detected. Split them into smaller stories (aim for ~${expectedRatio} actions each).`
    );
  }
  const tooLargeCount = storyChecks.filter((c) => c.status === "too_large").length;
  if (tooLargeCount > 0) {
    recommendations.push(
      `${tooLargeCount} stories are too large. Consider splitting them.`
    );
  }

  // Generate summary
  let summary = `Coverage: ${coveragePercent}% (${coveredActionIds.size}/${totalActions} actions)`;
  summary += ` | Ratio: ${overallRatio.toFixed(1)} actions/story`;
  if (health === "healthy") {
    summary += " | ✓ All actions covered with healthy ratios";
  } else if (health === "warning") {
    summary += " | ⚠ Some stories need attention";
  } else {
    summary += " | ✗ Coverage issues found";
  }

  return {
    totalActions,
    totalStories,
    overallRatio,
    coveredActionCount: coveredActionIds.size,
    coveragePercent,
    uncoveredActions: uncovered,
    duplicateCoverage: duplicates,
    storyChecks,
    health,
    summary,
    issues,
    recommendations,
  };
}

/**
 * Generate a visual coverage heatmap for debugging.
 * Shows action coverage by theme and story.
 *
 * @param actions - All actions from the inventory
 * @param stories - All stories from the plan
 * @param themes - All themes from the plan
 * @param targetStories - Target story count (for dynamic threshold calculation)
 */
export function generateCoverageHeatmap(
  actions: PRDAction[],
  stories: Array<{
    title: string;
    index: number;
    themeId: string;
    coveredActionIds?: string[];
  }>,
  themes: Array<{
    id: string;
    name: string;
    ownedActionIds?: string[];
  }>,
  targetStories?: number
): string {
  const lines: string[] = [];
  lines.push("=".repeat(80));
  lines.push("ACTION COVERAGE HEATMAP (V5)");
  lines.push("=".repeat(80));
  lines.push("");

  // Build story-to-actions map
  const storyToActions = new Map<number, Set<string>>();
  for (const story of stories) {
    storyToActions.set(story.index, new Set(story.coveredActionIds || []));
  }

  // Build action-to-stories map (for duplicate detection)
  const actionToStories = new Map<string, number[]>();
  for (const story of stories) {
    for (const actionId of story.coveredActionIds || []) {
      if (!actionToStories.has(actionId)) {
        actionToStories.set(actionId, []);
      }
      actionToStories.get(actionId)!.push(story.index);
    }
  }

  // Group by theme
  for (const theme of themes) {
    lines.push(`\n***REMOVED******REMOVED*** Theme: ${theme.id} - ${theme.name}`);
    lines.push("-".repeat(60));

    const themeActions = (theme.ownedActionIds || []).map((id) =>
      actions.find((a) => a.id === id)
    ).filter((a): a is PRDAction => a !== undefined);

    if (themeActions.length === 0) {
      lines.push("  (no actions)");
      continue;
    }

    // Find stories for this theme
    const themeStories = stories.filter((s) => s.themeId === theme.id);

    for (const action of themeActions) {
      const coveredBy = actionToStories.get(action.id) || [];
      let status = "❌ UNCOVERED";
      if (coveredBy.length === 1) {
        const story = stories.find((s) => s.index === coveredBy[0]);
        status = `✓ Story ${coveredBy[0]}: ${story?.title?.slice(0, 30) || "?"}`;
      } else if (coveredBy.length > 1) {
        status = `⚠ DUPLICATE (stories: ${coveredBy.join(", ")})`;
      }

      lines.push(`  ${action.id} [${action.type}] ${action.description.slice(0, 40)}`);
      lines.push(`      → ${status}`);
    }

    // Story summary for theme
    lines.push("");
    lines.push(`  Stories in theme: ${themeStories.length}`);

    // Calculate dynamic thresholds based on target story count
    const effectiveTarget = targetStories || stories.length;
    const expectedRatio = actions.length > 0 && effectiveTarget > 0
      ? Math.ceil(actions.length / effectiveTarget)
      : COVERAGE_THRESHOLDS.IDEAL_RATIO;
    const dynamicMaxRatio = Math.ceil(expectedRatio * 1.5);
    const dynamicDangerRatio = Math.ceil(expectedRatio * 2.0);

    for (const story of themeStories) {
      const coveredCount = (story.coveredActionIds || []).length;
      const ratio = coveredCount;
      let indicator = "✓";
      if (ratio > dynamicMaxRatio) indicator = "⚠";
      if (ratio >= dynamicDangerRatio) indicator = "🔥";
      lines.push(
        `    ${indicator} Story ${story.index}: "${story.title.slice(0, 35)}" (${coveredCount} actions)`
      );
    }
  }

  lines.push("");
  lines.push("=".repeat(80));
  lines.push("Legend: ✓ = healthy | ⚠ = warning | 🔥 = danger | ❌ = uncovered");
  lines.push("=".repeat(80));

  return lines.join("\n");
}
