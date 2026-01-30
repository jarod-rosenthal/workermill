/**
 * Directive Effectiveness Tracker Service
 *
 * Tracks which directives are used for each task and updates their
 * effectiveness metrics based on task outcomes.
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerTask, PersonaDirective } from "../models/index.js";
import { logger } from "../utils/logger.js";

// DirectiveUsage type definition
export interface DirectiveUsage {
  directiveId: string;
  version: number;
  type: "readme" | "common";
  filename?: string;
  personaSlug: string;
}

export interface TaskOutcome {
  success: boolean;
  qualityScore?: number | null;
  accuracyScore?: number | null;
  reviewOutcome?: string | null;
}

export interface DirectiveMetrics {
  directiveId: string;
  personaSlug: string;
  version: number;
  type: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  avgAccuracyScore: number | null;
  lastUsedAt: Date | null;
  isDeprecated: boolean;
  deprecatedAt: Date | null;
  deprecationReason: string | null;
}

export interface VersionComparison {
  version: number;
  usageCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  avgAccuracyScore: number | null;
  isActive: boolean;
  isDeprecated: boolean;
}

/**
 * Record which directives were used for a task.
 * Called by workers when they load directives before execution.
 */
export async function recordDirectiveUsage(
  taskId: string,
  directives: DirectiveUsage[]
): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  try {
    // Update task with directives used
    await taskRepo.update({ id: taskId }, { directivesUsed: directives });

    // Increment usage count and update last_used_at for each directive
    for (const d of directives) {
      await directiveRepo.update(
        { id: d.directiveId },
        {
          usageCount: () => "usage_count + 1",
          lastUsedAt: new Date(),
        }
      );
    }

    logger.debug("Recorded directive usage", {
      taskId,
      directiveCount: directives.length,
    });
  } catch (error) {
    logger.error("Failed to record directive usage", { taskId, error });
    throw error;
  }
}

/**
 * Update directive metrics on task completion.
 * Called when a task reaches a terminal state.
 */
export async function updateDirectiveOutcome(
  taskId: string,
  outcome: TaskOutcome
): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  try {
    // Get the task to find its directives
    const task = await taskRepo.findOne({
      where: { id: taskId },
      select: ["id", "directivesUsed"],
    });

    if (!task || !task.directivesUsed || task.directivesUsed.length === 0) {
      logger.debug("No directives to update for task", { taskId });
      return;
    }

    // Update each directive's metrics
    for (const d of task.directivesUsed as DirectiveUsage[]) {
      const directive = await directiveRepo.findOne({
        where: { id: d.directiveId },
      });

      if (!directive) continue;

      // Update success/failure counts
      const updates: {
        successCount?: number;
        failureCount?: number;
        avgQualityScore?: number;
        avgAccuracyScore?: number;
      } = {};

      if (outcome.success) {
        updates.successCount = (directive.successCount || 0) + 1;
      } else {
        updates.failureCount = (directive.failureCount || 0) + 1;
      }

      // Update rolling average for quality score
      if (outcome.qualityScore !== undefined && outcome.qualityScore !== null) {
        const totalSamples =
          (directive.successCount || 0) + (directive.failureCount || 0) + 1;
        const currentAvg = directive.avgQualityScore || 0;
        // Incremental average: newAvg = oldAvg + (newValue - oldAvg) / n
        updates.avgQualityScore =
          currentAvg + (outcome.qualityScore - currentAvg) / totalSamples;
      }

      // Update rolling average for accuracy score
      if (
        outcome.accuracyScore !== undefined &&
        outcome.accuracyScore !== null
      ) {
        const totalSamples =
          (directive.successCount || 0) + (directive.failureCount || 0) + 1;
        const currentAvg = directive.avgAccuracyScore || 0;
        updates.avgAccuracyScore =
          currentAvg + (outcome.accuracyScore - currentAvg) / totalSamples;
      }

      await directiveRepo.update({ id: d.directiveId }, updates);
    }

    logger.debug("Updated directive outcomes", {
      taskId,
      success: outcome.success,
      directiveCount: task.directivesUsed.length,
    });
  } catch (error) {
    logger.error("Failed to update directive outcome", { taskId, error });
    throw error;
  }
}

/**
 * Get effectiveness metrics for a specific directive.
 */
