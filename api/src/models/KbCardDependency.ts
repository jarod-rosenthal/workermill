import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { KbCard } from "./KbCard.js";

@Entity("kb_card_dependencies")
export class KbCardDependency {
  @PrimaryColumn({ name: "card_id", type: "uuid" })
  cardId: string;

  @PrimaryColumn({ name: "depends_on_card_id", type: "uuid" })
  dependsOnCardId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => KbCard, (card) => card.dependencies, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;

  @ManyToOne(() => KbCard, (card) => card.dependents, { onDelete: "CASCADE" })
  @JoinColumn({ name: "depends_on_card_id" })
  dependsOnCard: KbCard;
}
