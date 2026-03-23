import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies
vi.mock("../coordinator-utils.js", () => ({
  postLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../coordinator-commands.js", () => ({
  writeAnswerToWorktree: vi.fn(),
  deliverAnswerToAsker: vi.fn(),
  writePendingPlaceholder: vi.fn(),
  getStoryContext: vi.fn().mockResolvedValue("Some story context"),
}));

import type { ExpertPersona, ExpertState, PendingQuestion } from "../../epic/types.js";
import { processAnswerFirst, processQuestions } from "../coordinator-questions.js";
import { writeAnswerToWorktree, deliverAnswerToAsker, writePendingPlaceholder, getStoryContext } from "../coordinator-commands.js";
import { makeConfig, makeQuestion } from "./helpers/factories.js";

function makeExpertStates(entries: [string, string][]): Map<ExpertPersona, ExpertState> {
  const map = new Map<ExpertPersona, ExpertState>();
  for (const [persona, status] of entries) {
    map.set(persona as ExpertPersona, { persona: persona as ExpertPersona, status: status as ExpertState["status"] });
  }
  return map;
}

function makeMockCoordination() {
  return {
    getQuestionsForPersona: vi.fn().mockResolvedValue([]),
    getUnansweredQuestions: vi.fn().mockResolvedValue([]),
  };
}

function makeMockDecisionClient() {
  return {
    routeQuestion: vi.fn().mockResolvedValue({
      targetExpert: null,
      routingTier: 3,
      reason: "No matching expert",
    }),
  };
}

function makeMockExecutor() {
  return {
    answerQuestion: vi.fn().mockResolvedValue("The answer is 42"),
    spawnVirtualExpert: vi.fn().mockResolvedValue("Virtual answer"),
  };
}

