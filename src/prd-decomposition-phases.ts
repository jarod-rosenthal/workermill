export type PrdDecompositionPhase =
  | "resolving_content"
  | "validating_spec"
  | "calling_llm"
  | "streaming"
  | "repairing_spec"
  | "scoring_plan"
  | "refining_plan"
  | "parsing"
  | "creating_board";

const PHASE_LABELS: Record<PrdDecompositionPhase, string> = {
  resolving_content: "Resolving content...",
  validating_spec: "Checking for dependency issues...",
  calling_llm: "Calling LLM...",
  streaming: "Streaming response...",
  repairing_spec: "Repairing spec...",
  scoring_plan: "Scoring the plan...",
  refining_plan: "Refining the plan...",
  parsing: "Parsing JSON...",
  creating_board: "Creating board...",
};

export function getPrdDecompositionPhaseLabel(
  phase?: PrdDecompositionPhase,
): string {
  if (!phase) return "Decomposing spec into cards...";
  return PHASE_LABELS[phase];
}
