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
  createdAt: string;
  updatedAt: string;
  cards: Card[];
}

export interface Card {
  id: string;
  board_id: string;
  column_id: string;
  issue_key: string;
  title: string;
  description?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  position: number;
  created_by: string;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  labels: Label[];
  checklist_items: ChecklistItem[];
  dependencies: CardDependency[];
  linked_task_id?: string;
  linked_task_status?: string;
  activity_count?: number;
}

export interface Label {
  id: string;
  board_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  card_id: string;
  text: string;
  completed: boolean;
  position: number;
  created_at: string;
  updated_at?: string;
}

export interface CardDependency {
  id: string;
  card_id: string;
  depends_on_card_id: string;
  dependency_type: 'blocks' | 'related';
  created_at: string;
  depends_on_card?: Pick<Card, 'id' | 'issue_key' | 'title'>;
}

export interface CardActivity {
  id: string;
  card_id: string;
  user_id: string;
  user_name: string;
  action: 'created' | 'moved' | 'edited' | 'task_started' | 'task_completed' | 'task_failed';
  details?: {
    from_column?: string;
    to_column?: string;
    field_changed?: string;
    old_value?: string;
    new_value?: string;
  };
  created_at: string;
}
