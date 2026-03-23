export interface Persona {
    name: string;
    slug: string;
    description: string;
    tools: string[];
    provider?: string;
    model?: string;
    systemPrompt: string;
}
export declare function loadPersona(slug: string): Persona | null;
export declare function listAvailablePersonas(): string[];
