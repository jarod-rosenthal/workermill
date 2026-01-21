/**
 * Artifact Dependency Graph Builder
 *
 * Maps PRD inventory items to work artifacts and builds a
 * directed acyclic graph (DAG) for execution ordering.
 */

import { PRDInventory, PRDJourney, PRDEntity, PRDAPIEndpoint, PRDIntegration, PRDMigration, PRDUnknown, PRDNonFunctional, PRDUISurface } from "./planning-inventory.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// ARTIFACT TYPES
// ============================================================================

/**
 * Types of work artifacts that can be generated from inventory.
 */
export type ArtifactType =
  | "spike"           // Resolve unknowns/ambiguities
  | "schema"          // Database entities/models
  | "api_contract"    // Endpoint definitions/contracts
  | "integration_adapter" // External service adapters
  | "migration"       // Database migrations
  | "ui_contract"     // Component interfaces/contracts
  | "implementation"  // Actual feature code
  | "observability"   // Metrics, logging, alerts
  | "tests"           // Test coverage
  | "docs";           // Documentation

/**
 * Standard dependencies between artifact types.
 * An artifact of type X depends on artifacts of types in dependencies[X].
 */
export const ARTIFACT_DEPENDENCIES: Record<ArtifactType, ArtifactType[]> = {
  spike: [],                      // Spikes have no dependencies
  schema: ["spike"],              // Schemas may depend on spikes resolving unknowns
  api_contract: ["schema"],       // API contracts depend on schemas
  integration_adapter: ["api_contract"],  // Adapters depend on contracts
  migration: ["schema"],          // Migrations depend on schema definitions
  ui_contract: ["api_contract"],  // UI contracts depend on API contracts
  implementation: ["ui_contract", "integration_adapter", "migration"],  // Features depend on contracts
  observability: ["implementation"],  // Observability depends on implementation
  tests: ["implementation"],      // Tests depend on implementation
  docs: ["implementation"],       // Docs depend on implementation
};

// ============================================================================
// ARTIFACT NODE
// ============================================================================

/**
 * A node in the artifact dependency graph.
 */
export interface ArtifactNode {
  /** Unique artifact ID */
  id: string;
  /** Artifact type */
  type: ArtifactType;
  /** Human-readable name */
  name: string;
  /** Description of what this artifact does */
  description: string;
  /** Source inventory item(s) this artifact was derived from */
  sourceItems: string[];
  /** Subsystems this artifact touches */
  subsystems: string[];
  /** IDs of artifacts this depends on */
  dependencies: string[];
  /** Suggested persona for this artifact */
  suggestedPersona: string;
  /** Estimated story points (1-3) */
  estimatedPoints: number;
  /** Mutex groups for concurrency control */
  mutexGroups: string[];
}

/**
 * The complete artifact graph
 */
export interface ArtifactGraph {
  /** All artifact nodes */
  nodes: ArtifactNode[];
  /** Artifacts in topological order (safe execution order) */
  executionOrder: string[];
  /** Mutex groups with their member artifact IDs */
  mutexGroups: Map<string, string[]>;
}

// ============================================================================
// ARTIFACT GENERATION
// ============================================================================

/**
 * Generate artifact nodes from PRD inventory.
 */
