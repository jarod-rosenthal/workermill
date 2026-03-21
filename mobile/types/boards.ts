export interface Board {
  id: string;
  name: string;
  description?: string;
  prefix: string;
  position?: number;
  template?: string;
  metadata?: any;
  qualityGateCommands?: string;
  ciWorkflowPath?: string;
  priority?: string;
  dueDate?: string;
  assigneeId?: string;
  status?: string;
  prdSource?: string;
  cardCount: number;
  columnCount: number;
  isStarred?: boolean;
  createdAt: string;
  updatedAt: string;
  columns: Column[];
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color?: string;
  wipLimit?: number;
  createdAt: string;
  cards: Card[];
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  issueKey: string;
  title: string;
  description?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  position: number;
  coverColor?: string;
  requesterName?: string;
  assigneeId?: string;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  githubRepo?: string;
  labels: Label[];
  checklistItems: ChecklistItem[];
  dependencies: CardDependency[];
  dependents: CardDependency[];
  workerTaskId?: string;
  workerStatus?: string;
  commentCount?: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  cardId: string;
  title: string;
  isCompleted: boolean;
  position: number;
  createdAt: string;
}

export interface CardDependency {
  cardId: string;
  title: string;
}

export interface CardActivity {
  id: string;
  cardId: string;
  userId: string;
  userName: string;
  action: 'created' | 'moved' | 'edited' | 'task_started' | 'task_completed' | 'task_failed';
  details?: {
    fromColumn?: string;
    toColumn?: string;
    fieldChanged?: string;
    oldValue?: string;
    newValue?: string;
  };
  createdAt: string;
}
