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

@Entity("kb_checklist_items")
@Index(["cardId"])
export class KbChecklist {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "card_id", type: "uuid" })
  cardId: string;

  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ name: "is_completed", type: "boolean", default: false })
  isCompleted: boolean;

  @Column({ type: "int", default: 0 })
  position: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbCard, (card) => card.checklistItems, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;
}
