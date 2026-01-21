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
 * A user journey extracted from the PRD
 */
export interface PRDJourney {
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
}

/**
 * A UI surface (page, modal, component) that needs to be built
 */
export interface PRDUISurface {
  /** Name of the UI element */
  name: string;
  /** Type of UI surface */
  type: "page" | "modal" | "component" | "widget";
  /** States the UI needs to handle */
  states: string[];
  /** User interactions supported */
  interactions: string[];
}

/**
 * An API endpoint that needs to be implemented
 */
export interface PRDAPIEndpoint {
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
}

/**
 * A data entity (model/table) that needs to be created or modified
 */
export interface PRDEntity {
  /** Entity name (e.g., "User", "Order") */
  name: string;
  /** Fields on the entity */
  fields: string[];
  /** Constraints (unique, not null, etc.) */
  constraints: string[];
  /** Relationships to other entities */
  relationships: string[];
}

/**
 * An external integration that needs to be implemented
 */
export interface PRDIntegration {
  /** External system name (e.g., "Stripe", "SendGrid") */
  system: string;
  /** Authentication method */
  authMethod: string;
  /** Ways the integration can fail */
  failureModes: string[];
  /** What to do when integration fails */
  fallbackStrategy: string;
}

/**
 * A migration that needs to be run
 */
export interface PRDMigration {
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
export interface PRDNonFunctional {
  /** Category of the requirement */
  category: "performance" | "security" | "compliance" | "observability" | "accessibility";
  /** The requirement */
  requirement: string;
  /** How to verify it's met */
  acceptanceCriteria: string;
}

/**
 * An unknown or unclear aspect of the PRD
 */
export interface PRDUnknown {
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
          },
          required: ["actor", "goal", "preconditions", "happyPathSteps", "edgeCases"],
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
          },
          required: ["name", "type", "states", "interactions"],
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
          },
          required: ["route", "method", "requestShape", "responseShape", "errorCodes"],
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
          },
          required: ["name", "fields", "constraints", "relationships"],
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
          },
          required: ["system", "authMethod", "failureModes", "fallbackStrategy"],
        },
      },
      migrations: {
        type: "array",
        description: "Database schema changes, data migrations, or config changes required.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["schema", "data", "config"], description: "Type of migration" },
            description: { type: "string", description: "What the migration does" },
            rollbackPlan: { type: "string", description: "How to roll back if needed" },
            riskLevel: { type: "string", enum: ["low", "medium", "high"], description: "Risk level" },
          },
          required: ["type", "description", "rollbackPlan", "riskLevel"],
        },
      },
      nonFunctionals: {
        type: "array",
        description: "Non-functional requirements (performance, security, compliance, observability).",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: ["performance", "security", "compliance", "observability", "accessibility"], description: "Category" },
            requirement: { type: "string", description: "The requirement" },
            acceptanceCriteria: { type: "string", description: "How to verify it's met" },
          },
          required: ["category", "requirement", "acceptanceCriteria"],
        },
      },
      unknowns: {
        type: "array",
        description: "Unclear aspects, open questions, or ambiguities in the PRD.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question that needs answering" },
            impactArea: { type: "string", description: "What part of the system this affects" },
            blocking: { type: "boolean", description: "Whether implementation is blocked until this is resolved" },
          },
          required: ["question", "impactArea", "blocking"],
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

const INVENTORY_EXTRACTION_PROMPT = `You are a technical analyst extracting structured work inventory from a Product Requirements Document (PRD).

## YOUR TASK

Analyze the PRD below and extract ALL work items into a structured inventory. Be EXHAUSTIVE:
- If something is implied but not explicit, include it with appropriate flags
- If you're unsure about something, add it to the "unknowns" list
- Every journey should have at least one corresponding UI surface OR API endpoint

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

### Integrations
- Any external service mentioned (payment, email, storage, etc.)
- Include failure modes even if not mentioned (timeouts, rate limits, etc.)

### Migrations
- Any database changes required
- Rate risk: low = additive only, medium = data transformation, high = destructive changes

### Non-Functionals
- Security: auth, encryption, input validation, OWASP concerns
- Performance: response times, throughput, caching needs
- Compliance: data privacy, audit logging, retention
- Observability: logging, metrics, alerting

### Unknowns (IMPORTANT: blocking vs non-blocking)
An unknown is **blocking** if implementation CANNOT proceed without an answer.

**Blocking examples:**
- "Which auth provider should we use?" (can't write auth code)
- "What's the data retention policy?" (affects schema design)
- "Should this be real-time or polling?" (fundamental architecture choice)

**Non-blocking examples:**
- "Should we add dark mode?" (can defer, doesn't block core work)
- "What color should the button be?" (design detail)
- "Should we add analytics tracking?" (can add later)

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
 * Validate that the extracted inventory is sensible
 */
function validateInventory(inventory: PRDInventory): void {
  // Warn if we have journeys but no UI or API to support them
  if (inventory.journeys.length > 0 && inventory.uiSurfaces.length === 0 && inventory.apiEndpoints.length === 0) {
    logger.warn("Inventory has journeys but no UI surfaces or API endpoints", {
      journeyCount: inventory.journeys.length,
    });
    // Add an unknown for this
    inventory.unknowns.push({
      question: "PRD describes user journeys but no UI or API implementation is specified. How should these journeys be implemented?",
      impactArea: "architecture",
      blocking: true,
    });
  }

  // Ensure subsystems is populated
  if (inventory.subsystems.length === 0) {
    // Infer subsystems from inventory
    const inferred: Set<string> = new Set();
    if (inventory.uiSurfaces.length > 0) inferred.add("frontend");
    if (inventory.apiEndpoints.length > 0) inferred.add("api");
    if (inventory.entities.length > 0) inferred.add("database");
    if (inventory.integrations.length > 0) inferred.add("integrations");
    if (inventory.migrations.length > 0) inferred.add("database");
    inventory.subsystems = Array.from(inferred);
  }
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
