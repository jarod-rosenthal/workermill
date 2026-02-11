import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { KbCard } from "./KbCard.js";
import { KbLabel } from "./KbLabel.js";

@Entity("kb_card_labels")
export class KbCardLabel {
  @PrimaryColumn({ name: "card_id", type: "uuid" })
  cardId: string;

  @PrimaryColumn({ name: "label_id", type: "uuid" })
  labelId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbCard, (card) => card.cardLabels, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;

  @ManyToOne(() => KbLabel, { onDelete: "CASCADE" })
  @JoinColumn({ name: "label_id" })
  label: KbLabel;
}
