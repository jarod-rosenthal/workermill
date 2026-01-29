import { useState, useEffect } from "react";
import { Zap, Loader2 } from "lucide-react";

interface PhaseUsage {
  phase: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  records: number;
}

interface PersonaUsage {
  persona: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  records: number;
}

interface OperationUsage {
  operationType: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  records: number;
}

interface TokenBreakdownProps {
  taskId: string;
}

export function TokenBreakdown({ taskId }: TokenBreakdownProps) {
  const [phaseData, setPhaseData] = useState<PhaseUsage[] | null>(null);
  const [personaData, setPersonaData] = useState<PersonaUsage[] | null>(null);
  const [operationData, setOperationData] = useState<OperationUsage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTokenUsage();
  }, [taskId]);

  async function fetchTokenUsage() {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const headers = { Authorization: `Bearer ${token}` };

      const [phaseRes, personaRes, operationRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}/usage/breakdown`, { headers }),
        fetch(`/api/tasks/${taskId}/usage/by-persona`, { headers }),
        fetch(`/api/tasks/${taskId}/usage/by-operation-type`, { headers }),
      ]);

      if (phaseRes.ok) {
        const data = await phaseRes.json();
        setPhaseData(data.breakdown || []);
      }
      if (personaRes.ok) {
        const data = await personaRes.json();
        setPersonaData(data.breakdown || []);
      }
      if (operationRes.ok) {
        const data = await operationRes.json();
        setOperationData(data.breakdown || []);
      }
    } catch (err) {
      setError("Failed to load token usage");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading token usage...</span>
      </div>
    );
  }

  // Check if we have any data
  const hasPhaseData = phaseData && phaseData.length > 0;
  const hasPersonaData = personaData && personaData.length > 0;
  const hasOperationData = operationData && operationData.length > 0;

  if (!hasPhaseData && !hasPersonaData && !hasOperationData) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        No token usage data available for this task.
      </div>
    );
  }

  // Calculate totals
  const totalTokens = phaseData?.reduce((sum, p) =>
    sum + p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens, 0) || 0;
  const totalCost = phaseData?.reduce((sum, p) => sum + p.estimatedCostUsd, 0) || 0;

  // Phase colors
  const phaseColors: Record<string, string> = {
    planning: "bg-blue-500",
    execution: "bg-green-500",
    review: "bg-purple-500",
    deployment: "bg-cyan-500",
    improvement: "bg-orange-500",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Zap className="w-4 h-4 text-yellow-500" />
        Token Usage Breakdown
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-muted/50 rounded-lg p-2">
          <div className="text-muted-foreground text-xs">Total Tokens</div>
          <div className="font-semibold">{(totalTokens / 1000).toFixed(1)}K</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-2">
          <div className="text-muted-foreground text-xs">Token Cost</div>
          <div className="font-semibold">${totalCost.toFixed(4)}</div>
        </div>
      </div>

      {/* Phase Breakdown */}
      {hasPhaseData && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">By Phase</div>
          <div className="flex h-4 rounded-full overflow-hidden bg-muted">
            {phaseData.map((phase) => {
              const tokens = phase.inputTokens + phase.outputTokens;
              const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
              if (pct < 1) return null;
              return (
                <div
                  key={phase.phase}
                  className={`${phaseColors[phase.phase] || "bg-gray-400"}`}
                  style={{ width: `${pct}%` }}
                  title={`${phase.phase}: ${(tokens / 1000).toFixed(1)}K tokens ($${phase.estimatedCostUsd.toFixed(4)})`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {phaseData.map((phase) => (
              <span key={phase.phase} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${phaseColors[phase.phase] || "bg-gray-400"}`} />
                <span className="capitalize">{phase.phase}</span>
                <span className="text-muted-foreground/60">${phase.estimatedCostUsd.toFixed(4)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Persona Breakdown */}
      {hasPersonaData && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">By Persona</div>
          <div className="space-y-1">
            {personaData.slice(0, 4).map((p) => {
              const maxCost = Math.max(...personaData.map((x) => x.estimatedCostUsd));
              return (
                <div key={p.persona} className="flex items-center gap-2 text-xs">
                  <div className="w-20 truncate text-muted-foreground">
                    {p.persona.replace(/_/g, " ")}
                  </div>
                  <div className="flex-1 bg-muted rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full"
                      style={{ width: `${(p.estimatedCostUsd / maxCost) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right">${p.estimatedCostUsd.toFixed(4)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Operation Type Breakdown */}
      {hasOperationData && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">By Operation</div>
          <div className="flex flex-wrap gap-1.5">
            {operationData.slice(0, 6).map((op) => (
              <span
                key={op.operationType}
                className="px-2 py-1 bg-muted rounded text-xs"
                title={`${(op.inputTokens + op.outputTokens) / 1000}K tokens`}
              >
                {op.operationType.replace(/_/g, " ")}: ${op.estimatedCostUsd.toFixed(4)}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500">{error}</div>
      )}
    </div>
  );
}
