import type { CliConfig } from "./config.js";
export declare function runAgent(config: CliConfig, trustAll: boolean, resume?: boolean, startInPlanMode?: boolean, fullDisk?: boolean): Promise<void>;