export function generateArtifacts(inventory: PRDInventory): ArtifactNode[] {
  const artifacts: ArtifactNode[] = [];
  let idCounter = 0;

  const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

  // 1. Generate spikes from unknowns
  for (const unknown of inventory.unknowns) {
    if (unknown.blocking) {
      artifacts.push({
        id: nextId("spike"),
        type: "spike",
        name: `Resolve: ${unknown.question.slice(0, 50)}...`,
        description: `Investigate and document: ${unknown.question}`,
        sourceItems: [`unknown:${unknown.question}`],
        subsystems: [unknown.impactArea],
        dependencies: [],
        suggestedPersona: "backend_developer", // Default for spikes
        estimatedPoints: 1,
        mutexGroups: [],
      });
    }
  }

  // 2. Generate schemas from entities
  for (const entity of inventory.entities) {
    const spikeIds = findRelatedSpikes(artifacts, entity.name);
    artifacts.push({
      id: nextId("schema"),
      type: "schema",
      name: `Define schema: ${entity.name}`,
      description: `Create/update ${entity.name} model with fields: ${entity.fields.slice(0, 3).join(", ")}${entity.fields.length > 3 ? "..." : ""}`,
      sourceItems: [`entity:${entity.name}`],
      subsystems: ["database"],
      dependencies: spikeIds,
      suggestedPersona: "backend_developer",
      estimatedPoints: entity.fields.length > 5 ? 2 : 1,
      mutexGroups: ["subsystem:database"],
    });
  }

  // 3. Generate API contracts from endpoints
  const endpointsByResource = groupEndpointsByResource(inventory.apiEndpoints);
  for (const [resource, endpoints] of Object.entries(endpointsByResource)) {
    const relatedSchemas = findSchemaArtifacts(artifacts, resource);
    artifacts.push({
      id: nextId("api_contract"),
      type: "api_contract",
      name: `API contract: ${resource}`,
      description: `Define ${endpoints.length} endpoint(s) for ${resource}: ${endpoints.map(e => `${e.method} ${e.route}`).join(", ")}`,
      sourceItems: endpoints.map(e => `endpoint:${e.method}:${e.route}`),
      subsystems: ["api"],
      dependencies: relatedSchemas,
      suggestedPersona: "backend_developer",
      estimatedPoints: endpoints.length > 3 ? 2 : 1,
      mutexGroups: ["subsystem:api"],
    });
  }

  // 4. Generate integration adapters
  for (const integration of inventory.integrations) {
    const contractIds = artifacts.filter(a => a.type === "api_contract").map(a => a.id);
    artifacts.push({
      id: nextId("integration"),
      type: "integration_adapter",
      name: `Integration: ${integration.system}`,
      description: `Implement ${integration.system} adapter with ${integration.authMethod} auth. Handle failures: ${integration.failureModes.slice(0, 2).join(", ")}`,
      sourceItems: [`integration:${integration.system}`],
      subsystems: ["integrations", integration.system.toLowerCase()],
      dependencies: contractIds.slice(0, 2), // Don't depend on all contracts
      suggestedPersona: "backend_developer",
      estimatedPoints: 2, // Integrations are usually medium complexity
      mutexGroups: [`integration:${integration.system.toLowerCase()}`],
    });
  }

  // 5. Generate migrations
  for (const migration of inventory.migrations) {
    const schemaIds = artifacts.filter(a => a.type === "schema").map(a => a.id);
    artifacts.push({
      id: nextId("migration"),
      type: "migration",
      name: `Migration: ${migration.description.slice(0, 40)}...`,
      description: migration.description,
      sourceItems: [`migration:${migration.type}:${migration.description}`],
      subsystems: ["database"],
      dependencies: schemaIds,
      suggestedPersona: "backend_developer",
      estimatedPoints: migration.riskLevel === "high" ? 3 : migration.riskLevel === "medium" ? 2 : 1,
      mutexGroups: ["subsystem:database", "migration:active"], // Only one migration at a time
    });
  }

  // 6. Generate UI contracts from surfaces
  for (const surface of inventory.uiSurfaces) {
    const apiContracts = artifacts.filter(a => a.type === "api_contract").map(a => a.id);
    artifacts.push({
      id: nextId("ui_contract"),
      type: "ui_contract",
      name: `UI: ${surface.name}`,
      description: `Define ${surface.type} interface with states: ${surface.states.join(", ")}`,
      sourceItems: [`ui:${surface.name}`],
      subsystems: ["frontend"],
      dependencies: apiContracts.slice(0, 2), // Depend on relevant API contracts
      suggestedPersona: "frontend_developer",
      estimatedPoints: surface.states.length > 3 ? 2 : 1,
      mutexGroups: ["subsystem:frontend"],
    });
  }

  // 7. Generate implementation artifacts from journeys
  for (const journey of inventory.journeys) {
    const uiContracts = artifacts.filter(a => a.type === "ui_contract").map(a => a.id);
    const integrations = artifacts.filter(a => a.type === "integration_adapter").map(a => a.id);
    const migrations = artifacts.filter(a => a.type === "migration").map(a => a.id);

    // Combine dependencies, but limit to avoid over-coupling
    const deps = [
      ...uiContracts.slice(0, 2),
      ...integrations.slice(0, 1),
      ...migrations.slice(0, 1),
    ];

    artifacts.push({
      id: nextId("impl"),
      type: "implementation",
      name: `Implement: ${journey.goal.slice(0, 50)}`,
      description: `Implement ${journey.actor}'s journey: ${journey.goal}. Steps: ${journey.happyPathSteps.length}`,
      sourceItems: [`journey:${journey.actor}:${journey.goal}`],
      subsystems: inferSubsystemsFromJourney(journey),
      dependencies: deps,
      suggestedPersona: inferPersonaFromJourney(journey),
      estimatedPoints: Math.min(3, Math.ceil(journey.happyPathSteps.length / 3)),
      mutexGroups: inferSubsystemsFromJourney(journey).map(s => `subsystem:${s}`),
    });
  }

  // 8. Generate observability artifacts for non-functionals
  const perfAndSecurityNFs = inventory.nonFunctionals.filter(
    nf => nf.category === "performance" || nf.category === "security" || nf.category === "observability"
  );
  if (perfAndSecurityNFs.length > 0) {
    const implIds = artifacts.filter(a => a.type === "implementation").map(a => a.id);
    artifacts.push({
      id: nextId("observability"),
      type: "observability",
      name: `Observability: ${perfAndSecurityNFs.length} requirement(s)`,
      description: `Add observability for: ${perfAndSecurityNFs.map(nf => nf.requirement.slice(0, 30)).join("; ")}`,
      sourceItems: perfAndSecurityNFs.map(nf => `nf:${nf.category}:${nf.requirement}`),
      subsystems: ["observability"],
      dependencies: implIds.slice(0, 3),
      suggestedPersona: "devops_engineer",
      estimatedPoints: 2,
      mutexGroups: ["subsystem:observability"],
    });
  }

  // 9. Generate test artifacts
  if (inventory.journeys.length > 0 || inventory.apiEndpoints.length > 0) {
    const implIds = artifacts.filter(a => a.type === "implementation").map(a => a.id);
    artifacts.push({
      id: nextId("tests"),
      type: "tests",
      name: `Tests: ${inventory.journeys.length} journey(s), ${inventory.apiEndpoints.length} endpoint(s)`,
      description: `Add test coverage for implemented features`,
      sourceItems: ["tests:all"],
      subsystems: ["testing"],
      dependencies: implIds,
      suggestedPersona: "qa_engineer",
      estimatedPoints: Math.min(3, Math.ceil((inventory.journeys.length + inventory.apiEndpoints.length) / 4)),
      mutexGroups: [],
    });
  }

  return artifacts;
}

