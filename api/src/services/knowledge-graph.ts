import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import {
  TaskRelationship,
  RelationshipSource,
  TaskRelationshipMetadata,
} from "../models/TaskRelationship.js";
import type { TaskRelationshipType } from "../models/TaskRelationship.js";

// Re-export the type for use in routes
export type { TaskRelationshipType };
import { generateEmbedding, findSimilarEpisodicMemories } from "./embedding.js";
import { EpisodicMemory } from "../models/EpisodicMemory.js";
import { logger } from "../utils/logger.js";

/**
 * Graph node representing a task
 */
export interface TaskNode {
  id: string;
  title: string;
  status: string;
  repository: string | null;
  persona: string | null;
  completedAt: Date | null;
  incomingRelations: number;
  outgoingRelations: number;
}

/**
 * Graph edge representing a relationship
 */
export interface RelationshipEdge {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationshipType: TaskRelationshipType;
  strength: number;
  confidence: number;
  metadata: TaskRelationshipMetadata;
}

/**
 * Full knowledge graph view
 */
export interface KnowledgeGraph {
  nodes: TaskNode[];
  edges: RelationshipEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    avgConnections: number;
    mostConnectedTask: { id: string; title: string; connections: number } | null;
  };
}

/**
 * Path through the knowledge graph
 */
export interface GraphPath {
  tasks: TaskNode[];
  relationships: RelationshipEdge[];
  totalStrength: number;
}

/**
 * Knowledge Graph Service - REQ-12
 *
 * Manages the task relationship knowledge graph.
 * Enables discovery of task patterns, dependencies, and connections.
 */
export class KnowledgeGraphService {
  private relationshipRepo = AppDataSource.getRepository(TaskRelationship);
  private taskRepo = AppDataSource.getRepository(WorkerTask);
  private episodicRepo = AppDataSource.getRepository(EpisodicMemory);

  /**
   * Create a relationship between two tasks
   */
  async createRelationship(
    orgId: string,
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: TaskRelationshipType,
    options: {
      strength?: number;
      confidence?: number;
      source?: RelationshipSource;
      metadata?: TaskRelationshipMetadata;
    } = {}
  ): Promise<TaskRelationship> {
    const { strength = 1.0, confidence = 0.7, source = "explicit", metadata = {} } = options;

    // Check if relationship already exists
    const existing = await this.relationshipRepo.findOne({
      where: { sourceTaskId, targetTaskId, relationshipType },
    });

    if (existing) {
      // Update existing relationship
      existing.strength = Math.max(existing.strength, strength);
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.metadata = { ...existing.metadata, ...metadata };
      return this.relationshipRepo.save(existing);
    }

    // Create new relationship
    const relationship = this.relationshipRepo.create({
      orgId,
      sourceTaskId,
      targetTaskId,
      relationshipType,
      strength,
      confidence,
      source,
      metadata,
    });

    return this.relationshipRepo.save(relationship);
  }

  /**
   * Get all relationships for a task
   */
  async getTaskRelationships(
    orgId: string,
    taskId: string,
    options: { direction?: "outgoing" | "incoming" | "both"; types?: TaskRelationshipType[] } = {}
  ): Promise<RelationshipEdge[]> {
    const { direction = "both", types } = options;

    const qb = this.relationshipRepo
      .createQueryBuilder("r")
      .where("r.org_id = :orgId", { orgId });

    if (direction === "outgoing") {
      qb.andWhere("r.source_task_id = :taskId", { taskId });
    } else if (direction === "incoming") {
      qb.andWhere("r.target_task_id = :taskId", { taskId });
    } else {
      qb.andWhere("(r.source_task_id = :taskId OR r.target_task_id = :taskId)", { taskId });
    }

    if (types && types.length > 0) {
      qb.andWhere("r.relationship_type IN (:...types)", { types });
    }

    const relationships = await qb.orderBy("r.strength", "DESC").getMany();

    return relationships.map((r) => ({
      id: r.id,
      sourceTaskId: r.sourceTaskId,
      targetTaskId: r.targetTaskId,
      relationshipType: r.relationshipType,
      strength: r.strength,
      confidence: r.confidence,
      metadata: r.metadata,
    }));
  }

