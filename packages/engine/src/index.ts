export { EngineAIClient } from "./ai-client.js";
export { createModel } from "./model-factory.js";
export { createToolDefinitions } from "./tools/index.js";
export * from "./types.js";
export * from "./decisions.js";

// Re-export individual tool modules for direct access
export {
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  lsTool,
  fetchTool,
  patchTool,
  subAgentTool,
} from "./tools/index.js";
