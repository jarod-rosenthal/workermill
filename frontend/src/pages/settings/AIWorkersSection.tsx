import { Link } from "react-router-dom";
import {
  BarChart3,
  Brain,
  ChevronRight,
  Code,
  Cpu,
  Database,
  Loader2,
  Lock,
  Plus,
  Router,
  Sliders,
  Users,
  Zap,
} from "lucide-react";
import { CollapsibleSection } from "../../components/ui/CollapsibleSection";
import { CodebaseIndexStatus } from "../../components/CodebaseIndexStatus";
import type { Settings, ValidationErrors, ModelOption } from "./types";
import { PROVIDER_OPTIONS, MODEL_OPTIONS, PERSONA_OPTIONS, API_BASE } from "./types";

interface AIWorkersSectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  settingsLoading: boolean;
  validationErrors: ValidationErrors;
  currentModels: ModelOption[];
  getWorkersSummary: () => string;
  getManagerSummary: () => string;
  getExecutionSummary: () => string;
  getRoutingSummary: () => string;
  orgPlan?: string;
}

function LockedOverlay() {
  return (
    <div
      className="absolute inset-0 bg-card/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center z-10 group"
    >
      <div className="flex flex-col items-center gap-1.5">
        <Lock className="w-5 h-5 text-muted-foreground/60" />
        <span className="text-xs text-muted-foreground/80 font-medium">
          Coming soon
        </span>
      </div>
    </div>
  );
}

