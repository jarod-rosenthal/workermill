export interface Board {
  id: string;
  name: string;
  prefix: string;
  description?: string;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
  orgId: string;
  userId: string;
  columns: Column[];
  cards?: Card[];
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  order: number;
  cards?: Card[];
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  issueKey: string;
  title: string;
  description?: string;
  priority: "urgent" | "high" | "medium" | "low";
  order: number;
  createdAt: string;
  updatedAt: string;
  labels: Label[];
  checklistItems: ChecklistItem[];
  dependencies?: CardDependency[];
  linkedTaskId?: string;
  linkedTaskStatus?: string;
  assigneeId?: string;
}

export interface Label {
  id: string;
  boardId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  cardId: string;
  text: string;
  isCompleted: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardDependency {
  id: string;
  cardId: string;
  dependsOnCardId: string;
  type: "blocks" | "relates_to";
  createdAt: string;
}