/**
 * Coordinator Commands Module
 *
 * Handles dashboard command polling (pause/resume/message), expert response
 * file checking, and worktree message delivery.
 */

import axios from "axios";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import type { ExpertPersona, ExpertState, EpicConfig, ResilienceConfig } from "./types.js";
import type { CoordinationClient } from "./coordination-client.js";
import { postLog, sleep } from "./coordinator-utils.js";

/**
 * Poll for pending commands from the dashboard (pause/resume/message).
 * Commands allow the user to interact with the worker in real-time.
 */
export async function pollForCommands(
  config: EpicConfig,
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  resilience: ResilienceConfig,
  coordination: CoordinationClient,
  missionActive: boolean,
  callbacks: {
    setUserFeedback: (feedback: string) => void;
    getUserFeedback: () => string | null;
    waitForResume: () => Promise<void>;
    setSelfReviewEnabled: (enabled: boolean) => void;
  }
): Promise<void> {
  try {
    const response = await axios.get(
      `${config.apiBaseUrl}/api/coordination/commands/${config.parentTaskId}/pending`,
      {
        headers: {
          "x-api-key": config.orgApiKey,
        },
        timeout: 10000,
      }
    );

    const commands = response.data?.commands || [];

    for (const cmd of commands) {
      console.log(`[Epic] Received command: ${cmd.type} - ${cmd.content || "(no content)"}`);

      if (cmd.type === "pause") {
        // Acknowledge pause and wait for resume
        await acknowledgeCommand(config, cmd.id);
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Pause requested by user — pausing after current stories complete");
        console.log("[Epic] Paused - waiting for resume...");
        await callbacks.waitForResume();
      } else if (cmd.type === "message" || cmd.type === "resume") {
        // Store message as user feedback for next expert
        if (cmd.content) {
          callbacks.setUserFeedback(cmd.content);
          console.log(`[Epic] User feedback received: ${cmd.content}`);

          const truncated =
            cmd.content.length > 200 ? cmd.content.substring(0, 200) + "..." : cmd.content;
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `Message received from user: ${truncated}`);

          // Deliver message file to all active expert worktrees for mid-execution visibility
          writeMessageToActiveWorktrees(expertStates, activeWorktrees, cmd.content);

          // Build rich acknowledgment with expert context
          const runningExperts = [...expertStates.entries()]
            .filter(([, s]) => s.status === "working" && s.currentStoryIndex !== undefined);

          let ackMessage: string;
          if (runningExperts.length > 0) {
            const expertDetails = runningExperts.map(([persona, s]) => {
              const storyLabel = `Story ${s.currentStoryIndex}`;
              return `${persona} (${storyLabel})`;
            }).join(", ");
            ackMessage = `Message delivered to ${expertDetails}. Feedback will be applied.`;
            await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `Message delivered to running expert(s): ${expertDetails}`);
          } else {
            ackMessage = "Message acknowledged — no experts currently running. Will apply to next story execution.";
            await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Message acknowledged — will apply to next story execution");
          }

          // Post acknowledgment to coordination feed (non-fatal if it fails)
          try {
            await coordination.postContext(
              "worker_ack",
              ackMessage,
              "coordinator",
              undefined,
              {
                commandId: cmd.id,
                commandType: cmd.type,
                feedbackWillBeAppliedTo: runningExperts.length > 0 ? "running_experts_and_next_story" : "next_story",
              }
            );
          } catch (ackError) {
            console.warn("[Epic] Failed to post ack to coordination feed:", ackError instanceof Error ? ackError.message : ackError);
          }
        }
        await acknowledgeCommand(config, cmd.id);
      } else if (cmd.type === "toggle_self_review") {
        const enabled = cmd.content === "enabled";
        callbacks.setSelfReviewEnabled(enabled);
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `Self-review ${enabled ? "enabled" : "disabled"} by user`);
        console.log(`[Epic] Self-review ${enabled ? "enabled" : "disabled"} by dashboard toggle`);
        await acknowledgeCommand(config, cmd.id);
      } else if (cmd.type === "question") {
        // Dashboard asking worker a question - log it, worker can't respond yet
        console.log(`[Epic] Question from user: ${cmd.content}`);
        await acknowledgeCommand(config, cmd.id);
      }
    }
  } catch (error) {
    // Non-fatal - just log and continue
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      // Task not found is expected if task was cancelled
      return;
    }
    console.warn("[Epic] Command polling failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * Write a user message to .workermill-message.md in all active expert worktrees.
 * This allows running Claude CLI experts to see messages mid-execution by reading the file.
 */
export function writeMessageToActiveWorktrees(
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  message: string
): void {
  let delivered = 0;
  for (const [persona, state] of expertStates) {
    if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

    const worktreePath = activeWorktrees.get(state.currentStoryIndex);
    if (!worktreePath) continue;

    try {
      const filePath = `${worktreePath}/.workermill-message.md`;
      const content = `# Message from User\n\n${message}\n\n---\n*Delivered at ${new Date().toISOString()}. Please read and incorporate this feedback into your current work.*\n`;
      writeFileSync(filePath, content, "utf-8");
      delivered++;
      console.log(`[Epic] Wrote message file to ${persona}'s worktree (story ${state.currentStoryIndex})`);
    } catch (err) {
      console.warn(`[Epic] Failed to write message file to ${persona}'s worktree:`, err instanceof Error ? err.message : err);
    }
  }
  if (delivered > 0) {
    console.log(`[Epic] Message delivered to ${delivered} active expert worktree(s)`);
  }
}

/**
 * Write an answer file to the asking expert's worktree so they can read it mid-execution.
 */
export function writeAnswerToWorktree(
  worktreePath: string,
  question: {
    id: string;
    content: string;
    fromPersona: string;
    metadata?: Record<string, unknown>;
  },
  answer: string,
  responder: ExpertPersona
): void {
  try {
    const filePath = `${worktreePath}/.workermill-answer.md`;
    const questionId =
      (question.metadata?.questionId as string) || question.id;
    const content = `# Answer to Your Question\n\n**Question (${questionId}):** ${question.content}\n\n**Answer from ${responder}:**\n\n${answer}\n\n---\n*Delivered at ${new Date().toISOString()}. Incorporate this into your current work.*\n`;
    writeFileSync(filePath, content, "utf-8");
    console.log(
      `[Epic] Wrote answer file to ${question.fromPersona}'s worktree (story ${question.metadata?.fromStory})`
    );
  } catch (err) {
    console.warn(
      `[Epic] Failed to write answer to worktree:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Look up the asking expert's worktree via fromStory metadata and deliver the answer file.
 */
export function deliverAnswerToAsker(
  activeWorktrees: Map<number, string>,
  question: {
    id: string;
    content: string;
    fromPersona: string;
    metadata?: Record<string, unknown>;
  },
  answerText: string | null,
  responder: ExpertPersona
): void {
  if (!answerText) return;
  const fromStory = question.metadata?.fromStory as number | undefined;
  if (fromStory === undefined) return;
  const worktreePath = activeWorktrees.get(fromStory);
  if (!worktreePath) return;
  writeAnswerToWorktree(worktreePath, question, answerText, responder);
}

/**
 * Write an "answer pending" placeholder to the asker's worktree.
 * Tells the worker that a virtual expert is researching their question.
 */
export function writePendingPlaceholder(
  activeWorktrees: Map<number, string>,
  question: { id: string; content: string; fromPersona: string; metadata?: Record<string, unknown> },
  targetPersona: string
): void {
  const fromStory = question.metadata?.fromStory as number | undefined;
  if (fromStory === undefined) return;
  const worktreePath = activeWorktrees.get(fromStory);
  if (!worktreePath) return;
  const questionId = (question.metadata?.questionId as string) || question.id;
  const content = `# Answer Pending\n\nA virtual **${targetPersona}** specialist is researching your question (${questionId}).\nA detailed answer will replace this file shortly.\n\n**Continue with work that doesn't depend on this answer.** Check back before finalizing related decisions.\n`;
  try {
    writeFileSync(`${worktreePath}/.workermill-answer.md`, content, "utf-8");
  } catch {
    /* non-fatal */
  }
}

/**
 * Remove .workermill-message.md, .workermill-response.md, and .workermill-answer.md
 * from a story's worktree (cleanup after story completion).
 */
export function cleanupMessageFiles(
  activeWorktrees: Map<number, string>,
  storyIndex: number
): void {
  const worktreePath = activeWorktrees.get(storyIndex);
  if (!worktreePath) return;

  for (const filename of [
    ".workermill-message.md",
    ".workermill-response.md",
    ".workermill-answer.md",
  ]) {
    try {
      const filePath = `${worktreePath}/${filename}`;
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        console.log(`[Epic] Cleaned up ${filename} from story ${storyIndex} worktree`);
      }
    } catch (err) {
      // Non-fatal — worktree may already be removed
    }
  }
}

/**
 * Check active expert worktrees for .workermill-response.md files.
 * When found, read the content, post it to the coordination feed, and delete the file.
 * This enables experts to send messages to the user mid-execution.
 */
export async function checkExpertResponses(
  config: EpicConfig,
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  coordination: CoordinationClient
): Promise<void> {
  for (const [persona, state] of expertStates) {
    if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

    const worktreePath = activeWorktrees.get(state.currentStoryIndex);
    if (!worktreePath) continue;

    const filePath = `${worktreePath}/.workermill-response.md`;
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, "utf-8").trim();
      unlinkSync(filePath);

      if (!content) continue;

      console.log(`[Epic] Expert response from ${persona} (story ${state.currentStoryIndex}): ${content.substring(0, 100)}`);

      // Post to coordination feed so user sees it on the dashboard
      await coordination.postContext(
        "expert_response",
        content,
        persona,
        undefined,
        {
          storyIndex: state.currentStoryIndex,
          deliveryMethod: "worktree_file",
        }
      );

      // Also post to dashboard log for immediate visibility
      const truncated = content.length > 300 ? content.substring(0, 300) + "..." : content;
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `💬 ${persona} says: ${truncated}`);
    } catch (err) {
      console.warn(`[Epic] Failed to read expert response from ${persona}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Acknowledge a command to mark it as received.
 */
export async function acknowledgeCommand(config: EpicConfig, commandId: string): Promise<void> {
  try {
    await axios.post(
      `${config.apiBaseUrl}/api/coordination/commands/${commandId}/acknowledge`,
      {},
      {
        headers: {
          "x-api-key": config.orgApiKey,
        },
        timeout: 10000,
      }
    );
  } catch (error) {
    console.warn("[Epic] Failed to acknowledge command:", error instanceof Error ? error.message : error);
  }
}

/**
 * Wait for a resume command from the dashboard.
 * Polls every 2 seconds until a resume is received.
 */
export async function waitForResume(
  config: EpicConfig,
  coordination: CoordinationClient,
  isMissionActive: () => boolean,
  setUserFeedback: (feedback: string) => void
): Promise<void> {
  while (isMissionActive()) {
    await sleep(2000);

    try {
      const response = await axios.get(
        `${config.apiBaseUrl}/api/coordination/commands/${config.parentTaskId}/pending`,
        {
          headers: {
            "x-api-key": config.orgApiKey,
          },
          timeout: 10000,
        }
      );

      const commands = response.data?.commands || [];
      const resumeCmd = commands.find((c: { type: string }) => c.type === "resume");

      if (resumeCmd) {
        if (resumeCmd.content) {
          setUserFeedback(resumeCmd.content);
          console.log(`[Epic] Resumed with feedback: ${resumeCmd.content}`);

          // Post acknowledgment to coordination feed
          await coordination.postContext(
            "worker_ack",
            `✅ Worker received message: "${resumeCmd.content}"`,
            "coordinator",
            undefined,
            {
              commandId: resumeCmd.id,
              commandType: "resume",
              feedbackWillBeAppliedTo: "next_story",
            }
          );
        } else {
          console.log("[Epic] Resumed without feedback");
        }
        await acknowledgeCommand(config, resumeCmd.id);
        return;
      }

      // Also check for other commands while paused (e.g., additional messages)
      for (const cmd of commands) {
        if (cmd.type === "message" && cmd.content) {
          setUserFeedback(cmd.content);
          console.log(`[Epic] Message while paused: ${cmd.content}`);

          // Post acknowledgment to coordination feed
          await coordination.postContext(
            "worker_ack",
            `✅ Worker received message: "${cmd.content}"`,
            "coordinator",
            undefined,
            {
              commandId: cmd.id,
              commandType: "message",
              feedbackWillBeAppliedTo: "next_story",
            }
          );
          await acknowledgeCommand(config, cmd.id);
        }
      }
    } catch (error) {
      console.warn("[Epic] Resume polling failed:", error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Look up the asking expert's story context for enriching answer prompts.
 * Returns a formatted string with story title, description, target files, and task summary.
 */
export async function getStoryContext(
  config: EpicConfig,
  coordination: CoordinationClient,
  question: { fromPersona: string; metadata?: Record<string, unknown> }
): Promise<string> {
  const fromStory = question.metadata?.fromStory as number | undefined;
  if (fromStory === undefined) return "";
  const stories = await coordination.getReadyStories();
  const story = stories.find((s) => s.storyIndex === fromStory);
  if (!story) return "";
  let ctx = `The asking expert (${question.fromPersona}) is working on Story ${story.storyIndex}: "${story.title}"`;
  if (story.description) ctx += `\nStory description: ${story.description}`;
  if (story.targetFiles?.length) ctx += `\nTarget files: ${story.targetFiles.join(", ")}`;
  if (config.taskSummary) ctx += `\nOverall task: ${config.taskSummary}`;
  return ctx;
}
