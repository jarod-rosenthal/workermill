import { type CliConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import { type Session } from "./session.js";
export interface CommandContext {
    config: CliConfig;
    session: Session;
    costTracker: CostTracker;
    workingDir: string;
    planMode: boolean;
    setPlanMode: (mode: boolean) => void;
    processInput: (input: string) => void;
}
export declare function handleCommand(cmd: string, ctx: CommandContext): Promise<void>;