// ============================================================================
// GRAPH BUILDING
// ============================================================================

/**
 * Build the complete artifact dependency graph.
 */
export function buildArtifactGraph(inventory: PRDInventory): ArtifactGraph {
  const nodes = generateArtifacts(inventory);

  // Build adjacency list for topological sort
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const node of nodes) {
    for (const depId of node.dependencies) {
      // Verify dependency exists
      if (adjacency.has(depId)) {
        adjacency.get(depId)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }
  }

  // Topological sort (Kahn's algorithm)
  const executionOrder: string[] = [];
  const queue: string[] = [];

  // Start with nodes that have no dependencies
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    executionOrder.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Check for cycles
  if (executionOrder.length !== nodes.length) {
    logger.warn("Artifact graph may contain cycles", {
      totalNodes: nodes.length,
      sortedNodes: executionOrder.length,
    });
  }

  // Build mutex groups map
  const mutexGroups = new Map<string, string[]>();
  for (const node of nodes) {
    for (const group of node.mutexGroups) {
      if (!mutexGroups.has(group)) {
        mutexGroups.set(group, []);
      }
      mutexGroups.get(group)!.push(node.id);
    }
  }

  logger.info("Artifact graph built", {
    nodeCount: nodes.length,
    executionOrderLength: executionOrder.length,
    mutexGroupCount: mutexGroups.size,
  });

  return {
    nodes,
    executionOrder,
    mutexGroups,
  };
}

// ============================================================================
// MUTEX GROUP ASSIGNMENT
// ============================================================================

/**
 * Assign mutex groups to prevent parallel execution conflicts.
 * Stories in the same mutex group cannot run in parallel.
 */
