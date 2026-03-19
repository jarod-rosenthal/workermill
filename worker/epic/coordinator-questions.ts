/**
 * Coordinator Questions Module
 *
 * Handles question routing between experts: answer-first workflow,
 * tiered question routing, and virtual expert spawning.
 */

import type { ExpertPersona, ExpertState, EpicConfig } from "./types.js";
import type { CoordinationClient } from "./coordination-client.js";
import type { DecisionClient } from "./decision-client.js";
import type { StoryExecutor } from "./executor.js";
import {
  writeAnswerToWorktree,
  deliverAnswerToAsker,
  writePendingPlaceholder,
  getStoryContext,
} from "./coordinator-commands.js";
import { postLog } from "./coordinator-utils.js";

/**
 * Personas excluded from question routing (Tier 2/3 fallback).
 * They can still answer questions explicitly targeted at them (Tier 1).
 */
const QUESTION_INELIGIBLE_PERSONAS = new Set([
  "support_agent",
  "project_manager",
  "tech_writer",
]);

/**
 * Process answer-first workflow: have idle experts answer pending questions targeting them.
 * This ensures experts answer questions BEFORE taking on new stories.
 */
export async function processAnswerFirst(
  config: EpicConfig,
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  coordination: CoordinationClient,
  decisionClient: DecisionClient,
  executor: StoryExecutor,
  inFlightQuickAnswers: Set<string>
): Promise<void> {
  // Get all idle experts
  const idleExperts = Array.from(expertStates.entries())
    .filter(([_, state]) => state.status === "idle")
    .map(([persona]) => persona);

  if (idleExperts.length === 0) return;

  // Track which questions get answered in this pass to avoid duplicates
  const answeredInPass = new Set<string>();

  // Pass 1: Each idle expert answers questions explicitly targeting them
  for (const expertPersona of idleExperts) {
    const pendingQuestions = await coordination.getQuestionsForPersona(expertPersona);

    if (pendingQuestions.length === 0) continue;

    console.log(`[Epic] ${expertPersona} has ${pendingQuestions.length} pending question(s) to answer first`);

    expertStates.set(expertPersona, {
      persona: expertPersona,
      status: "working",
    });

    for (const question of pendingQuestions) {
      if (answeredInPass.has(question.id)) continue;
      console.log(`[Epic] ${expertPersona} answering question from ${question.fromPersona}`);

      try {
        const storyCtx = await getStoryContext(config, coordination, question);
        const answerText = await executor.answerQuestion(
          {
            id: question.id,
            parentTaskId: question.parentTaskId,
            taskId: undefined,
            persona: question.fromPersona,
            messageType: "question",
            content: question.content,
            metadata: question.metadata,
            createdAt: question.createdAt,
          },
          expertPersona,
          storyCtx
        );
        answeredInPass.add(question.id);

        // Deliver answer file to asking expert's worktree
        if (answerText) {
          const fromStory = question.metadata?.fromStory as number | undefined;
          if (fromStory !== undefined) {
            const worktreePath = activeWorktrees.get(fromStory);
            if (worktreePath) {
              writeAnswerToWorktree(worktreePath, question, answerText, expertPersona);
            }
          }
        }
      } catch (error) {
        console.error(`[Epic] ${expertPersona} failed to answer question:`, error);
      }
    }

    expertStates.set(expertPersona, {
      persona: expertPersona,
      status: "idle",
    });
  }

  // Pass 2: Route orphaned questions (target is busy) to idle experts
  const allUnanswered = await coordination.getUnansweredQuestions();
  const orphanedQuestions = allUnanswered.filter((q) => {
    if (answeredInPass.has(q.id)) return false;

    const target = (q.metadata?.targetPersona as ExpertPersona) || null;
    if (!target) return true;

    const targetState = expertStates.get(target);
    return !targetState || targetState.status !== "idle";
  });

  if (orphanedQuestions.length === 0) return;

  // Re-check which experts are still idle after pass 1
  const stillIdleExperts = Array.from(expertStates.entries())
    .filter(([_, state]) => state.status === "idle")
    .filter(([persona]) => !QUESTION_INELIGIBLE_PERSONAS.has(persona))
    .map(([persona]) => persona);

  if (stillIdleExperts.length === 0) return;

  for (const question of orphanedQuestions) {
    if (answeredInPass.has(question.id)) continue;

    const orphanRouting = await decisionClient.routeQuestion({
      question: question.content,
      targetPersona: (question.metadata?.targetPersona as string) || undefined,
      idleExperts: stillIdleExperts,
    });
    let responder: ExpertPersona | null = null;

    if (
      orphanRouting.targetExpert &&
      stillIdleExperts.includes(orphanRouting.targetExpert as ExpertPersona) &&
      orphanRouting.targetExpert !== question.fromPersona
    ) {
      responder = orphanRouting.targetExpert as ExpertPersona;
    } else {
      responder = stillIdleExperts.find((p) => p !== question.fromPersona) || null;
    }

    if (!responder) continue;

    const originalTarget = (question.metadata?.targetPersona as string) || "unknown";
    console.log(
      `[Epic] Routing orphaned question ${question.id} (target ${originalTarget} busy) to idle ${responder}`
    );
    await postLog(
      config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
      `Routing orphaned question to ${responder} (target ${originalTarget} busy)`
    );

    expertStates.set(responder, {
      persona: responder,
      status: "working",
    });

    try {
      const storyCtx = await getStoryContext(config, coordination, question);
      const answerText = await executor.answerQuestion(
        {
          id: question.id,
          parentTaskId: question.parentTaskId,
          taskId: undefined,
          persona: question.fromPersona,
          messageType: "question",
          content: question.content,
          metadata: question.metadata,
          createdAt: question.createdAt,
        },
        responder,
        storyCtx
      );
      answeredInPass.add(question.id);

      if (answerText) {
        const fromStory = question.metadata?.fromStory as number | undefined;
        if (fromStory !== undefined) {
          const worktreePath = activeWorktrees.get(fromStory);
          if (worktreePath) {
            writeAnswerToWorktree(worktreePath, question, answerText, responder);
          }
        }
      }
    } catch (error) {
      console.error(`[Epic] ${responder} failed to answer orphaned question:`, error);
    }

    expertStates.set(responder, {
      persona: responder,
      status: "idle",
    });

    const idx = stillIdleExperts.indexOf(responder);
    if (idx !== -1) stillIdleExperts.splice(idx, 1);
    if (stillIdleExperts.length === 0) break;
  }
}

