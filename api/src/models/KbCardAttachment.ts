import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { KbCard } from "./KbCard.js";
import { User } from "./User.js";

@Entity("kb_card_attachments")
@Index(["cardId"])
export class KbCardAttachment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "card_id", type: "uuid" })
  cardId: string;

  @Column({ type: "varchar", length: 255 })
  filename: string;

  @Column({ name: "content_type", type: "varchar", length: 100 })
  contentType: string;

  @Column({ name: "size_bytes", type: "int" })
  sizeBytes: number;

  @Column({ type: "bytea" })
  data: Buffer;

  @Column({ name: "uploaded_by_id", type: "uuid", nullable: true })
  uploadedById: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbCard, (card) => card.attachments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "uploaded_by_id" })
  uploadedBy: User | null;
}
