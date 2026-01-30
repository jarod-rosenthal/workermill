import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";

/**
 * Type of code chunk
 */
export type ChunkType = "full_file" | "function" | "class" | "block" | "import_block";

/**
 * Type of symbol extracted from code
 */
export type SymbolType =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "constant"
  | "variable"
  | "enum"
  | "method"
  | "property";

/**
 * Codebase Index entity for storing code chunks with embeddings.
 * Part of the Codebase RAG system for code-grounded context.
 */
@Entity("codebase_index")
@Index(["orgId", "repository"])
@Index(["orgId", "repository", "branch"])
@Index(["fileHash"])
@Index(["language"])
@Index(["symbolName"])
@Index(["chunkType"])
export class CodebaseIndex {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // Repository identification
  @Column({ type: "varchar", length: 255 })
  repository: string;

  @Column({ type: "varchar", length: 255, default: "main" })
  branch: string;

  // File/chunk identification
  @Column({ name: "file_path", type: "varchar", length: 1000 })
  filePath: string;

  @Column({ name: "file_hash", type: "varchar", length: 64 })
  fileHash: string;

  @Column({ name: "chunk_index", type: "int", default: 0 })
  chunkIndex: number;

  @Column({ name: "chunk_type", type: "varchar", length: 50 })
  chunkType: ChunkType;

  // Content
  @Column({ type: "text" })
  content: string;

  @Column({ name: "start_line", type: "int", nullable: true })
  startLine: number | null;

  @Column({ name: "end_line", type: "int", nullable: true })
  endLine: number | null;

  // Metadata
  @Column({ type: "varchar", length: 50, nullable: true })
  language: string | null;

  @Column({ name: "symbol_name", type: "varchar", length: 255, nullable: true })
  symbolName: string | null;

  @Column({ name: "symbol_type", type: "varchar", length: 50, nullable: true })
  symbolType: SymbolType | null;

  // Embedding stored as string, not using TypeORM's built-in vector support
  // The actual vector operations are done via raw SQL queries
  @Column({ type: "text", nullable: true })
  embedding: string | null;

  // Tracking
  @Column({ name: "indexed_at", type: "timestamp with time zone", default: () => "NOW()" })
  indexedAt: Date;

  @Column({ name: "access_count", type: "int", default: 0 })
  accessCount: number;

  @Column({ name: "last_accessed_at", type: "timestamp with time zone", nullable: true })
  lastAccessedAt: Date | null;
}
