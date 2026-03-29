import { useState, useEffect } from "react";
import {
  Briefcase,
  Code,
  Lock,
  Users,
  Loader2,
  AlertCircle,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface PublicPersona {
  slug: string;
  name: string;
  emoji: string | null;
  color: string | null;
  shortLabel: string | null;
  description: string | null;
  skills: string[] | null;
  riskLevel: string;
}

// Tech Lead Reviewer responsibilities (workflow-specific, not persona metadata)
const REVIEWER_RESPONSIBILITIES = [
  "Review code changes for quality and correctness",
  "Ensure changes match ticket requirements",
  "Check for security issues and best practices",
  "Approve, reject, or request revisions",
  "Provide actionable feedback to workers",
];

export default function Personas() {
  const [personas, setPersonas] = useState<PublicPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPersonas() {
      try {
        const response = await fetch(`${API_BASE}/api/personas/public`);
        if (!response.ok) throw new Error("Failed to fetch personas");
        const data = await response.json();
        setPersonas(data.personas);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load personas");
      } finally {
        setLoading(false);
      }
    }
    fetchPersonas();
  }, []);

  // Separate the manager (Tech Lead Reviewer) from worker personas
  const managerPersona = personas.find((p) => p.slug === "manager");
  const workerPersonas = personas.filter(
    (p) => p.slug !== "manager" && p.slug !== "__common__"
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Worker Personas</h1>
        <p className="text-muted-foreground">
          WorkerMill uses specialized AI personas to handle different types of development tasks.
          Each persona has domain expertise and is optimized for specific work.
        </p>
      </div>

      {/* Tech Lead Reviewer */}
      {managerPersona && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-indigo-500" />
            Tech Lead Reviewer
          </h2>
          <div
            className="bg-card border rounded-xl p-6"
            style={{ borderColor: `${managerPersona.color || "#6366F1"}40` }}
          >
            <div className="flex items-start gap-4">
              <div
                className="p-3 rounded-lg"
                style={{ backgroundColor: `${managerPersona.color || "#6366F1"}18` }}
              >
                <span className="text-3xl">{managerPersona.emoji || "👔"}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-foreground">Tech Lead Reviewer</h3>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${managerPersona.color || "#6366F1"}18`,
                      color: managerPersona.color || "#6366F1",
                    }}
                  >
                    Always Active
                  </span>
                </div>
                <p className="text-muted-foreground mb-4">
                  {managerPersona.description || "Reviews all PRs created by workers, provides feedback, and approves or requests revisions."}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Skills</h4>
                    <div className="flex flex-wrap gap-2">
                      {(managerPersona.skills || []).map((skill) => (
                        <span
                          key={skill}
                          className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Responsibilities</h4>
                    <ul className="space-y-1">
                      {REVIEWER_RESPONSIBILITIES.map((resp, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                          <div
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: managerPersona.color || "#6366F1" }}
                          />
                          {resp}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Worker Personas */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Worker Personas ({workerPersonas.length} Types)
        </h2>
        <div className="grid gap-4">
          {workerPersonas.map((persona) => (
            <div
              key={persona.slug}
              className="bg-card border rounded-xl p-5"
              style={{ borderColor: `${persona.color || "#3B82F6"}40` }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `${persona.color || "#3B82F6"}18` }}
                >
                  <span className="text-2xl">{persona.emoji || "🤖"}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-foreground">{persona.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {persona.slug}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${persona.color || "#3B82F6"}18`,
                        color: persona.color || "#3B82F6",
                      }}
                    >
                      {persona.riskLevel} risk
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {persona.description || "AI worker persona"}
                  </p>

                  {persona.skills && persona.skills.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                        Skills
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {persona.skills.map((skill) => (
                          <span
                            key={skill}
                            className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Persona Selection */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">How Personas Are Selected</h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Persona selection can happen automatically or manually:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Automatic Assignment</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Based on issue tracker labels</li>
                <li>- Inferred from issue summary/description</li>
                <li>- Default persona if uncertain</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Manual Assignment</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Selected when creating task</li>
                <li>- Override via dashboard</li>
                <li>- API parameter on task creation</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Model Selection */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">AI Models & Providers</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Workers can use different AI models from multiple providers. Configure per-persona provider routing
            in Settings to optimize for cost, capability, or specific model strengths.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-foreground">Balanced Models</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Flash Lite — optimal balance of speed and capability for most development tasks.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-accent" />
                <h4 className="font-medium text-foreground">Flagship Models</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Claude Opus 4.6, GPT-5.4-pro, Gemini 3.1 Pro - most capable models for complex reasoning, security, and architecture tasks.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-green-500" />
                <h4 className="font-medium text-foreground">Efficient Models</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Claude Haiku 4.5, GPT-5.4-mini, Gemini 3.1 Flash Lite — optimized for speed on simpler tasks.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-purple-500" />
                <h4 className="font-medium text-foreground">Self-Hosted (Ollama)</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Run models on your infrastructure for sensitive code. Supports Llama, Qwen, DeepSeek, and more.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