export async function getDirectiveMetrics(
  directiveId: string
): Promise<DirectiveMetrics | null> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const directive = await directiveRepo.findOne({
    where: { id: directiveId },
    relations: ["persona"],
  });

  if (!directive) return null;

  const totalSamples =
    (directive.successCount || 0) + (directive.failureCount || 0);
  const successRate =
    totalSamples > 0 ? (directive.successCount || 0) / totalSamples : null;

  return {
    directiveId: directive.id,
    personaSlug: directive.persona?.slug || "unknown",
    version: directive.version,
    type: directive.type,
    usageCount: directive.usageCount || 0,
    successCount: directive.successCount || 0,
    failureCount: directive.failureCount || 0,
    successRate,
    avgQualityScore: directive.avgQualityScore,
    avgAccuracyScore: directive.avgAccuracyScore,
    lastUsedAt: directive.lastUsedAt,
    isDeprecated: !!directive.deprecatedAt,
    deprecatedAt: directive.deprecatedAt,
    deprecationReason: directive.deprecationReason,
  };
}

/**
 * Compare different versions of a directive for a persona.
 */
export async function compareDirectiveVersions(
  personaSlug: string,
  type: "readme" | "common",
  filename?: string
): Promise<VersionComparison[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const queryBuilder = directiveRepo
    .createQueryBuilder("d")
    .innerJoin("d.persona", "p")
    .where("p.slug = :personaSlug", { personaSlug })
    .andWhere("d.type = :type", { type });

  if (filename) {
    queryBuilder.andWhere("d.filename = :filename", { filename });
  }

  queryBuilder.orderBy("d.version", "DESC");

  const directives = await queryBuilder.getMany();

  return directives.map((d) => {
    const totalSamples = (d.successCount || 0) + (d.failureCount || 0);
    const successRate =
      totalSamples > 0 ? (d.successCount || 0) / totalSamples : null;

    return {
      version: d.version,
      usageCount: d.usageCount || 0,
      successRate,
      avgQualityScore: d.avgQualityScore,
      avgAccuracyScore: d.avgAccuracyScore,
      isActive: d.isActive,
      isDeprecated: !!d.deprecatedAt,
    };
  });
}

/**
 * Get effectiveness metrics for all directives in an organization.
 */
export async function getOrgDirectiveMetrics(
  orgId: string,
  options: { activeOnly?: boolean; minUsage?: number } = {}
): Promise<DirectiveMetrics[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const queryBuilder = directiveRepo
    .createQueryBuilder("d")
    .innerJoinAndSelect("d.persona", "p")
    .where("p.org_id = :orgId OR p.org_id IS NULL", { orgId });

  if (options.activeOnly) {
    queryBuilder.andWhere("d.is_active = true");
  }

  if (options.minUsage !== undefined) {
    queryBuilder.andWhere("d.usage_count >= :minUsage", {
      minUsage: options.minUsage,
    });
  }

  queryBuilder.orderBy("d.usage_count", "DESC");

  const directives = await queryBuilder.getMany();

  return directives.map((d) => {
    const totalSamples = (d.successCount || 0) + (d.failureCount || 0);
    const successRate =
      totalSamples > 0 ? (d.successCount || 0) / totalSamples : null;

    return {
      directiveId: d.id,
      personaSlug: d.persona?.slug || "unknown",
      version: d.version,
      type: d.type,
      usageCount: d.usageCount || 0,
      successCount: d.successCount || 0,
      failureCount: d.failureCount || 0,
      successRate,
      avgQualityScore: d.avgQualityScore,
      avgAccuracyScore: d.avgAccuracyScore,
      lastUsedAt: d.lastUsedAt,
      isDeprecated: !!d.deprecatedAt,
      deprecatedAt: d.deprecatedAt,
      deprecationReason: d.deprecationReason,
    };
  });
}

/**
 * Mark a directive as deprecated.
 */
export async function deprecateDirective(
  directiveId: string,
  reason: string,
  supersededById?: string
): Promise<void> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const updates: {
    deprecatedAt: Date;
    deprecationReason: string;
    isActive: boolean;
    supersededById?: string;
  } = {
    deprecatedAt: new Date(),
    deprecationReason: reason,
    isActive: false,
  };

  if (supersededById) {
    updates.supersededById = supersededById;
  }

  await directiveRepo.update({ id: directiveId }, updates);

  logger.info("Deprecated directive", { directiveId, reason, supersededById });
}