describe("coordinator-questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // processAnswerFirst
  // ==========================================================================

  describe("processAnswerFirst", () => {
    const config = makeConfig();

    it("does nothing when no experts are idle", async () => {
      const expertStates = makeExpertStates([["backend_developer", "working"]]);
      const coordination = makeMockCoordination();
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(coordination.getQuestionsForPersona).not.toHaveBeenCalled();
    });

    it("does nothing when idle expert has no pending questions", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const coordination = makeMockCoordination();
      coordination.getQuestionsForPersona.mockResolvedValue([]);
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).not.toHaveBeenCalled();
    });

    it("has idle expert answer targeted questions", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const question = makeQuestion({
        id: "q-1",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "backend_developer", fromStory: 1 },
      });
      const coordination = makeMockCoordination();
      coordination.getQuestionsForPersona.mockResolvedValue([question]);
      coordination.getUnansweredQuestions.mockResolvedValue([]);
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const activeWorktrees = new Map<number, string>([[1, "/tmp/worktree-1"]]);
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        activeWorktrees,
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).toHaveBeenCalledTimes(1);
      expect(executor.answerQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-1", persona: "frontend_developer" }),
        "backend_developer",
        "Some story context"
      );
      // Should write answer to worktree
      expect(writeAnswerToWorktree).toHaveBeenCalledWith(
        "/tmp/worktree-1",
        question,
        "The answer is 42",
        "backend_developer"
      );
    });

    it("sets expert status to working during answering and back to idle after", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const question = makeQuestion({ id: "q-1" });
      const coordination = makeMockCoordination();
      coordination.getQuestionsForPersona.mockResolvedValue([question]);
      coordination.getUnansweredQuestions.mockResolvedValue([]);
      const decisionClient = makeMockDecisionClient();

      const statusDuringAnswer: string[] = [];
      const executor = makeMockExecutor();
      executor.answerQuestion.mockImplementation(async () => {
        statusDuringAnswer.push(expertStates.get("backend_developer" as ExpertPersona)!.status);
        return "answer";
      });
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(statusDuringAnswer).toEqual(["working"]);
      expect(expertStates.get("backend_developer" as ExpertPersona)!.status).toBe("idle");
    });

    it("routes orphaned questions to idle experts in pass 2", async () => {
      const expertStates = makeExpertStates([
        ["backend_developer", "idle"],
        ["frontend_developer", "working"],
      ]);
      const orphanedQuestion = makeQuestion({
        id: "q-orphan",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "frontend_developer" }, // target is busy
      });
      const coordination = makeMockCoordination();
      coordination.getQuestionsForPersona.mockResolvedValue([]);
      coordination.getUnansweredQuestions.mockResolvedValue([orphanedQuestion]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: "backend_developer",
        routingTier: 2,
        reason: "Best available match",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).toHaveBeenCalledTimes(1);
      expect(executor.answerQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-orphan" }),
        "backend_developer",
        "Some story context"
      );
    });

    it("excludes ineligible personas from orphan routing", async () => {
      const expertStates = makeExpertStates([
        ["support_agent", "idle"],
        ["tech_writer", "idle"],
      ]);
      const question = makeQuestion({
        id: "q-1",
        fromPersona: "backend_developer",
        metadata: { targetPersona: "backend_developer" },
      });
      const coordination = makeMockCoordination();
      coordination.getQuestionsForPersona.mockResolvedValue([]);
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processAnswerFirst(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      // Neither support_agent nor tech_writer should be used
      expect(executor.answerQuestion).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // processQuestions
  // ==========================================================================

  describe("processQuestions", () => {
    const config = makeConfig();

    it("does nothing when there are no unanswered questions", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([]);
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).not.toHaveBeenCalled();
      expect(executor.spawnVirtualExpert).not.toHaveBeenCalled();
    });

    it("routes to target persona when idle (tier 1)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const question = makeQuestion({
        id: "q-1",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "backend_developer" },
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: "backend_developer",
        routingTier: 1,
        reason: "Direct match",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-1" }),
        "backend_developer",
        "Some story context"
      );
      expect(deliverAnswerToAsker).toHaveBeenCalled();
    });

    it("routes to decision API fallback when target is busy (tier 2)", async () => {
      const expertStates = makeExpertStates([
        ["backend_developer", "working"],
        ["devops_engineer", "idle"],
      ]);
      const question = makeQuestion({
        id: "q-1",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "backend_developer" },
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: "devops_engineer",
        routingTier: 2,
        reason: "Fallback to available expert",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-1" }),
        "devops_engineer",
        "Some story context"
      );
    });

    it("spawns virtual expert when target is known but busy (tier 3)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "working"]]);
      const question = makeQuestion({
        id: "q-1",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "backend_developer" },
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      // Decision API also can't find idle expert
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: "backend_developer",
        routingTier: 3,
        reason: "All busy",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(writePendingPlaceholder).toHaveBeenCalled();
      expect(executor.spawnVirtualExpert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-1" }),
        "backend_developer",
        "Some story context"
      );
      expect(inFlight.has("q-1")).toBe(true);
    });

    it("skips in-flight questions for virtual expert spawn (tier 3)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "working"]]);
      const question = makeQuestion({
        id: "q-already-inflight",
        fromPersona: "frontend_developer",
        metadata: { targetPersona: "backend_developer" },
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: "backend_developer",
        routingTier: 3,
        reason: "All busy",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>(["q-already-inflight"]);

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      // Should NOT spawn again since already in-flight
      expect(executor.spawnVirtualExpert).not.toHaveBeenCalled();
    });

    it("routes to any idle expert for generic questions (tier 4)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const question = makeQuestion({
        id: "q-generic",
        fromPersona: "devops_engineer",
        // No targetPersona in metadata
        metadata: {},
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      // No target from decision API either
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: null,
        routingTier: 4,
        reason: "No specialty match",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      expect(executor.answerQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-generic" }),
        "backend_developer",
        "Some story context"
      );
    });

    it("spawns virtual expert as catch-all when all busy and no target (tier 5)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "working"]]);
      const question = makeQuestion({
        id: "q-catchall",
        fromPersona: "frontend_developer",
        metadata: {},
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: null,
        routingTier: 5,
        reason: "All busy, no specialty",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      // Falls through to tier 5 — spawn virtual with default persona
      expect(executor.spawnVirtualExpert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q-catchall" }),
        "backend_developer", // defaults to backend_developer
        "Some story context"
      );
      expect(inFlight.has("q-catchall")).toBe(true);
    });

    it("cleans up in-flight set for answered questions", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const coordination = makeMockCoordination();
      // Only q-2 is unanswered now — q-1 was answered
      coordination.getUnansweredQuestions.mockResolvedValue([]);
      const decisionClient = makeMockDecisionClient();
      const executor = makeMockExecutor();
      const inFlight = new Set<string>(["q-old-answered"]);

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      // q-old-answered should be cleaned from inFlight since it's no longer unanswered
      expect(inFlight.has("q-old-answered")).toBe(false);
    });

    it("does not route to the question's own asker (tier 4)", async () => {
      const expertStates = makeExpertStates([["backend_developer", "idle"]]);
      const question = makeQuestion({
        id: "q-self",
        fromPersona: "backend_developer", // same as the only idle expert
        metadata: {},
      });
      const coordination = makeMockCoordination();
      coordination.getUnansweredQuestions.mockResolvedValue([question]);
      const decisionClient = makeMockDecisionClient();
      decisionClient.routeQuestion.mockResolvedValue({
        targetExpert: null,
        routingTier: 4,
        reason: "No match",
      });
      const executor = makeMockExecutor();
      const inFlight = new Set<string>();

      await processQuestions(
        config,
        expertStates,
        new Map(),
        coordination as any,
        decisionClient as any,
        executor as any,
        inFlight
      );

      // Should NOT answer own question — falls through to tier 5
      expect(executor.answerQuestion).not.toHaveBeenCalled();
      // Tier 5 spawns virtual expert instead
      expect(executor.spawnVirtualExpert).toHaveBeenCalled();
    });
  });
});
