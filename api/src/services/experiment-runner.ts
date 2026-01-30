/**
 * Experiment Runner Service
 *
 * Manages A/B experiments for directive effectiveness testing.
 * Handles traffic allocation, result tracking, and statistical significance.
 */

import { AppDataSource } from "../db/connection.js";
import {
  DirectiveExperiment,
  PersonaDirective,
  WorkerTask,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { deprecateDirective } from "./directive-tracker.js";

export interface ExperimentConfig {
  name: string;
  description?: string;
  personaSlug: string;
  directiveType: "readme" | "common";
  directiveFilename?: string;
  controlDirectiveId: string;
  variantDirectiveIds?: string[];
  trafficAllocation?: Record<string, number>;
  minSamplesPerVariant?: number;
}

export interface DirectiveAssignment {
  directiveId: string;
  experimentId?: string;
  variantKey?: string;
}

export interface SignificanceResult {
  experimentId: string;
  isSignificant: boolean;
  confidenceLevel: number;
  controlStats: VariantStats;
  variantStats: Record<string, VariantStats>;
  recommendedWinner?: string;
  reason?: string;
}

interface VariantStats {
  directiveId: string;
  samples: number;
  successRate: number;
  avgQuality: number | null;
}

/**
 * Create a new experiment.
 */
export async function createExperiment(
  orgId: string,
  userId: string | null,
  config: ExperimentConfig
): Promise<DirectiveExperiment> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  // Validate control directive exists
  const controlDirective = await directiveRepo.findOne({
    where: { id: config.controlDirectiveId },
  });
  if (!controlDirective) {
    throw new Error("Control directive not found");
  }

  // Validate variant directives exist
  const variantIds = config.variantDirectiveIds || [];
  for (const id of variantIds) {
    const variant = await directiveRepo.findOne({ where: { id } });
    if (!variant) {
      throw new Error(`Variant directive not found: ${id}`);
    }
  }

  // Calculate traffic allocation if not provided
  let trafficAllocation = config.trafficAllocation;
  if (!trafficAllocation) {
    const totalVariants = variantIds.length + 1; // +1 for control
    const perVariant = Math.floor(100 / totalVariants);
    trafficAllocation = { control: perVariant };
    variantIds.forEach((_, i) => {
      trafficAllocation![`variant_${i}`] = perVariant;
    });
    // Give remainder to control
    const allocated = Object.values(trafficAllocation).reduce(
      (a, b) => a + b,
      0
    );
    trafficAllocation.control += 100 - allocated;
  }

  const experiment = experimentRepo.create({
    orgId,
    name: config.name,
    description: config.description,
    personaSlug: config.personaSlug,
    directiveType: config.directiveType,
    directiveFilename: config.directiveFilename,
    controlDirectiveId: config.controlDirectiveId,
    variantDirectiveIds: variantIds,
    trafficAllocation,
    minSamplesPerVariant: config.minSamplesPerVariant || 20,
    createdById: userId,
    status: "draft",
  });

  await experimentRepo.save(experiment);

  logger.info("Created experiment", {
    experimentId: experiment.id,
    name: config.name,
  });

  return experiment;
}

/**
 * Get an experiment by ID.
 */
export async function getExperiment(
  experimentId: string
): Promise<DirectiveExperiment | null> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);
  return experimentRepo.findOne({ where: { id: experimentId } });
}

/**
 * List experiments for an organization.
 */
export async function listExperiments(
  orgId: string,
  options: {
    status?: "draft" | "running" | "completed" | "cancelled";
    personaSlug?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<DirectiveExperiment[]> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);

  const queryBuilder = experimentRepo
    .createQueryBuilder("e")
    .where("e.org_id = :orgId", { orgId });

  if (options.status) {
    queryBuilder.andWhere("e.status = :status", { status: options.status });
  }

  if (options.personaSlug) {
    queryBuilder.andWhere("e.persona_slug = :personaSlug", {
      personaSlug: options.personaSlug,
    });
  }

  queryBuilder
    .orderBy("e.created_at", "DESC")
    .limit(options.limit || 50)
    .offset(options.offset || 0);

  return queryBuilder.getMany();
}

/**
 * Start an experiment.
 */
