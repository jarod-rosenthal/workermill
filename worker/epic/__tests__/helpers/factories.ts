import type { EpicConfig, ReadyStory, ExpertState, ContextMessage, ResilienceConfig, PendingQuestion, BlockerInfo } from "../../types.js";

export function makeConfig(overrides?: Partial<EpicConfig>): EpicConfig {
  return {
    parentTaskId: "task-1",
    apiBaseUrl: "http://localhost:3001",
    orgApiKey: "test-key",
    anthropicApiKey: "test-anthropic",
    githubToken: "test-github",
    targetRepo: "test/repo",
    maxReviewRevisions: 4,
    maxPerStoryRevisions: 0,
    ...overrides,
  } as EpicConfig;
}

export function makeStory(overrides?: Partial<ReadyStory>): ReadyStory {
  return {
    id: `story-${overrides?.storyIndex ?? 0}`,
    parentTaskId: "task-1",
    storyIndex: overrides?.storyIndex ?? 0,
    persona: "backend_developer",
    title: "Test Story",
    description: "Test description",
    dependencies: [],
    ...overrides,
  };
}

export function makeExpertState(overrides?: Partial<ExpertState>): ExpertState {
  return {
    persona: "backend_developer",
    status: "idle",
    ...overrides,
  };
}

export function makeContextMessage(overrides?: Partial<ContextMessage>): ContextMessage {
  return {
    id: `ctx-${Date.now()}`,
    parentTaskId: "task-1",
    persona: "backend_developer",
    messageType: "completion",
    content: "Test message",
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeResilience(overrides?: Partial<ResilienceConfig>): ResilienceConfig {
  return {
    blockerMaxAutoRetries: 3,
    blockerAutoRetryEnabled: true,
    pushAfterCommit: true,
    gracefulShutdownEnabled: true,
    fileOverlapGatingEnabled: true,
    incrementalRebaseEnabled: true,
    ...overrides,
  };
}

export function makeQuestion(overrides?: Partial<PendingQuestion>): PendingQuestion {
  return {
    id: `q-${Date.now()}`,
    parentTaskId: "task-1",
    fromPersona: "frontend_developer",
    content: "How should we handle the API?",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeBlockerInfo(overrides?: Partial<BlockerInfo>): BlockerInfo {
  return {
    id: `blocker-${Date.now()}`,
    parentTaskId: "task-1",
    storyIndex: 0,
    storyTitle: "Test Story",
    persona: "backend_developer",
    errorCategory: "typescript",
    summary: "TypeScript compilation error",
    errorMessage: "TS2322: Type error",
    affectedFiles: ["src/index.ts"],
    autoRetryAttempts: 0,
    maxAutoRetries: 3,
    dependentStories: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