export function assignMutexGroups(nodes: ArtifactNode[]): ArtifactNode[] {
  // Build resource -> artifacts mapping
  const resourceToArtifacts = new Map<string, string[]>();

  for (const node of nodes) {
    for (const subsystem of node.subsystems) {
      const resource = `subsystem:${subsystem}`;
      if (!resourceToArtifacts.has(resource)) {
        resourceToArtifacts.set(resource, []);
      }
      resourceToArtifacts.get(resource)!.push(node.id);
    }
  }

  // Assign mutex groups for resources with multiple artifacts
  for (const [resource, artifactIds] of resourceToArtifacts) {
    if (artifactIds.length > 1) {
      for (const artifactId of artifactIds) {
        const node = nodes.find(n => n.id === artifactId);
        if (node && !node.mutexGroups.includes(resource)) {
          node.mutexGroups.push(resource);
        }
      }
    }
  }

  return nodes;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find spike artifacts related to an entity name.
 */
function findRelatedSpikes(artifacts: ArtifactNode[], entityName: string): string[] {
  return artifacts
    .filter(a => a.type === "spike" && a.subsystems.some(s =>
      entityName.toLowerCase().includes(s) || s.includes(entityName.toLowerCase())
    ))
    .map(a => a.id);
}

/**
 * Find schema artifacts that might be related to a resource.
 */
function findSchemaArtifacts(artifacts: ArtifactNode[], resource: string): string[] {
  const normalized = resource.toLowerCase();
  return artifacts
    .filter(a => a.type === "schema" && (
      a.name.toLowerCase().includes(normalized) ||
      a.sourceItems.some(s => s.toLowerCase().includes(normalized))
    ))
    .map(a => a.id);
}

/**
 * Group API endpoints by their resource (first segment of route).
 */
function groupEndpointsByResource(endpoints: PRDAPIEndpoint[]): Record<string, PRDAPIEndpoint[]> {
  const groups: Record<string, PRDAPIEndpoint[]> = {};

  for (const endpoint of endpoints) {
    // Extract resource from route (e.g., /api/users/:id -> users)
    const match = endpoint.route.match(/\/api\/([^/]+)/);
    const resource = match ? match[1] : "misc";

    if (!groups[resource]) {
      groups[resource] = [];
    }
    groups[resource].push(endpoint);
  }

  return groups;
}

/**
 * Infer subsystems from a journey's characteristics.
 */
function inferSubsystemsFromJourney(journey: PRDJourney): string[] {
  const subsystems: Set<string> = new Set();

  const text = `${journey.goal} ${journey.happyPathSteps.join(" ")}`.toLowerCase();

  // Detect frontend work
  if (text.includes("page") || text.includes("form") || text.includes("click") ||
      text.includes("ui") || text.includes("button") || text.includes("display")) {
    subsystems.add("frontend");
  }

  // Detect backend work
  if (text.includes("api") || text.includes("endpoint") || text.includes("database") ||
      text.includes("save") || text.includes("store") || text.includes("create")) {
    subsystems.add("api");
  }

  // Detect database work
  if (text.includes("database") || text.includes("store") || text.includes("persist") ||
      text.includes("table") || text.includes("model")) {
    subsystems.add("database");
  }

  // Default to frontend + api if nothing detected
  if (subsystems.size === 0) {
    subsystems.add("frontend");
    subsystems.add("api");
  }

  return Array.from(subsystems);
}

/**
 * Infer the best persona for a journey.
 */
function inferPersonaFromJourney(journey: PRDJourney): string {
  const text = `${journey.goal} ${journey.happyPathSteps.join(" ")}`.toLowerCase();

  // Security-related journeys
  if (text.includes("auth") || text.includes("login") || text.includes("permission") ||
      text.includes("security") || text.includes("encrypt")) {
    return "security_engineer";
  }

  // DevOps journeys
  if (text.includes("deploy") || text.includes("infrastructure") || text.includes("ci/cd") ||
      text.includes("monitoring") || text.includes("logging")) {
    return "devops_engineer";
  }

  // Frontend-heavy journeys
  if (text.includes("page") || text.includes("form") || text.includes("component") ||
      text.includes("ui") || text.includes("design") || text.includes("style")) {
    return "frontend_developer";
  }

  // Default to backend developer
  return "backend_developer";
}

/**
 * Get artifacts that can run in parallel (no shared mutex groups or dependencies).
 */
export function getParallelizableGroups(graph: ArtifactGraph): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (const artifactId of graph.executionOrder) {
    if (assigned.has(artifactId)) continue;

    const node = graph.nodes.find(n => n.id === artifactId);
    if (!node) continue;

    // Start a new group with this artifact
    const group: string[] = [artifactId];
    assigned.add(artifactId);

    // Find other artifacts that can run in parallel
    for (const otherId of graph.executionOrder) {
      if (assigned.has(otherId)) continue;

      const other = graph.nodes.find(n => n.id === otherId);
      if (!other) continue;

      // Check if they share mutex groups
      const sharesMutex = node.mutexGroups.some(g => other.mutexGroups.includes(g));
      if (sharesMutex) continue;

      // Check if there's a dependency between them
      const hasDependency = node.dependencies.includes(otherId) || other.dependencies.includes(artifactId);
      if (hasDependency) continue;

      // Check if other depends on anything not yet completed
      const hasUnmetDep = other.dependencies.some(dep => !assigned.has(dep) && dep !== artifactId);
      if (hasUnmetDep) continue;

      group.push(otherId);
      assigned.add(otherId);
    }

    groups.push(group);
  }

  return groups;
}