  /**
   * Get connected tasks (neighbors in the graph)
   */
  async getConnectedTasks(
    orgId: string,
    taskId: string,
    options: { depth?: number; minStrength?: number; types?: TaskRelationshipType[] } = {}
  ): Promise<TaskNode[]> {
    const { depth = 1, minStrength = 0.5, types } = options;

    const visited = new Set<string>();
    const result: TaskNode[] = [];
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: taskId, currentDepth: 0 }];

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;

      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      // Get relationships for this task
      const relationships = await this.getTaskRelationships(orgId, id, { types });

      for (const rel of relationships) {
        if (rel.strength < minStrength) continue;

        const connectedId = rel.sourceTaskId === id ? rel.targetTaskId : rel.sourceTaskId;

        if (!visited.has(connectedId)) {
          // Get task details
          const task = await this.taskRepo.findOne({
            where: { id: connectedId, orgId },
          });

          if (task) {
            const inOut = await this.getConnectionCounts(orgId, connectedId);
            result.push({
              id: task.id,
              title: task.summary || task.jiraIssueKey || "Untitled",
              status: task.status,
              repository: task.githubRepo,
              persona: task.workerPersona,
              completedAt: task.completedAt,
              incomingRelations: inOut.incoming,
              outgoingRelations: inOut.outgoing,
            });

            if (currentDepth < depth) {
              queue.push({ id: connectedId, currentDepth: currentDepth + 1 });
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get the full knowledge graph for an organization
   */
  async getKnowledgeGraph(
    orgId: string,
    options: { repository?: string; minStrength?: number; limit?: number } = {}
  ): Promise<KnowledgeGraph> {
    const { repository, minStrength = 0.5, limit = 100 } = options;

    // Get edges
    const qb = this.relationshipRepo
      .createQueryBuilder("r")
      .where("r.org_id = :orgId", { orgId })
      .andWhere("r.strength >= :minStrength", { minStrength })
      .orderBy("r.strength", "DESC")
      .limit(limit);

    const relationships = await qb.getMany();

    const edges: RelationshipEdge[] = relationships.map((r) => ({
      id: r.id,
      sourceTaskId: r.sourceTaskId,
      targetTaskId: r.targetTaskId,
      relationshipType: r.relationshipType,
      strength: r.strength,
      confidence: r.confidence,
      metadata: r.metadata,
    }));

    // Get unique task IDs
    const taskIds = [...new Set([
      ...relationships.map((r) => r.sourceTaskId),
      ...relationships.map((r) => r.targetTaskId),
    ])];

    // Get task details
    const taskQb = this.taskRepo
      .createQueryBuilder("t")
      .where("t.id IN (:...taskIds)", { taskIds })
      .andWhere("t.org_id = :orgId", { orgId });

    if (repository) {
      taskQb.andWhere("t.github_repo = :repository", { repository });
    }

    const tasks = await taskQb.getMany();

    // Count connections for each task
    const connectionCounts: Record<string, { incoming: number; outgoing: number }> = {};
    for (const rel of relationships) {
      if (!connectionCounts[rel.sourceTaskId]) {
        connectionCounts[rel.sourceTaskId] = { incoming: 0, outgoing: 0 };
      }
      if (!connectionCounts[rel.targetTaskId]) {
        connectionCounts[rel.targetTaskId] = { incoming: 0, outgoing: 0 };
      }
      connectionCounts[rel.sourceTaskId].outgoing++;
      connectionCounts[rel.targetTaskId].incoming++;
    }

    const nodes: TaskNode[] = tasks.map((t) => ({
      id: t.id,
      title: t.summary || t.jiraIssueKey || "Untitled",
      status: t.status,
      repository: t.githubRepo,
      persona: t.workerPersona,
      completedAt: t.completedAt,
      incomingRelations: connectionCounts[t.id]?.incoming || 0,
      outgoingRelations: connectionCounts[t.id]?.outgoing || 0,
    }));

    // Find most connected task
    let mostConnected: KnowledgeGraph["stats"]["mostConnectedTask"] = null;
    let maxConnections = 0;

    for (const node of nodes) {
      const totalConnections = node.incomingRelations + node.outgoingRelations;
      if (totalConnections > maxConnections) {
        maxConnections = totalConnections;
        mostConnected = { id: node.id, title: node.title, connections: totalConnections };
      }
    }

    const avgConnections = nodes.length > 0
      ? edges.length * 2 / nodes.length
      : 0;

    return {
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        avgConnections,
        mostConnectedTask: mostConnected,
      },
    };
  }

  /**
   * Find shortest path between two tasks
   */
  async findPath(
    orgId: string,
    sourceTaskId: string,
    targetTaskId: string,
    options: { maxDepth?: number } = {}
  ): Promise<GraphPath | null> {
    const { maxDepth = 5 } = options;

    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[]; rels: TaskRelationship[] }> = [
      { id: sourceTaskId, path: [sourceTaskId], rels: [] },
    ];

    while (queue.length > 0) {
      const { id, path, rels } = queue.shift()!;

      if (id === targetTaskId) {
        // Found the target - reconstruct path
        const tasks = await this.taskRepo.findBy({
          id: path as unknown as string, // TypeORM In query
          orgId,
        });

        const taskMap = new Map(tasks.map((t) => [t.id, t]));
        const taskNodes: TaskNode[] = path.map((pid) => {
          const t = taskMap.get(pid);
          return {
            id: pid,
            title: t?.summary || t?.jiraIssueKey || "Unknown",
            status: t?.status || "unknown",
            repository: t?.githubRepo || null,
            persona: t?.workerPersona || null,
            completedAt: t?.completedAt || null,
            incomingRelations: 0,
            outgoingRelations: 0,
          };
        });

        const relEdges: RelationshipEdge[] = rels.map((r) => ({
          id: r.id,
          sourceTaskId: r.sourceTaskId,
          targetTaskId: r.targetTaskId,
          relationshipType: r.relationshipType,
          strength: r.strength,
          confidence: r.confidence,
          metadata: r.metadata,
        }));

        const totalStrength = rels.reduce((sum, r) => sum + r.strength, 0) / (rels.length || 1);

        return { tasks: taskNodes, relationships: relEdges, totalStrength };
      }

      if (path.length >= maxDepth || visited.has(id)) continue;
      visited.add(id);

      // Get adjacent tasks
      const relationships = await this.relationshipRepo.find({
        where: [
          { orgId, sourceTaskId: id },
          { orgId, targetTaskId: id },
        ],
      });

      for (const rel of relationships) {
        const nextId = rel.sourceTaskId === id ? rel.targetTaskId : rel.sourceTaskId;
        if (!visited.has(nextId)) {
          queue.push({
            id: nextId,
            path: [...path, nextId],
            rels: [...rels, rel],
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Auto-discover relationships based on task similarity
   */
  async discoverSimilarityRelationships(
    orgId: string,
    taskId: string,
    options: { minSimilarity?: number; maxRelationships?: number } = {}
  ): Promise<TaskRelationship[]> {
    const { minSimilarity = 0.7, maxRelationships = 5 } = options;

    logger.info("Discovering similarity relationships", { orgId, taskId });

    // Get the task
    const task = await this.taskRepo.findOne({ where: { id: taskId, orgId } });
    if (!task) {
      throw new Error("Task not found");
    }

    // Build search text
    const searchText = `${task.summary || ""} ${task.description || ""}`;

    try {
      // Generate embedding
      const embeddingResult = await generateEmbedding(orgId, searchText);
      if (!embeddingResult.embedding) {
        return [];
      }

      // Find similar episodic memories (which link to tasks)
      const similar = await findSimilarEpisodicMemories(
        orgId,
        embeddingResult.embedding,
        {
          repository: task.githubRepo || undefined,
          limit: maxRelationships * 2,
          minSimilarity,
        }
      );

      const createdRelationships: TaskRelationship[] = [];

      for (const memory of similar) {
        const memoryTyped = memory as unknown as EpisodicMemory & { similarity: number };
        if (!memoryTyped.taskId || memoryTyped.taskId === taskId) continue;

        // Create similarity relationship
        const rel = await this.createRelationship(
          orgId,
          taskId,
          memoryTyped.taskId,
          "similar_to",
          {
            strength: memoryTyped.similarity,
            confidence: memoryTyped.similarity,
            source: "similarity",
            metadata: { similarityScore: memoryTyped.similarity },
          }
        );
        createdRelationships.push(rel);

        if (createdRelationships.length >= maxRelationships) break;
      }

      logger.info("Discovered similarity relationships", {
        orgId,
        taskId,
        count: createdRelationships.length,
      });

      return createdRelationships;
    } catch (error) {
      logger.warn("Error discovering similarity relationships", { error, orgId, taskId });
      return [];
    }
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(orgId: string, relationshipId: string): Promise<boolean> {
    const result = await this.relationshipRepo.delete({ id: relationshipId, orgId });
    return (result.affected || 0) > 0;
  }

  // Private helpers

  private async getConnectionCounts(
    orgId: string,
    taskId: string
  ): Promise<{ incoming: number; outgoing: number }> {
    const incoming = await this.relationshipRepo.count({
      where: { orgId, targetTaskId: taskId },
    });
    const outgoing = await this.relationshipRepo.count({
      where: { orgId, sourceTaskId: taskId },
    });
    return { incoming, outgoing };
  }
}

// Export singleton instance
export const knowledgeGraphService = new KnowledgeGraphService();
