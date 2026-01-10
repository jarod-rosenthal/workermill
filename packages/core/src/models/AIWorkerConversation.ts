import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AIWorkerTask } from "./AIWorkerTask";
import { AIWorkerInstance } from "./AIWorkerInstance";

export type ConversationStatus = "active" | "completed" | "failed" | "paused";

export interface ConversationMessage {
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string | null;
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
  timestamp: string;
  tokenCount?: number;
}

@Entity("ai_worker_conversations")
export class AIWorkerConversation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "worker_id", type: "uuid" })
  workerId: string;

  @Column({ type: "varchar", length: 30, default: "active" })
  status: ConversationStatus;

  @Column({ name: "system_prompt", type: "text", nullable: true })
  systemPrompt: string | null;

  @Column({ type: "jsonb", default: "[]" })
  messages: ConversationMessage[];

  @Column({ name: "input_tokens", type: "int", default: 0 })
  inputTokens: number;

  @Column({ name: "output_tokens", type: "int", default: 0 })
  outputTokens: number;

  @Column({ name: "turn_count", type: "int", default: 0 })
  turnCount: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  model: string | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => AIWorkerTask, (task) => task.conversations, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: AIWorkerTask;

  @ManyToOne(() => AIWorkerInstance, { onDelete: "CASCADE" })
  @JoinColumn({ name: "worker_id" })
  worker: AIWorkerInstance;

  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
    if (message.role === "assistant") {
      this.turnCount++;
    }
    if (message.tokenCount) {
      if (message.role === "user" || message.role === "tool_result") {
        this.inputTokens += message.tokenCount;
      } else {
        this.outputTokens += message.tokenCount;
      }
    }
  }

  getLastMessage(): ConversationMessage | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  getToolCalls(): ConversationMessage[] {
    return this.messages.filter((m) => m.role === "tool_use");
  }

  getTotalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }
}