export async function startExperiment(
  experimentId: string
): Promise<DirectiveExperiment> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);

  const experiment = await experimentRepo.findOne({
    where: { id: experimentId },
  });
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.status !== "draft") {
    throw new Error(`Cannot start experiment in status: ${experiment.status}`);
  }

  experiment.status = "running";
  experiment.startedAt = new Date();

  await experimentRepo.save(experiment);

  logger.info("Started experiment", { experimentId, name: experiment.name });

  return experiment;
}

/**
 * Cancel an experiment.
 */
export async function cancelExperiment(experimentId: string): Promise<void> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);

  const experiment = await experimentRepo.findOne({
    where: { id: experimentId },
  });
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.status === "completed") {
    throw new Error("Cannot cancel a completed experiment");
  }

  experiment.status = "cancelled";

  await experimentRepo.save(experiment);

  logger.info("Cancelled experiment", { experimentId });
}

/**
 * Get the directive to use for a task, respecting active experiments.
 */
export async function getDirectiveForTask(
  personaSlug: string,
  type: "readme" | "common",
  orgId: string,
  filename?: string
): Promise<DirectiveAssignment> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  // Find active experiment for this persona/type
  const queryBuilder = experimentRepo
    .createQueryBuilder("e")
    .where("e.org_id = :orgId", { orgId })
    .andWhere("e.status = :status", { status: "running" })
    .andWhere("e.persona_slug = :personaSlug", { personaSlug })
    .andWhere("e.directive_type = :type", { type });

  if (filename) {
    queryBuilder.andWhere("e.directive_filename = :filename", { filename });
  }

  const experiment = await queryBuilder.getOne();

  if (experiment) {
    // Assign to a variant based on traffic allocation
    const assignment = experiment.selectDirective();

    return {
      directiveId: assignment.directiveId,
      experimentId: experiment.id,
      variantKey: assignment.variantKey,
    };
  }

  // No experiment - get the active directive
  const directiveQueryBuilder = directiveRepo
    .createQueryBuilder("d")
    .innerJoin("d.persona", "p")
    .where("p.slug = :personaSlug", { personaSlug })
    .andWhere("d.type = :type", { type })
    .andWhere("d.is_active = true")
    .andWhere("d.deprecated_at IS NULL");

  if (filename) {
    directiveQueryBuilder.andWhere("d.filename = :filename", { filename });
  }

  directiveQueryBuilder.orderBy("d.version", "DESC").limit(1);

  const directive = await directiveQueryBuilder.getOne();

  if (!directive) {
    throw new Error(
      `No active directive found for ${personaSlug}/${type}${filename ? `/${filename}` : ""}`
    );
  }

  return { directiveId: directive.id };
}

/**
 * Check statistical significance of an experiment.
 * Uses a simple z-test for proportions.
 */
