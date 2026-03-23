export interface SessionMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
}
export interface Session {
    id: string;
    name?: string;
    messages: SessionMessage[];
    provider: string;
    model: string;
    startedAt: string;
    totalTokens: number;
}
export interface SessionSummary {
    id: string;
    name?: string;
    startedAt: string;
    messageCount: number;
    totalTokens: number;
    preview: string;
}
export declare function createSession(provider: string, model: string): Session;
export declare function saveSession(session: Session): void;
export declare function loadLatestSession(): Session | null;
export declare function addMessage(session: Session, role: "user" | "assistant", content: string): void;
export declare function listSessions(max?: number): SessionSummary[];
export declare function loadSessionById(id: string): Session | null;
export declare function deleteSession(id: string): boolean;
