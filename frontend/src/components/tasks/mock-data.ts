/**
 * Hardcoded mock data for TaskDetailView development.
 * Mirrors real data shapes from MainDashboard + coordination-store.
 * Will be removed when integrating with real stores/SSE.
 */

import type { ContextMessage, ContextMessageType } from "../../store/coordination-store";

// --- StreamingLog (matches MainDashboard inline interface) ---

export interface StreamingLog {
  timestamp: number;
  message: string;
  logType?: string;
  severity?: string;
  command?: string;
  exitCode?: number;
  metadata?: {
    errorType?: "fatal" | "recoverable";
    [key: string]: unknown;
  };
}

// --- ParsedError (matches MainDashboard inline interface) ---

export interface ParsedError {
  timestamp: number;
  type: "error" | "warning";
  category: string;
  message: string;
  file?: string;
  line?: number;
  logIndex: number;
}

// --- BlockerData ---

export interface BlockerData {
  id: string;
  storyIndex: number;
  storyTitle: string;
  errorCategory: string;
  summary?: string;
  errorMessage: string;
  affectedFiles: string[];
  autoRetryAttempts: number;
  maxAutoRetries: number;
  dependentStories: number[];
  createdAt: string;
}

// --- Mock streaming logs covering all color categories ---

const now = Date.now();

export const mockStreamingLogs: StreamingLog[] = [
  { timestamp: now - 60000, message: "[Epic] Starting epic execution — 4 stories planned", logType: "system" },
  { timestamp: now - 59000, message: "[Coordinator] Claiming story 0: Set up authentication middleware" },
  { timestamp: now - 58000, message: "[🔧 backend_developer 🤖] Working on story 0 — auth middleware setup" },
  { timestamp: now - 57000, message: "$ npm install jsonwebtoken @types/jsonwebtoken" },
  { timestamp: now - 56000, message: "[Executor] Tool: Write → src/middleware/auth.ts" },
  { timestamp: now - 55000, message: "Created JWT verification middleware with role-based access control" },
  { timestamp: now - 54000, message: "[Executor] Tool: Write → src/routes/protected.ts" },
  { timestamp: now - 53000, message: "Added protected route handlers using auth middleware" },
  { timestamp: now - 52000, message: "$ npm test -- --run src/middleware/auth.test.ts" },
  { timestamp: now - 51000, message: "[SUCCESS] Tests passing (8/8)" },
  { timestamp: now - 50000, message: "[quality-runner] QUALITY SCORE: 94/100" },
  { timestamp: now - 49000, message: "[Coordinator] Story 0 completed successfully" },
  { timestamp: now - 48000, message: "[Coordinator] Claiming story 1: Add user profile endpoints" },
  { timestamp: now - 47000, message: "[🎨 frontend_developer 🤖] Working on story 1 — profile UI" },
  { timestamp: now - 46000, message: "[Executor] Tool: Edit → src/pages/Profile.tsx" },
  { timestamp: now - 45000, message: "Updated profile page layout with avatar upload support" },
  { timestamp: now - 44000, message: "[Executor] Tool: Write → src/components/AvatarUpload.tsx" },
  { timestamp: now - 43000, message: "$ git diff --stat" },
  { timestamp: now - 42000, message: " src/pages/Profile.tsx    | 45 ++++++++++++++" },
  { timestamp: now - 41000, message: " src/components/AvatarUpload.tsx | 82 ++++++++++++++++++++++++++" },
  { timestamp: now - 40000, message: "[SUCCESS] Story 1 completed" },
  { timestamp: now - 39000, message: "[Coordinator] Claiming story 2: Database migration for user preferences" },
  { timestamp: now - 38000, message: "[⚙️ backend_developer 🤖] Working on story 2 — preference storage" },
  { timestamp: now - 37000, message: "[Executor] Tool: Write → src/db/migrations/AddUserPreferences.ts" },
  { timestamp: now - 36000, message: "$ npm run migrate:run" },
  { timestamp: now - 35000, message: "[SUCCESS] Migration applied successfully" },
  { timestamp: now - 34000, message: "[quality-runner] QUALITY SCORE: 91/100" },
  { timestamp: now - 33000, message: "[Coordinator] Story 2 completed" },
  { timestamp: now - 32000, message: "[Coordinator] Claiming story 3: Fix TypeScript strict mode errors" },
  { timestamp: now - 31000, message: "[🔧 devops_engineer 🤖] Working on story 3 — strict mode fixes" },
  { timestamp: now - 30000, message: "[Executor] Tool: Edit → src/lib/utils.ts" },
  { timestamp: now - 29000, message: "$ npx tsc --noEmit", command: "npx tsc --noEmit" },
  {
    timestamp: now - 28000,
    message: "src/lib/auth.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
    severity: "error",
    logType: "error",
  },
  {
    timestamp: now - 27000,
    message: "src/routes/api.ts(15,10): error TS7006: Parameter 'req' implicitly has an 'any' type.",
    severity: "error",
    logType: "error",
  },
  { timestamp: now - 26000, message: "[WARN] 2 TypeScript errors remaining after auto-fix attempt", severity: "warning" },
  { timestamp: now - 25000, message: "[BLOCKER] Story 3 — TypeScript errors could not be auto-resolved" },
  { timestamp: now - 24000, message: "  at checkTypes (src/lib/auth.ts:42:5)" },
  { timestamp: now - 23000, message: "REVIEW_DECISION: Story 3 requires manual intervention", logType: "review" },
  { timestamp: now - 22000, message: "[tech_lead] Reviewing story 3 blocker — recommending type guard" },
];

