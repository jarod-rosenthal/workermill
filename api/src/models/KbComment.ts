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

@Entity("kb_comments")
@Index(["cardId"])
export class KbComment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "card_id", type: "uuid" })
  cardId: string;

  @Column({ name: "author_id", type: "uuid", nullable: true })
  authorId: string | null;

  @Column({ type: "text" })
  content: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbCard, (card) => card.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "author_id" })
  author: User | null;
}