/**
 * Process unanswered questions and route to experts.
 * Routing tiers:
 *   1. Target persona idle -> route directly (with story context)
 *   2. Decision API match idle -> route (with story context)
 *   3. Target known but busy -> write placeholder + spawn virtual expert
 *   4. No target match -> any idle coding expert (for generic questions, with context)
 *   5. ALL busy + no target -> write placeholder + spawn virtual expert (catch-all)
 */
export async function processQuestions(
  config: EpicConfig,
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  coordination: CoordinationClient,
  decisionClient: DecisionClient,
  executor: StoryExecutor,
  inFlightQuickAnswers: Set<string>
): Promise<void> {
  const questions = await coordination.getUnansweredQuestions();

  // Clean up in-flight quick answers for questions that have been answered
  const unansweredIds = new Set(questions.map((q) => q.id));
  for (const qId of inFlightQuickAnswers) {
    if (!unansweredIds.has(qId)) {
      inFlightQuickAnswers.delete(qId);
    }
  }

  for (const question of questions) {
    // Compute idle expert names for routing (exclude non-coding personas)
    const idleExpertNames = Array.from(expertStates.entries())
      .filter(([_, state]) => state.status === "idle")
      .filter(([persona]) => !QUESTION_INELIGIBLE_PERSONAS.has(persona))
      .map(([persona]) => persona);
    // Route via Decision API
    const routing = await decisionClient.routeQuestion({
      question: question.content,
      targetPersona: (question.metadata?.targetPersona as string) || undefined,
      idleExperts: idleExpertNames,
    });

    const effectiveTarget: ExpertPersona | null = question.metadata?.targetPersona
      ? (question.metadata.targetPersona as ExpertPersona)
      : (routing.targetExpert as ExpertPersona | null);

    // Tier 1: Target expert is idle — route directly
    const expertState = effectiveTarget ? expertStates.get(effectiveTarget) : undefined;
    if (expertState && expertState.status === "idle") {
      const storyCtx = await getStoryContext(config, coordination, question);
      console.log(`[Epic] Routing question from ${question.fromPersona} to ${effectiveTarget} (tier ${routing.routingTier}: ${routing.reason})`);
      const answerText = await executor.answerQuestion(
        {
          id: question.id,
          parentTaskId: question.parentTaskId,
          taskId: undefined,
          persona: question.fromPersona,
          messageType: "question",
          content: question.content,
          metadata: question.metadata,
          createdAt: question.createdAt,
        },
        effectiveTarget!,
        storyCtx
      );
      deliverAnswerToAsker(activeWorktrees, question, answerText, effectiveTarget!);
      continue;
    }

    // Tier 2: Target expert is busy — try routing result's fallback target if different and idle
    if (routing.targetExpert && routing.targetExpert !== effectiveTarget) {
      const routedTarget = routing.targetExpert as ExpertPersona;
      const routedState = expertStates.get(routedTarget);
      if (routedState && routedState.status === "idle") {
        const storyCtx = await getStoryContext(config, coordination, question);
        console.log(
          `[Epic] Target ${effectiveTarget} busy — routing question from ${question.fromPersona} to ${routedTarget} (tier ${routing.routingTier}: ${routing.reason})`
        );
        await postLog(
          config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
          `Routing question to ${routedTarget} (target ${effectiveTarget} busy)`
        );
        const answerText2a = await executor.answerQuestion(
          {
            id: question.id,
            parentTaskId: question.parentTaskId,
            taskId: undefined,
            persona: question.fromPersona,
            messageType: "question",
            content: question.content,
            metadata: question.metadata,
            createdAt: question.createdAt,
          },
          routedTarget,
          storyCtx
        );
        deliverAnswerToAsker(activeWorktrees, question, answerText2a, routedTarget);
        continue;
      }
    }

    // Tier 3: Target known but busy — spawn virtual expert with right persona
    if (effectiveTarget && !inFlightQuickAnswers.has(question.id)) {
      const storyCtx = await getStoryContext(config, coordination, question);
      inFlightQuickAnswers.add(question.id);
      writePendingPlaceholder(activeWorktrees, question, effectiveTarget);
      await postLog(
        config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
        `Spawning virtual ${effectiveTarget} for ${question.fromPersona}'s question`
      );
      executor
        .spawnVirtualExpert(
          {
            id: question.id,
            content: question.content,
            fromPersona: question.fromPersona,
            metadata: question.metadata,
          },
          effectiveTarget,
          storyCtx
        )
        .then((answerText) => deliverAnswerToAsker(activeWorktrees, question, answerText, effectiveTarget!))
        .catch((err) => console.error(`[Epic] Virtual expert failed for ${question.id}:`, err))
        .finally(() => inFlightQuickAnswers.delete(question.id));
      continue;
    }

    // Tier 4: No target specialty — fall back to any idle expert (for generic questions)
    if (!effectiveTarget) {
      const anyIdleExpert = Array.from(expertStates.entries()).find(
        ([persona, state]) =>
          state.status === "idle" &&
          persona !== question.fromPersona &&
          !QUESTION_INELIGIBLE_PERSONAS.has(persona)
      );
      if (anyIdleExpert) {
        const [fallbackPersona] = anyIdleExpert;
        const storyCtx = await getStoryContext(config, coordination, question);
        console.log(
          `[Epic] No target match — routing question from ${question.fromPersona} to idle ${fallbackPersona}`
        );
        await postLog(
          config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
          `Routing question to ${fallbackPersona} (no target match, no specialty match)`
        );
        const answerText2b = await executor.answerQuestion(
          {
            id: question.id,
            parentTaskId: question.parentTaskId,
            taskId: undefined,
            persona: question.fromPersona,
            messageType: "question",
            content: question.content,
            metadata: question.metadata,
            createdAt: question.createdAt,
          },
          fallbackPersona,
          storyCtx
        );
        deliverAnswerToAsker(activeWorktrees, question, answerText2b, fallbackPersona);
        continue;
      }
    }

    // Tier 5: ALL busy + no target — spawn virtual expert (catch-all)
    if (!inFlightQuickAnswers.has(question.id)) {
      const storyCtx = await getStoryContext(config, coordination, question);
      const bestGuessPersona = effectiveTarget || ("backend_developer" as ExpertPersona);
      console.log(
        `[Epic] All experts busy — spawning virtual ${bestGuessPersona} for ${question.id} from ${question.fromPersona}`
      );
      await postLog(
        config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
        `Spawning virtual ${bestGuessPersona} for ${question.id} (all experts busy)`
      );
      inFlightQuickAnswers.add(question.id);
      writePendingPlaceholder(activeWorktrees, question, bestGuessPersona);

      executor
        .spawnVirtualExpert(
          {
            id: question.id,
            content: question.content,
            fromPersona: question.fromPersona,
            metadata: question.metadata,
          },
          bestGuessPersona,
          storyCtx
        )
        .then((answerText) => {
          deliverAnswerToAsker(activeWorktrees, question, answerText, bestGuessPersona);
        })
        .catch((err) => {
          console.error(`[Epic] Virtual expert spawn failed for ${question.id}:`, err);
        })
        .finally(() => {
          inFlightQuickAnswers.delete(question.id);
        });
    }
  }
}