// --- Mock parsed errors ---

export const mockParsedErrors: ParsedError[] = [
  {
    timestamp: now - 28000,
    type: "error",
    category: "TypeScript",
    message: "Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
    file: "src/lib/auth.ts",
    line: 42,
    logIndex: 27,
  },
  {
    timestamp: now - 27000,
    type: "error",
    category: "TypeScript",
    message: "Parameter 'req' implicitly has an 'any' type.",
    file: "src/routes/api.ts",
    line: 15,
    logIndex: 28,
  },
  {
    timestamp: now - 26000,
    type: "warning",
    category: "TypeScript",
    message: "2 TypeScript errors remaining after auto-fix attempt",
    logIndex: 29,
  },
];

// --- Mock coordination messages ---

const taskId = "mock-task-001";
const parentTaskId = "mock-parent-001";

function cm(
  id: string,
  persona: string,
  messageType: ContextMessageType,
  content: string,
  metadata?: Record<string, unknown>,
  minutesAgo = 0,
): ContextMessage {
  return {
    id,
    taskId,
    parentTaskId,
    persona,
    messageType,
    content,
    metadata,
    createdAt: new Date(now - minutesAgo * 60000).toISOString(),
  };
}

export const mockCoordinationMessages: ContextMessage[] = [
  cm("cm-01", "coordinator", "story_claimed", "Story 0: Set up authentication middleware", { storyIndex: 0 }, 10),
  cm("cm-02", "backend_developer", "file_created", "Created src/middleware/auth.ts", { storyIndex: 0, file: "src/middleware/auth.ts" }, 9),
  cm("cm-03", "backend_developer", "file_created", "Created src/routes/protected.ts", { storyIndex: 0, file: "src/routes/protected.ts" }, 8),
  cm("cm-04", "backend_developer", "completion", "Story 0 completed — auth middleware with JWT verification", { storyIndex: 0, qualityScore: 94 }, 7),
  cm("cm-05", "coordinator", "story_claimed", "Story 1: Add user profile endpoints", { storyIndex: 1 }, 6),
  cm("cm-06", "frontend_developer", "file_modified", "Modified src/pages/Profile.tsx", { storyIndex: 1, file: "src/pages/Profile.tsx" }, 5),
  cm("cm-07", "frontend_developer", "file_created", "Created src/components/AvatarUpload.tsx", { storyIndex: 1, file: "src/components/AvatarUpload.tsx" }, 5),
  cm("cm-08", "frontend_developer", "completion", "Story 1 completed — profile page with avatar upload", { storyIndex: 1, qualityScore: 91 }, 4),
  cm("cm-09", "coordinator", "story_claimed", "Story 2: Database migration for user preferences", { storyIndex: 2 }, 4),
  cm("cm-10", "backend_developer", "file_created", "Created src/db/migrations/AddUserPreferences.ts", { storyIndex: 2, file: "src/db/migrations/AddUserPreferences.ts" }, 3),
  cm("cm-11", "backend_developer", "completion", "Story 2 completed — preference table + CRUD endpoints", { storyIndex: 2, qualityScore: 91 }, 2),
  cm("cm-12", "coordinator", "story_claimed", "Story 3: Fix TypeScript strict mode errors", { storyIndex: 3 }, 2),
  cm("cm-13", "devops_engineer", "file_modified", "Modified src/lib/utils.ts", { storyIndex: 3, file: "src/lib/utils.ts" }, 1),
  cm("cm-14", "devops_engineer", "blocker_detected", "TypeScript errors in src/lib/auth.ts and src/routes/api.ts could not be auto-resolved", { storyIndex: 3 }, 0),
  cm("cm-15", "devops_engineer", "revision_requested", "Story 3 needs type guards added to auth.ts line 42", { storyIndex: 3 }, 0),
];

// --- Mock blocker ---

export const mockBlocker: BlockerData = {
  id: "blocker-001",
  storyIndex: 3,
  storyTitle: "Fix TypeScript strict mode errors",
  errorCategory: "typescript",
  summary: "TypeScript strict mode errors in auth.ts and api.ts could not be auto-resolved after 2 attempts",
  errorMessage:
    "src/lib/auth.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.\nsrc/routes/api.ts(15,10): error TS7006: Parameter 'req' implicitly has an 'any' type.",
  affectedFiles: ["src/lib/auth.ts", "src/routes/api.ts"],
  autoRetryAttempts: 2,
  maxAutoRetries: 3,
  dependentStories: [],
  createdAt: new Date(now).toISOString(),
};

// --- Mock task ---

export const mockTask = {
  id: taskId,
  parentTaskId,
  status: "executing" as const,
  summary: "Implement user authentication and profile management",
  ticketKey: "OCS-142",
  workerPersona: "backend_developer",
  ralphProgress: {
    totalStories: 4,
    completedStories: 3,
    activeStories: 1,
    failedStories: 0,
  },
};
