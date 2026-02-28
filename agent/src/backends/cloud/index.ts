/**
 * CloudBackend — wraps existing agent code (api.ts, poller.ts) behind AgentBackend.
 *
 * Implemented in Phase B. This stub exists so the backend selector can import it.
 */

import type { AgentBackend } from "../types.js";

export class CloudBackend implements AgentBackend {
  readonly mode = "cloud" as const;

  async initialize(): Promise<void> {
    throw new Error("CloudBackend not yet implemented — use 'workermill-agent setup' for cloud mode");
  }

  async shutdown(): Promise<void> {}

  // All methods throw — this is a stub. Phase B will implement them
  // by wrapping the existing api.ts and poller.ts modules.
  onStreamEvent(): void { throw new Error("Not implemented"); }
  offStreamEvent(): void { throw new Error("Not implemented"); }
  getTasks(): Promise<any> { throw new Error("Not implemented"); }
  getTask(): Promise<any> { throw new Error("Not implemented"); }
  createTask(): Promise<any> { throw new Error("Not implemented"); }
  cancelTask(): Promise<any> { throw new Error("Not implemented"); }
  retryTask(): Promise<any> { throw new Error("Not implemented"); }
  claimTask(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskStarted(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskCompleted(): Promise<any> { throw new Error("Not implemented"); }
  reportTaskFailed(): Promise<any> { throw new Error("Not implemented"); }
  postLog(): Promise<any> { throw new Error("Not implemented"); }
  postCoordinationMessage(): Promise<any> { throw new Error("Not implemented"); }
  getCoordinationContext(): Promise<any> { throw new Error("Not implemented"); }
  talkToWorker(): Promise<any> { throw new Error("Not implemented"); }
  respondToBlocker(): Promise<any> { throw new Error("Not implemented"); }
  postCodeEvent(): Promise<any> { throw new Error("Not implemented"); }
  getLogBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getCoordinationBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getCodeBackfill(): Promise<any> { throw new Error("Not implemented"); }
  getPrdPrompt(): Promise<any> { throw new Error("Not implemented"); }
  decomposePrd(): Promise<any> { throw new Error("Not implemented"); }
  getBoards(): Promise<any> { throw new Error("Not implemented"); }
  getBoard(): Promise<any> { throw new Error("Not implemented"); }
  createBoard(): Promise<any> { throw new Error("Not implemented"); }
  deleteBoard(): Promise<any> { throw new Error("Not implemented"); }
  getBoardCards(): Promise<any> { throw new Error("Not implemented"); }
  createCard(): Promise<any> { throw new Error("Not implemented"); }
  updateCard(): Promise<any> { throw new Error("Not implemented"); }
  moveCard(): Promise<any> { throw new Error("Not implemented"); }
  runCard(): Promise<any> { throw new Error("Not implemented"); }
  runAllCards(): Promise<any> { throw new Error("Not implemented"); }
  getSettings(): Promise<any> { throw new Error("Not implemented"); }
  updateSettings(): Promise<any> { throw new Error("Not implemented"); }
  getRepos(): Promise<any> { throw new Error("Not implemented"); }
  approvePlan(): Promise<any> { throw new Error("Not implemented"); }
  rejectPlan(): Promise<any> { throw new Error("Not implemented"); }
}
