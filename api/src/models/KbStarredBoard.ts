import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { KbBoard } from "./KbBoard.js";
import { User } from "./User.js";

@Entity("kb_starred_boards")
export class KbStarredBoard {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @PrimaryColumn({ name: "board_id", type: "uuid" })
  boardId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => KbBoard, (board) => board.starredBy, { onDelete: "CASCADE" })
  @JoinColumn({ name: "board_id" })
  board: KbBoard;
}