export function AIWorkersSection({
  settings,
  updateSetting,
  settingsLoading,
  validationErrors,
  currentModels,
  getWorkersSummary,
  getManagerSummary,
  getExecutionSummary,
  getRoutingSummary,
  orgPlan: _orgPlan,
}: AIWorkersSectionProps) {
  const isProPlan = false; // Plan-gating removed — all features available
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">AI Workers</h2>
        <p className="text-sm text-muted-foreground">Configure AI worker behavior and defaults</p>
      </div>

      {/* Persona Studio Link */}
      <Link
        to="/personas"
        className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-xl hover:border-primary/40 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sliders className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">Persona Studio</h3>
            <p className="text-sm text-muted-foreground">Manage personas and inference rules</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
      </Link>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading settings...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* AI Worker Guidelines */}
          <div className="card p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">AI Worker Guidelines</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Help workers understand your organization's priorities. These guidelines flow into every
                worker's context and the planning agent.{" "}
                <span className="text-muted-foreground/70">
                  For repo-specific guidelines, add an <code className="text-xs bg-muted px-1 rounded">AGENT.md</code> to the repo root.
                </span>
              </p>
            </div>
            <textarea
              className="w-full min-h-[160px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={`What should AI workers always or never do in this codebase?\nWhat does your org prioritize in ambiguous situations?\n\nExample: "Never modify files outside the specified scope. Prefer backward-compatible changes. Mobile is the primary surface — web is secondary."`}
              value={settings.aiGuidelines ?? ""}
              onChange={(e) => updateSetting("aiGuidelines", e.target.value || null)}
            />
          </div>

          {/* Expert Workers */}
          <CollapsibleSection
            title="Expert Workers"
            icon={<Cpu className="w-4 h-4" />}
            iconBgColor="bg-cyan-500/20"
            iconColor="text-cyan-500"
            summary={getWorkersSummary()}
            defaultOpen={false}
          >
            <div className="space-y-6">
              <>
                  {/* Full provider picker */}
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-3">
                      Primary Provider
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {PROVIDER_OPTIONS.map((provider) => (
                        <button
                          key={provider.value}
                          onClick={() => {
                            updateSetting("primaryProvider", provider.value);
                            const newProviderModels = MODEL_OPTIONS[provider.value];
                            if (newProviderModels && !newProviderModels.find((m) => m.value === settings.defaultWorkerModel)) {
                              updateSetting("defaultWorkerModel", newProviderModels[0].value);
                            }
                          }}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            settings.primaryProvider === provider.value
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background/50 hover:border-primary/50"
                          }`}
                        >
                          <div className="text-2xl mb-1">{provider.icon}</div>
                          <div className="text-xs font-medium">{provider.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">Default Model</label>
                      <select
                        value={settings.defaultWorkerModel}
                        onChange={(e) => updateSetting("defaultWorkerModel", e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                      >
                        {currentModels.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label} ({option.tier})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">Default Persona</label>
                      <select
                        value={settings.defaultWorkerPersona}
                        onChange={(e) => updateSetting("defaultWorkerPersona", e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                      >
                        {PERSONA_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
              </>
            </div>
          </CollapsibleSection>

          {/* Tech Lead */}
          <CollapsibleSection
            title="Tech Lead"
            icon={<Users className="w-4 h-4" />}
            iconBgColor="bg-indigo-500/20"
            iconColor="text-indigo-500"
            summary={getManagerSummary()}
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PROVIDER_OPTIONS.map((provider) => (
                        <button
                          key={provider.value}
                          onClick={() => {
                            updateSetting("managerProvider", provider.value);
                            const newProviderModels = MODEL_OPTIONS[provider.value];
                            if (newProviderModels && !newProviderModels.find((m) => m.value === settings.managerModelId)) {
                              updateSetting("managerModelId", newProviderModels[0].value);
                            }
                          }}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            settings.managerProvider === provider.value
                              ? "border-indigo-500 bg-indigo-500/10"
                              : "border-border hover:border-indigo-500/50"
                          }`}
                        >
                          <div className="text-lg">{provider.icon}</div>
                          <div className="text-xs font-medium mt-1">{provider.label.split(" ")[0]}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Model</label>
                    <select
                      value={settings.managerModelId}
                      onChange={(e) => updateSetting("managerModelId", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-indigo-500/50 focus:outline-none transition-all"
                    >
                      {(MODEL_OPTIONS[settings.managerProvider] || MODEL_OPTIONS.anthropic).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({option.tier})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              {/* Max Review Revisions (Circuit Breaker) */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Max Review Revisions
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={settings.maxReviewRevisions}
                    onChange={(e) => updateSetting("maxReviewRevisions", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-background/50 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <span className="text-lg font-semibold text-foreground w-8 text-center">
                    {settings.maxReviewRevisions}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {/* 0 = tech lead review disabled */}
                  Circuit breaker for consolidated PR review. Set to 0 to disable tech lead review. Otherwise, the task will be escalated after this many revision rounds.
                </p>
              </div>
              {/* Max Per-Story Revisions */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Max Per-Story Revisions
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={settings.maxPerStoryRevisions}
                    onChange={(e) => updateSetting("maxPerStoryRevisions", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-background/50 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <span className="text-lg font-semibold text-foreground w-8 text-center">
                    {settings.maxPerStoryRevisions}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Maximum revision attempts per individual story before auto-approving. Set to 0 to skip per-story review entirely. The consolidated PR review at the end catches remaining issues.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/20">
                <h4 className="text-sm font-medium text-indigo-400 mb-2">Tech Lead</h4>
                <p className="text-xs text-muted-foreground">
                  The Tech Lead reviews all PRs created by AI workers before they are merged.
                  These provider and model settings control which AI performs code reviews.
                  Use the <strong>review</strong> label on Jira tickets to require Tech Lead review.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Planning Agent (Project Manager) */}
          <CollapsibleSection
            title="Planning Agent"
            icon={<BarChart3 className="w-4 h-4" />}
            iconBgColor="bg-purple-500/20"
            iconColor="text-purple-500"
            summary={`${PROVIDER_OPTIONS.find((p) => p.value === settings.planningAgentProvider)?.label.split(" ")[0] || "Anthropic"} ${MODEL_OPTIONS[settings.planningAgentProvider]?.find((m) => m.value === settings.planningAgentModel)?.label || settings.planningAgentModel}`}
          >
            <div className="space-y-6">
              {/* Full Build (PRD) Planning Mode Toggle */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">Full Build Planning Mode</label>
                <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateSetting("prdPlanningMode", "strict")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        settings.prdPlanningMode === "strict"
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-border bg-background/50 hover:border-purple-500/50"
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">Strict</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Full planner-critic loop — plan must meet approval threshold to proceed (up to 3 attempts)
                      </p>
                    </button>
                    <button
                      onClick={() => updateSetting("prdPlanningMode", "simplified")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        settings.prdPlanningMode === "simplified" || settings.prdPlanningMode === "decomposer_planned"
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-border bg-background/50 hover:border-purple-500/50"
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">Simplified</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Single planning pass — critic feedback is incorporated but never blocks
                      </p>
                    </button>
                  </div>
              </div>

              {/* Critic Approval Threshold */}
              {(settings.prdPlanningMode === "strict" || settings.planningMode === "strict") && (
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Critic Approval Threshold</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={50}
                      max={100}
                      value={settings.criticApprovalThreshold ?? 85}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 50 && val <= 100) {
                          updateSetting("criticApprovalThreshold", val);
                        }
                      }}
                      className="w-20 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none transition-all text-sm"
                    />
                    <span className="text-xs text-muted-foreground">Minimum critic score (50-100) for plan approval in strict mode</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PROVIDER_OPTIONS.map((provider) => (
                        <button
                          key={provider.value}
                          onClick={() => {
                            updateSetting("planningAgentProvider", provider.value);
                            const newProviderModels = MODEL_OPTIONS[provider.value];
                            if (newProviderModels && !newProviderModels.find((m) => m.value === settings.planningAgentModel)) {
                              updateSetting("planningAgentModel", newProviderModels[0].value);
                            }
                          }}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            settings.planningAgentProvider === provider.value
                              ? "border-purple-500 bg-purple-500/10"
                              : "border-border hover:border-purple-500/50"
                          }`}
                        >
                          <div className="text-lg">{provider.icon}</div>
                          <div className="text-xs font-medium mt-1">{provider.label.split(" ")[0]}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Model</label>
                    <select
                      value={settings.planningAgentModel}
                      onChange={(e) => updateSetting("planningAgentModel", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none transition-all"
                    >
                      {(MODEL_OPTIONS[settings.planningAgentProvider] || MODEL_OPTIONS.anthropic).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({option.tier})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Max Files Per Story
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min="3"
                    max="50"
                    step="1"
                    value={settings.maxTargetFiles}
                    onChange={(e) => updateSetting("maxTargetFiles", parseInt(e.target.value, 10) || 15)}
                    className="w-20 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none text-sm text-center"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Maximum files each story can target. Higher values allow larger stories but increase merge conflict risk.
                </p>
              </div>
              <div className="opacity-60">
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Story Calibration Multiplier
                  <span className="ml-2 text-xs text-yellow-500 font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/20">Experimental</span>
                  <span className="ml-2 text-xs text-purple-400">({Math.round(settings.storyCalibrationMultiplier * 100)}%)</span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0.1"
                    max="2.0"
                    step="0.05"
                    value={settings.storyCalibrationMultiplier}
                    onChange={(e) => updateSetting("storyCalibrationMultiplier", parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-background/50 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <input
                    type="number"
                    min="0.1"
                    max="2.0"
                    step="0.05"
                    value={settings.storyCalibrationMultiplier}
                    onChange={(e) => updateSetting("storyCalibrationMultiplier", parseFloat(e.target.value) || 0.4)}
                    className="w-20 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none text-sm text-center"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Adjusts final story count. Lower = fewer stories (0.3 = 30%), higher = more stories (1.5 = 150%).
                  <br />
                  <span className="text-purple-400">Example: If system calculates 20 stories at 0.4x = 8 stories</span>
                </p>
              </div>
              <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <h4 className="text-sm font-medium text-purple-400 mb-2">Planning Agent Role</h4>
                <p className="text-xs text-muted-foreground">
                  The Planning Agent (Project Manager) analyzes tickets, extracts inventory, and decomposes work into stories.
                  The calibration multiplier acts as a "temperature dial" - if stories are consistently over-estimated, reduce it.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Execution Settings */}
          <CollapsibleSection
            title="Execution Settings"
            icon={<Sliders className="w-4 h-4" />}
            iconBgColor="bg-accent/20"
            iconColor="text-accent"
            summary={getExecutionSummary()}
          >
            <div className="space-y-6">
              {/* Max Concurrent Containers */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Max Concurrent Containers</label>
                <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="14"
                      value={settings.maxConcurrentWorkers}
                      onChange={(e) => updateSetting("maxConcurrentWorkers", parseInt(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                    <div className="w-20">
                      <input
                        type="number"
                        min="1"
                        max="14"
                        value={settings.maxConcurrentWorkers}
                        onChange={(e) => updateSetting("maxConcurrentWorkers", parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                      />
                    </div>
                  </div>
                {validationErrors.maxConcurrentWorkers && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.maxConcurrentWorkers}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Maximum worker containers running simultaneously (1-14)</p>
              </div>

              {/* Max Parallel Experts */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Max Parallel Experts</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="14"
                    value={settings.maxParallelExperts}
                    onChange={(e) => updateSetting("maxParallelExperts", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="1"
                      max="14"
                      value={settings.maxParallelExperts}
                      onChange={(e) => updateSetting("maxParallelExperts", parseInt(e.target.value) || 10)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                {validationErrors.maxParallelExperts && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.maxParallelExperts}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum expert subagents running in parallel per task (1-14)
                </p>
              </div>

              {/* Max Stories per Epic */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Max Stories per Epic</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={settings.ralphMaxStories}
                    onChange={(e) => updateSetting("ralphMaxStories", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={settings.ralphMaxStories}
                      onChange={(e) => updateSetting("ralphMaxStories", parseInt(e.target.value) || 10)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                {validationErrors.ralphMaxStories && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.ralphMaxStories}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum number of stories to decompose an epic into (1-50)
                </p>
              </div>

              {/* Max Retries */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Default Max Retries</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    value={settings.defaultMaxRetries}
                    onChange={(e) => updateSetting("defaultMaxRetries", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={settings.defaultMaxRetries}
                      onChange={(e) => updateSetting("defaultMaxRetries", parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                {validationErrors.defaultMaxRetries && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.defaultMaxRetries}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Automatic retries for failed tasks (0-5)</p>
              </div>

              {/* PRD Auto-Run */}
              <div className="flex items-center justify-between p-4 bg-accent/5 border border-accent/20 rounded-xl">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Auto-run Full Build Cards</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Automatically execute cards when dependencies are met (Full Build boards only)
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.prdAutoRun}
                    onChange={(e) => updateSetting("prdAutoRun", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>
            </div>
          </CollapsibleSection>

          {/* Warm Container Pool */}
          <div className="relative">
            {isProPlan && <LockedOverlay />}
            <CollapsibleSection
              title="Warm Container Pool"
              icon={<Zap className="w-4 h-4" />}
              iconBgColor="bg-amber-500/20"
              iconColor="text-amber-500"
              summary={settings.warmPoolSize > 0 ? `${settings.warmPoolSize} container${settings.warmPoolSize > 1 ? 's' : ''}, ${settings.warmPoolHoursStart}:00-${settings.warmPoolHoursEnd}:00` : "Disabled"}
            >
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <h4 className="text-sm font-medium text-amber-400 mb-2">Eliminate Cold-Start Latency</h4>
                <p className="text-xs text-muted-foreground">
                  Pre-warm containers that wait for task assignments, reducing startup time from ~60-90 seconds
                  to ~2-5 seconds. Containers are only kept warm during configured working hours.
                </p>
              </div>

              {/* Pool Size */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Pool Size</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    value={settings.warmPoolSize}
                    onChange={(e) => updateSetting("warmPoolSize", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={settings.warmPoolSize}
                      onChange={(e) => updateSetting("warmPoolSize", Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-amber-500/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {settings.warmPoolSize === 0 ? "Warm pool disabled" : `${settings.warmPoolSize} container${settings.warmPoolSize > 1 ? 's' : ''} will be kept warm (~$${(settings.warmPoolSize * 4).toFixed(0)}/month with Spot)`}
                </p>
              </div>

              {/* Working Hours */}
              {settings.warmPoolSize > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">Start Hour</label>
                      <select
                        value={settings.warmPoolHoursStart}
                        onChange={(e) => updateSetting("warmPoolHoursStart", parseInt(e.target.value))}
                        className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-amber-500/50 focus:outline-none transition-all"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>
                            {i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">End Hour</label>
                      <select
                        value={settings.warmPoolHoursEnd}
                        onChange={(e) => updateSetting("warmPoolHoursEnd", parseInt(e.target.value))}
                        className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-amber-500/50 focus:outline-none transition-all"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>
                            {i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Timezone</label>
                    <select
                      value={settings.warmPoolTimezone}
                      onChange={(e) => updateSetting("warmPoolTimezone", e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-amber-500/50 focus:outline-none transition-all"
                    >
                      <option value="America/New_York">Eastern Time (America/New_York)</option>
                      <option value="America/Chicago">Central Time (America/Chicago)</option>
                      <option value="America/Denver">Mountain Time (America/Denver)</option>
                      <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
                      <option value="UTC">UTC</option>
                      <option value="Europe/London">London (Europe/London)</option>
                      <option value="Europe/Paris">Paris (Europe/Paris)</option>
                      <option value="Europe/Berlin">Berlin (Europe/Berlin)</option>
                      <option value="Asia/Tokyo">Tokyo (Asia/Tokyo)</option>
                      <option value="Asia/Shanghai">Shanghai (Asia/Shanghai)</option>
                      <option value="Asia/Singapore">Singapore (Asia/Singapore)</option>
                      <option value="Australia/Sydney">Sydney (Australia/Sydney)</option>
                    </select>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Warm containers will only run between {settings.warmPoolHoursStart}:00 and {settings.warmPoolHoursEnd}:00 in {settings.warmPoolTimezone.replace("_", " ")}.
                    Outside these hours, containers will be terminated to save costs.
                  </p>
                </>
              )}
            </div>
          </CollapsibleSection>
          </div>

          {/* Provider Routing */}
          <div className="relative">
            {isProPlan && <LockedOverlay />}
            <CollapsibleSection
              title="Provider Routing"
              icon={<Router className="w-4 h-4" />}
              iconBgColor="bg-orange-500/20"
              iconColor="text-orange-500"
              summary={getRoutingSummary()}
              badge="Advanced"
              badgeColor="bg-orange-500/20 text-orange-500"
            >
            <div className="space-y-6">
              {/* Mode Explanation */}
              <div className={`p-4 rounded-lg border ${
                settings.primaryProvider === "anthropic" && Object.keys(settings.providerRouting).length === 0
                  ? "bg-blue-500/5 border-blue-500/20"
                  : "bg-orange-500/5 border-orange-500/20"
              }`}>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium mb-1">
                      {settings.primaryProvider === "anthropic" && Object.keys(settings.providerRouting).length === 0
                        ? "Epic Mode (Parallel Execution)"
                        : "Multi-Provider Mode (Sequential Execution)"}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {settings.primaryProvider === "anthropic" && Object.keys(settings.providerRouting).length === 0
                        ? "Using Anthropic with no routing overrides enables Epic Mode: multiple experts work in parallel on different stories using Claude's native tools."
                        : "Using a non-Anthropic provider or routing overrides enables Multi-Provider Mode: stories execute sequentially, each persona can use a different provider."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Persona Routing Rules */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">Persona Routing Rules</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Override the default provider for specific personas. Leave empty to use the default provider above.
                </p>
                <div className="space-y-3">
                  {PERSONA_OPTIONS.filter((p) => p.value !== "auto").map((persona) => {
                    const routing = settings.providerRouting[persona.value];
                    const hasRouting = routing && routing.provider;
                    const routingProvider = hasRouting ? routing.provider : "";
                    const routingModel = routing?.model || "";
                    const providerModels = routingProvider ? MODEL_OPTIONS[routingProvider] || [] : [];

                    return (
                      <div
                        key={persona.value}
                        className={`p-3 rounded-lg border transition-all ${
                          hasRouting ? "bg-orange-500/5 border-orange-500/30" : "bg-background/50 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-medium text-foreground min-w-[140px]">{persona.label}</span>
                          <div className="flex items-center gap-2 flex-1">
                            <select
                              value={routingProvider}
                              onChange={(e) => {
                                const newProvider = e.target.value;
                                const newRouting = { ...settings.providerRouting };
                                if (newProvider) {
                                  const defaultModel = MODEL_OPTIONS[newProvider]?.[0]?.value || "";
                                  newRouting[persona.value] = { provider: newProvider, model: defaultModel };
                                } else {
                                  delete newRouting[persona.value];
                                }
                                updateSetting("providerRouting", newRouting);
                              }}
                              className="flex-1 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                            >
                              <option value="">Use default provider</option>
                              {PROVIDER_OPTIONS.map((p) => (
                                <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
                              ))}
                            </select>
                            {hasRouting && providerModels.length > 0 && (
                              <select
                                value={routingModel}
                                onChange={(e) => {
                                  const newRouting = { ...settings.providerRouting };
                                  newRouting[persona.value] = { ...newRouting[persona.value], model: e.target.value };
                                  updateSetting("providerRouting", newRouting);
                                }}
                                className="flex-1 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                              >
                                {providerModels.map((m) => (
                                  <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Quick Setup Suggestion */}
              {!Object.keys(settings.providerRouting).length && settings.ollamaBaseUrl && (
                <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
                  <div className="flex items-start gap-3">
                    <Plus className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-green-400 mb-1">Quick Setup Suggestion</h4>
                      <p className="text-xs text-muted-foreground mb-2">
                        Route QA Engineer tasks to your local Ollama to save on API costs (enables Multi-Provider Mode):
                      </p>
                      <button
                        onClick={() => updateSetting("providerRouting", { qa_engineer: { provider: "ollama", model: "qwen2.5-coder:32b" } })}
                        className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                      >
                        Route QA to Ollama
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
          </div>

          {/* Memory & Learning Section */}
          <div className="relative">
            {isProPlan && <LockedOverlay />}
          <CollapsibleSection
            title="Memory & Learning"
            icon={<Brain className="w-4 h-4" />}
            iconBgColor="bg-violet-500/20"
            iconColor="text-violet-500"
            summary={settings.autoSkillExtraction ? "Auto-learning enabled" : "Auto-learning disabled"}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Auto Skill Extraction</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Automatically extract skills and create memories when tasks complete
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoSkillExtraction}
                    onChange={(e) => updateSetting("autoSkillExtraction", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-violet-500/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                </label>
              </div>
              <div className="p-4 rounded-lg bg-violet-500/5 border border-violet-500/20">
                <h4 className="text-sm font-medium text-violet-400 mb-2">What gets captured?</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• <strong>Skills (Procedural)</strong>: Reusable procedures extracted from successful tasks</li>
                  <li>• <strong>Experiences (Episodic)</strong>: What worked and what failed, lessons learned</li>
                  <li>• <strong>Knowledge (Semantic)</strong>: Codebase patterns, conventions, and insights</li>
                </ul>
                <p className="text-xs text-violet-400 mt-3">
                  View and manage memories in <Link to="/memory" className="underline hover:text-violet-300">Memory Management</Link>, <Link to="/skills" className="underline hover:text-violet-300">Skill Library</Link>, and <Link to="/directive-effectiveness" className="underline hover:text-violet-300">Directive Analytics</Link>
                </p>
              </div>

              {/* Codebase RAG Section */}
              <div className="mt-6 pt-6 border-t border-violet-500/20">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Code className="w-4 h-4 text-violet-500" />
                      Codebase Indexing
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Enable semantic search across your repository code for context-aware AI assistance
                    </p>
                  </div>
                  <label className={`relative inline-flex items-center ${isProPlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={settings.codebaseIndexingEnabled}
                      onChange={(e) => { if (!isProPlan) updateSetting("codebaseIndexingEnabled", e.target.checked); }}
                      disabled={isProPlan}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-violet-500/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                  </label>
                </div>

                {settings.codebaseIndexingEnabled && (
                  <div className="space-y-4 pl-6 border-l-2 border-violet-500/30">
                    {/* Auto Index Toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-foreground">Auto-Index on First Task</span>
                        <p className="text-xs text-muted-foreground">Automatically index the repository when the first task runs</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.codebaseAutoIndexOnTask}
                          onChange={(e) => updateSetting("codebaseAutoIndexOnTask", e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-violet-500/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                      </label>
                    </div>

                    {/* Indexing Limits */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          Max Files per Repo
                        </label>
                        <input
                          type="number"
                          min="100"
                          max="2000"
                          value={settings.codebaseMaxFilesPerRepo}
                          onChange={(e) => updateSetting("codebaseMaxFilesPerRepo", parseInt(e.target.value, 10) || 500)}
                          className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-1">100-2000</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          Max File Size (KB)
                        </label>
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={settings.codebaseMaxFileSizeKb}
                          onChange={(e) => updateSetting("codebaseMaxFileSizeKb", parseInt(e.target.value, 10) || 100)}
                          className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-1">10-500 KB</p>
                      </div>
                    </div>

                    {/* Retrieval Settings */}
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Max Code Snippets per Query
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={settings.codebaseMaxRetrievalChunks}
                        onChange={(e) => updateSetting("codebaseMaxRetrievalChunks", parseInt(e.target.value, 10) || 10)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Number of relevant code snippets to include in worker context (1-50)</p>
                    </div>

                    {/* Languages */}
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Languages to Index
                      </label>
                      <input
                        type="text"
                        value={settings.codebaseIncludeLanguages.join(", ")}
                        onChange={(e) => {
                          const languages = e.target.value.split(",").map((l) => l.trim()).filter((l) => l);
                          updateSetting("codebaseIncludeLanguages", languages);
                        }}
                        placeholder="typescript, javascript, python"
                        className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Comma-separated list of languages</p>
                    </div>

                    {/* Exclude Patterns */}
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Exclude Patterns
                      </label>
                      <textarea
                        rows={3}
                        value={settings.codebaseExcludePatterns.join("\n")}
                        onChange={(e) => {
                          const patterns = e.target.value.split("\n").map((p) => p.trim()).filter((p) => p);
                          updateSetting("codebaseExcludePatterns", patterns);
                        }}
                        placeholder="node_modules/**&#10;dist/**&#10;*.min.js"
                        className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm font-mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1">One glob pattern per line (e.g., node_modules/**, *.min.js)</p>
                    </div>

                    {/* Info Box */}
                    <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
                      <p className="text-xs text-muted-foreground">
                        <strong className="text-violet-400">How it works:</strong> Code from your repository is chunked into semantic units (functions, classes, blocks), embedded using AI, and stored for similarity search. When tasks run, relevant code examples are retrieved to provide context-grounded assistance.
                      </p>
                      <p className="text-xs text-violet-400 mt-2">
                        Cost: ~$0.01 per 500 files indexed (OpenAI text-embedding-3-small)
                      </p>
                    </div>

                    {/* Index All Button */}
                    {settings.repositories.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem("token");
                            const resp = await fetch(`${API_BASE}/api/codebase/index-all`, {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({}),
                            });
                            if (resp.ok) {
                              const data = await resp.json();
                              alert(`Indexing started for ${data.repositories.length} repositories`);
                            } else {
                              const err = await resp.json();
                              alert(`Failed: ${err.error || "Unknown error"}`);
                            }
                          } catch {
                            alert("Failed to start indexing");
                          }
                        }}
                        className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <Database className="w-4 h-4" />
                        Index All Repositories ({settings.repositories.length})
                      </button>
                    )}

                    {/* Indexed Repositories */}
                    <div className="mt-4 pt-4 border-t border-violet-500/20">
                      <h5 className="text-sm font-medium text-foreground mb-3">Indexed Repositories</h5>
                      <CodebaseIndexStatus />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>
          </div>
        </div>
      )}
    </div>
  );
}