export async function checkExperimentSignificance(
  experimentId: string
): Promise<SignificanceResult> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const experiment = await experimentRepo.findOne({
    where: { id: experimentId },
  });
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  // Get stats for control
  const controlDirective = await directiveRepo.findOne({
    where: { id: experiment.controlDirectiveId },
  });

  // Get stats from tasks that used each directive during the experiment
  const getVariantStats = async (
    directiveId: string
  ): Promise<VariantStats> => {
    const tasks = await taskRepo
      .createQueryBuilder("t")
      .where("t.directives_used @> :directiveJson", {
        directiveJson: JSON.stringify([{ directiveId }]),
      })
      .andWhere("t.created_at >= :startedAt", {
        startedAt: experiment.startedAt,
      })
      .andWhere("t.status IN (:...statuses)", {
        statuses: ["completed", "deployed", "failed"],
      })
      .getMany();

    const successful = tasks.filter(
      (t) => t.status === "completed" || t.status === "deployed"
    ).length;
    const successRate = tasks.length > 0 ? successful / tasks.length : 0;

    const qualityScores = tasks
      .filter((t) => t.qualityScore !== null && t.qualityScore !== undefined)
      .map((t) => t.qualityScore as number);
    const avgQuality =
      qualityScores.length > 0
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : null;

    return {
      directiveId,
      samples: tasks.length,
      successRate,
      avgQuality,
    };
  };

  const controlStats = await getVariantStats(experiment.controlDirectiveId);
  const variantStats: Record<string, VariantStats> = {};

  for (let i = 0; i < experiment.variantDirectiveIds.length; i++) {
    const variantId = experiment.variantDirectiveIds[i];
    variantStats[`variant_${i}`] = await getVariantStats(variantId);
  }

  // Check if we have enough samples
  const minSamples = experiment.minSamplesPerVariant || 20;
  const hasEnoughSamples =
    controlStats.samples >= minSamples &&
    Object.values(variantStats).every((v) => v.samples >= minSamples);

  if (!hasEnoughSamples) {
    return {
      experimentId,
      isSignificant: false,
      confidenceLevel: 0,
      controlStats,
      variantStats,
      reason: `Insufficient samples. Need ${minSamples} per variant.`,
    };
  }

  // Calculate z-score for each variant vs control
  let bestVariant: string | undefined;
  let bestImprovement = 0;
  let isSignificant = false;
  let confidenceLevel = 0;

  const p1 = controlStats.successRate;
  const n1 = controlStats.samples;

  for (const [key, stats] of Object.entries(variantStats)) {
    const p2 = stats.successRate;
    const n2 = stats.samples;

    // Pooled proportion
    const p = (p1 * n1 + p2 * n2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));

    if (se === 0) continue;

    const z = (p2 - p1) / se;

    // Check for significance at 95% confidence (z > 1.96)
    if (Math.abs(z) > 1.96) {
      isSignificant = true;
      confidenceLevel = Math.max(confidenceLevel, 0.95);

      if (z > 0 && p2 - p1 > bestImprovement) {
        bestImprovement = p2 - p1;
        bestVariant = key;
      }
    } else if (Math.abs(z) > 1.645) {
      // 90% confidence
      confidenceLevel = Math.max(confidenceLevel, 0.9);
    }
  }

  // Also check if control is the winner
  const controlBeatAll = Object.values(variantStats).every(
    (v) => controlStats.successRate > v.successRate
  );

  let recommendedWinner: string | undefined;
  if (bestVariant) {
    recommendedWinner = variantStats[bestVariant].directiveId;
  } else if (isSignificant || (controlBeatAll && hasEnoughSamples)) {
    recommendedWinner = controlStats.directiveId;
  }

  return {
    experimentId,
    isSignificant,
    confidenceLevel,
    controlStats,
    variantStats,
    recommendedWinner,
    reason: isSignificant
      ? `Statistically significant at ${Math.round(confidenceLevel * 100)}% confidence`
      : "No statistically significant difference detected",
  };
}

/**
 * Conclude an experiment with a winner.
 */
export async function concludeExperiment(
  experimentId: string,
  winnerDirectiveId: string,
  reason?: string
): Promise<DirectiveExperiment> {
  const experimentRepo = AppDataSource.getRepository(DirectiveExperiment);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const experiment = await experimentRepo.findOne({
    where: { id: experimentId },
  });
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.status !== "running") {
    throw new Error(`Cannot conclude experiment in status: ${experiment.status}`);
  }

  // Validate winner is part of experiment
  const allDirectiveIds = experiment.getAllDirectiveIds();
  if (!allDirectiveIds.includes(winnerDirectiveId)) {
    throw new Error("Winner must be one of the experiment directives");
  }

  // Mark experiment as completed
  experiment.status = "completed";
  experiment.completedAt = new Date();
  experiment.winnerDirectiveId = winnerDirectiveId;
  experiment.winnerReason = reason || "Selected as winner";

  await experimentRepo.save(experiment);

  // Activate winner directive
  await directiveRepo.update({ id: winnerDirectiveId }, { isActive: true });

  // Deprecate losers
  for (const directiveId of allDirectiveIds) {
    if (directiveId !== winnerDirectiveId) {
      await deprecateDirective(
        directiveId,
        `Lost experiment ${experiment.name} to ${winnerDirectiveId}`,
        winnerDirectiveId
      );
    }
  }

  logger.info("Concluded experiment", {
    experimentId,
    winner: winnerDirectiveId,
    reason,
  });

  return experiment;
}
