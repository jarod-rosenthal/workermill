import apiClient from "./api-client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Board {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
  isStarred: boolean;
  columnCount: number;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  wipLimit: number | null;
  cards: Card[];
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  issueKey: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  dueDate: string | null;
  coverColor: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requesterName: string | null;
  labels: Label[];
  checklistItems: ChecklistItem[];
  commentCount: number;
  githubRepo: string | null;
  workerTaskId: string | null;
  workerStatus: string | null;
  dependencies?: { cardId: string; title: string }[];
  dependents?: { cardId: string; title: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  cardId: string;
  content: string;
  author: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  cardId: string;
  title: string;
  isCompleted: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  boardId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface BoardDetail {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
  isStarred: boolean;
  columns: Column[];
  prdContent: string | null;
  prdSource: string | null;
  githubRepo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoardData {
  name: string;
  description?: string;
  prefix?: string;
  template?: "empty" | "project" | "bug_tracker";
}

export interface CreateColumnData {
  name: string;
  color?: string;
  wipLimit?: number;
}

export interface UpdateColumnData {
  name?: string;
  color?: string | null;
  wipLimit?: number | null;
}

export interface CreateCardData {
  columnId: string;
  title: string;
  description?: string;
  priority?: "urgent" | "high" | "medium" | "low";
  dueDate?: string;
  coverColor?: string;
  githubRepo?: string;
}

export interface UpdateCardData {
  title?: string;
  description?: string | null;
  priority?: "urgent" | "high" | "medium" | "low" | null;
  dueDate?: string | null;
  coverColor?: string | null;
  assigneeId?: string | null;
  githubRepo?: string | null;
}

export interface MoveCardData {
  columnId: string;
  position: number;
}

export interface CreateLabelData {
  name: string;
  color: string;
}

export interface UpdateLabelData {
  name?: string;
  color?: string;
}

// ── API Methods ────────────────────────────────────────────────────────────

// Boards
export async function getBoards(): Promise<Board[]> {
  const response = await apiClient.get("/boards");
  return response.data.boards ?? response.data;
}

export async function createBoard(data: CreateBoardData): Promise<Board> {
  const response = await apiClient.post("/boards", data);
  return response.data.board ?? response.data;
}

export async function getBoard(boardId: string): Promise<BoardDetail> {
  const response = await apiClient.get(`/boards/${boardId}`);
  return response.data.board ?? response.data;
}

export async function updateBoard(
  boardId: string,
  data: Partial<Pick<Board, "name" | "description">>,
): Promise<Board> {
  const response = await apiClient.put(`/boards/${boardId}`, data);
  return response.data.board ?? response.data;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await apiClient.delete(`/boards/${boardId}`);
}

export async function starBoard(boardId: string): Promise<void> {
  await apiClient.post(`/boards/${boardId}/star`);
}

// Columns
export async function getColumns(boardId: string): Promise<Column[]> {
  const response = await apiClient.get(`/boards/${boardId}/columns`);
  return response.data.columns ?? response.data;
}

export async function createColumn(
  boardId: string,
  data: CreateColumnData,
): Promise<Column> {
  const response = await apiClient.post(`/boards/${boardId}/columns`, data);
  return response.data.column ?? response.data;
}

export async function updateColumn(
  boardId: string,
  colId: string,
  data: UpdateColumnData,
): Promise<Column> {
  const response = await apiClient.put(
    `/boards/${boardId}/columns/${colId}`,
    data,
  );
  return response.data.column ?? response.data;
}

export async function deleteColumn(
  boardId: string,
  colId: string,
): Promise<void> {
  await apiClient.delete(`/boards/${boardId}/columns/${colId}`);
}

export async function reorderColumns(
  boardId: string,
  columnIds: string[],
): Promise<void> {
  await apiClient.patch(`/boards/${boardId}/columns/reorder`, { columnIds });
}

// Cards
export async function createCard(
  boardId: string,
  data: CreateCardData,
): Promise<Card> {
  const response = await apiClient.post(`/boards/${boardId}/cards`, data);
  return response.data.card ?? response.data;
}

export async function getCard(
  boardId: string,
  cardId: string,
): Promise<Card> {
  const response = await apiClient.get(
    `/boards/${boardId}/cards/${cardId}`,
  );
  return response.data.card ?? response.data;
}

export async function updateCard(
  boardId: string,
  cardId: string,
  data: UpdateCardData,
): Promise<Card> {
  const response = await apiClient.put(
    `/boards/${boardId}/cards/${cardId}`,
    data,
  );
  return response.data.card ?? response.data;
}

export async function deleteCard(
  boardId: string,
  cardId: string,
): Promise<void> {
  await apiClient.delete(`/boards/${boardId}/cards/${cardId}`);
}

export async function moveCard(
  boardId: string,
  cardId: string,
  data: MoveCardData,
): Promise<void> {
  await apiClient.patch(`/boards/${boardId}/cards/${cardId}/move`, data);
}

export async function reorderCards(
  boardId: string,
  items: { cardId: string; columnId: string; position: number }[],
): Promise<void> {
  await apiClient.patch(`/boards/${boardId}/cards/reorder`, { items });
}

// Labels
export async function getLabels(): Promise<Label[]> {
  const response = await apiClient.get("/boards/labels");
  return response.data.labels ?? response.data;
}

export async function createLabel(data: CreateLabelData): Promise<Label> {
  const response = await apiClient.post("/boards/labels", data);
  return response.data.label ?? response.data;
}

export async function updateLabel(
  labelId: string,
  data: UpdateLabelData,
): Promise<Label> {
  const response = await apiClient.put(`/boards/labels/${labelId}`, data);
  return response.data.label ?? response.data;
}

export async function deleteLabel(labelId: string): Promise<void> {
  await apiClient.delete(`/boards/labels/${labelId}`);
}

export async function addCardLabel(
  boardId: string,
  cardId: string,
  labelId: string,
): Promise<void> {
  await apiClient.post(`/boards/${boardId}/cards/${cardId}/labels`, {
    labelId,
  });
}

export async function removeCardLabel(
  boardId: string,
  cardId: string,
  labelId: string,
): Promise<void> {
  await apiClient.delete(
    `/boards/${boardId}/cards/${cardId}/labels/${labelId}`,
  );
}

// Comments
export async function getComments(
  boardId: string,
  cardId: string,
): Promise<Comment[]> {
  const response = await apiClient.get(
    `/boards/${boardId}/cards/${cardId}/comments`,
  );
  return response.data.comments ?? response.data;
}

export async function addComment(
  boardId: string,
  cardId: string,
  content: string,
): Promise<Comment> {
  const response = await apiClient.post(
    `/boards/${boardId}/cards/${cardId}/comments`,
    { content },
  );
  return response.data.comment ?? response.data;
}

export async function deleteComment(
  boardId: string,
  cardId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(
    `/boards/${boardId}/cards/${cardId}/comments/${commentId}`,
  );
}

// Checklist
export async function addChecklistItem(
  boardId: string,
  cardId: string,
  data: { title: string },
): Promise<ChecklistItem> {
  const response = await apiClient.post(
    `/boards/${boardId}/cards/${cardId}/checklist`,
    data,
  );
  return response.data.item ?? response.data;
}

export async function updateChecklistItem(
  boardId: string,
  cardId: string,
  itemId: string,
  data: { title?: string; isCompleted?: boolean },
): Promise<ChecklistItem> {
  const response = await apiClient.put(
    `/boards/${boardId}/cards/${cardId}/checklist/${itemId}`,
    data,
  );
  return response.data.item ?? response.data;
}

export async function deleteChecklistItem(
  boardId: string,
  cardId: string,
  itemId: string,
): Promise<void> {
  await apiClient.delete(
    `/boards/${boardId}/cards/${cardId}/checklist/${itemId}`,
  );
}

// Run card with AI worker
export async function runCard(
  boardId: string,
  cardId: string,
): Promise<{ workerTask: { id: string; status: string } }> {
  const response = await apiClient.post(
    `/boards/${boardId}/cards/${cardId}/run`,
  );
  return response.data;
}

// Activity
export async function getActivity(boardId: string): Promise<Activity[]> {
  const response = await apiClient.get(`/boards/${boardId}/activity`);
  return response.data.activity ?? response.data;
}

// Board batch operations
export async function runAllCards(boardId: string) {
  const { data } = await apiClient.post(`/boards/${boardId}/run-all`);
  return data;
}

export async function cancelAllCards(boardId: string) {
  const { data } = await apiClient.post(`/boards/${boardId}/cancel-all`);
  return data;
}

// PRD Decomposition
export interface DecomposeResult {
  boardId: string;
  boardName: string;
  prefix: string;
  cardCount: number;
  cards: {
    id: string;
    cardNumber: number;
    title: string;
    dependencies: number[];
    estimatedSteps: number;
  }[];
  trackerSync?: {
    synced: number;
    failed: number;
    tracker: string;
    issueKeys: string[];
  } | null;
}

export async function decomposePrd(data: {
  source: "text" | "file" | "url" | "repo";
  content?: string;
  fileUrl?: string;
  repoPath?: string;
  githubRepo?: string;
  boardName?: string;
}): Promise<DecomposeResult> {
  const response = await apiClient.post("/prd/decompose", data);
  return response.data;
}

// Card dependencies
export async function addCardDependency(
  boardId: string,
  cardId: string,
  dependsOnCardId: string,
) {
  const { data } = await apiClient.post(
    `/boards/${boardId}/cards/${cardId}/dependencies`,
    { dependsOnCardId },
  );
  return data;
}

export async function removeCardDependency(
  boardId: string,
  cardId: string,
  depCardId: string,
) {
  const { data } = await apiClient.delete(
    `/boards/${boardId}/cards/${cardId}/dependencies/${depCardId}`,
  );
  return data;
}

// Org Members
export async function getOrgMembers(): Promise<OrgMember[]> {
  const response = await apiClient.get("/organizations/current/members");
  return response.data.members ?? response.data;
}
