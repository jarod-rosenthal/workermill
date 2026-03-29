import { useState, useEffect } from "react";
import {
  Users,
  Settings,
  Sliders,
  Tag,
  FileText,
  Play,
  Plus,
  ToggleRight,
  AlertCircle,
  Trash2,
  Save,
  Loader2,
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

export default function PersonaStudio() {
  const [personas, setPersonas] = useState<PublicPersona[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);

  useEffect(() => {
    async function fetchPersonas() {
      try {
        const response = await fetch(`${API_BASE}/api/personas/public`);
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        setPersonas(data.personas);
      } catch {
        // Silently fail — static content still renders
      } finally {
        setPersonasLoading(false);
      }
    }
    fetchPersonas();
  }, []);

  return (
    <div className="prose prose-invert max-w-none">
      <h1 className="flex items-center gap-3">
        <Users className="w-8 h-8 text-primary" />
        Persona Studio
      </h1>

      <p className="lead text-muted-foreground">
        Create and configure AI worker personas that specialize in different types of development work.
        Control which personas are available and how issues are automatically assigned to the right expert.
      </p>

      {/* Overview */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Overview
        </h2>
        <p>
          WorkerMill includes {personas.length || "multiple"} specialized AI personas out of the box, and you can create your own. Each persona has expertise in a specific development
          domain. The Persona Studio lets you:
        </p>
        <ul>
          <li>View and manage all available personas</li>
          <li>Enable/disable personas based on your team's needs</li>
          <li>Create custom personas for specialized tasks</li>
          <li>Configure inference rules for automatic persona assignment</li>
          <li>Test how tickets will be routed to personas</li>
        </ul>
      </section>

      {/* Personas Tab */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Managing Personas
        </h2>
        <p>
          The Personas tab displays all available personas in a searchable grid. Each persona card shows:
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">Persona Properties</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">name</span>
              <span className="text-muted-foreground">Display name (e.g., "Backend Developer")</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">slug</span>
              <span className="text-muted-foreground">Unique identifier (e.g., "backend_developer")</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">emoji</span>
              <span className="text-muted-foreground">Visual identifier shown in the UI</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">description</span>
              <span className="text-muted-foreground">What this persona specializes in</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">riskLevel</span>
              <span className="text-muted-foreground">Low, Medium, or High risk classification</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">enabled</span>
              <span className="text-muted-foreground">Whether the persona is available for assignment</span>
            </div>
          </div>
        </div>

        <h3 className="flex items-center gap-2 mt-6">
          <ToggleRight className="w-4 h-4 text-green-500" />
          Enable/Disable Personas
        </h3>
        <p>
          Toggle the switch on each persona card to enable or disable it. Disabled personas won't be
          assigned to tickets. System personas (marked with a "system" badge) cannot be disabled.
        </p>

        <h3 className="flex items-center gap-2 mt-6">
          <Plus className="w-4 h-4 text-primary" />
          Creating Custom Personas
        </h3>
        <p>
          Click the "New Persona" button to create a custom persona. Required fields:
        </p>
        <ul>
          <li><strong>Slug</strong> - Unique identifier (lowercase, underscores only)</li>
          <li><strong>Name</strong> - Display name</li>
        </ul>
        <p>Optional fields:</p>
        <ul>
          <li><strong>Emoji</strong> - Visual identifier</li>
          <li><strong>Color</strong> - Hex color for UI highlighting</li>
          <li><strong>Short Label</strong> - Compact label for tight spaces</li>
          <li><strong>Description</strong> - What this persona does</li>
        </ul>

        <div className="not-prose bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-foreground font-medium">Custom Persona Limitations</p>
              <p className="text-sm text-muted-foreground mt-1">
                Custom personas use the same underlying AI capabilities but with custom inference rules.
                For truly specialized behavior, you'll also need to configure inference rules to route
                appropriate tickets to your custom persona.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Inference Rules Tab */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-primary" />
          Inference Rules
        </h2>
        <p>
          Inference rules control how WorkerMill automatically assigns the right persona to incoming
          tickets. The system evaluates rules in priority order:
        </p>

        <ol className="space-y-2">
          <li><strong>1. Label Mappings</strong> - Exact label match (highest priority)</li>
          <li><strong>2. Keyword Patterns</strong> - Content-based matching</li>
          <li><strong>3. Default Persona</strong> - Fallback when no rules match</li>
        </ol>

        <h3 className="flex items-center gap-2 mt-6">
          <Tag className="w-4 h-4 text-primary" />
          Label Mappings
        </h3>
        <p>
          Map issue tracker labels (GitHub, GitLab, Jira, Linear) directly to personas. When an issue has a matching label,
          that persona is automatically assigned.
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-4 mt-4 font-mono text-sm">
          <div className="text-muted-foreground mb-2"># Example label mappings</div>
          <div className="space-y-1">
            <div>backend → backend_developer</div>
            <div>frontend → frontend_developer</div>
            <div>infra → devops_engineer</div>
            <div>security → security_engineer</div>
            <div>docs → tech_writer</div>
          </div>
        </div>

        <h3 className="flex items-center gap-2 mt-6">
          <FileText className="w-4 h-4 text-primary" />
          Keyword Patterns
        </h3>
        <p>
          Define regex patterns to match against ticket summary and description. Patterns use
          pipe (|) for OR matching. Custom org-specific patterns receive 2x weight in scoring.
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-4 mt-4 font-mono text-sm">
          <div className="text-muted-foreground mb-2"># Example keyword patterns</div>
          <div className="space-y-1">
            <div>backend_developer: api|database|sql|migration</div>
            <div>frontend_developer: react|css|component|ui</div>
            <div>devops_engineer: terraform|docker|kubernetes|ci/cd</div>
            <div>security_engineer: vulnerability|auth|encryption</div>
          </div>
        </div>

        <h3 className="flex items-center gap-2 mt-6">
          <Settings className="w-4 h-4 text-primary" />
          Default Persona
        </h3>
        <p>
          When no labels or keywords match, tickets are assigned to the default persona.
          The system default is <code>backend_developer</code>, but you can change this to
          any persona slug.
        </p>

        <div className="not-prose mt-4 flex gap-4">
          <div className="flex-1 bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Save className="w-4 h-4 text-primary" />
              <span className="font-medium text-foreground">Save Rules</span>
            </div>
            <p className="text-sm text-muted-foreground">
              After editing any rules, click "Save Rules" to persist your changes.
            </p>
          </div>
          <div className="flex-1 bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              <span className="font-medium text-foreground">Reset to Defaults</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Remove all custom rules and restore system default inference behavior.
            </p>
          </div>
        </div>
      </section>

      {/* Test Inference */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Play className="w-5 h-5 text-primary" />
          Test Inference
        </h2>
        <p>
          The Test Inference feature lets you verify how tickets will be routed before they're created.
          Enter sample ticket content to see which persona would be assigned:
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Summary</label>
              <div className="bg-muted/50 border border-border rounded px-3 py-2 text-sm text-muted-foreground">
                Add Stripe payment integration
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Description</label>
              <div className="bg-muted/50 border border-border rounded px-3 py-2 text-sm text-muted-foreground">
                Implement payment processing using Stripe API...
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Labels</label>
              <div className="bg-muted/50 border border-border rounded px-3 py-2 text-sm text-muted-foreground">
                backend, payments
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm">
                <Play className="w-4 h-4" />
                Test
              </div>
              <span className="text-sm text-muted-foreground">Result:</span>
              <span className="px-3 py-1 rounded-full text-sm font-mono bg-primary/20 text-primary">
                backend_developer
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* System Personas */}
      <section className="mt-8">
        <h2>System Personas</h2>
        <p>
          WorkerMill includes {personas.length || "multiple"} built-in personas covering common development roles:
        </p>

        <div className="not-prose grid grid-cols-2 gap-3 mt-4">
          {personasLoading ? (
            <div className="col-span-2 flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            personas.map((persona) => (
              <div
                key={persona.slug}
                className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg"
              >
                <span className="text-xl">{persona.emoji || "🤖"}</span>
                <div>
                  <div className="font-medium text-foreground text-sm">{persona.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{persona.slug}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Best Practices */}
      <section className="mt-8">
        <h2>Best Practices</h2>

        <div className="not-prose grid gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Use Label Mappings for Certainty</h3>
            <p className="text-sm text-muted-foreground">
              When you know exactly which persona should handle certain work, use label mappings.
              They're evaluated first and provide deterministic routing.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Keep Keyword Patterns Specific</h3>
            <p className="text-sm text-muted-foreground">
              Avoid overly broad patterns that could match unintended tickets. Use multiple
              specific terms separated by | rather than single generic words.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Test Before Deploying</h3>
            <p className="text-sm text-muted-foreground">
              Use the Test Inference feature with sample tickets before saving new rules.
              This helps catch unintended routing before it affects real work.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Disable Unused Personas</h3>
            <p className="text-sm text-muted-foreground">
              If your team doesn't do certain types of work (e.g., mobile development),
              disable those personas to simplify the inference process.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
