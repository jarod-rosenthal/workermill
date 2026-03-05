import { Crown, Eye, FileText, Lock, Monitor, Rocket, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { Settings, ValidationErrors } from "./types";

interface QualitySectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  validationErrors: ValidationErrors;
  orgPlan?: string;
}

function MaxBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 rounded-full border border-amber-500/30">
      <Crown className="w-3 h-3" />
      Max
    </span>
  );
}

function LockedOverlay() {
  return (
    <Link
      to="/pricing"
      className="absolute inset-0 bg-card/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center z-10 group cursor-pointer"
    >
      <div className="flex flex-col items-center gap-1.5">
        <Lock className="w-5 h-5 text-muted-foreground/60 group-hover:text-amber-400 transition-colors" />
        <span className="text-xs text-muted-foreground/80 font-medium group-hover:text-amber-400 transition-colors">
          Upgrade to Max
        </span>
      </div>
    </Link>
  );
}

export function QualitySection({
  settings,
  updateSetting,
  validationErrors,
  orgPlan,
}: QualitySectionProps) {
  const isProPlan = false; // Quality gates available on all plans
  return (
    <div className="space-y-6">
      {/* Workflow Automation */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">
            Workflow Automation
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure automatic post-task workflows
          </p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6 space-y-4">
        {/* Local Mode */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="w-4 h-4 text-cyan-400" />
            <div>
              <span className="text-sm text-foreground">Local Mode</span>
              <p className="text-xs text-muted-foreground">Route tasks to your remote agent instead of cloud workers</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.remoteAgentOnly}
              onChange={(e) => updateSetting("remoteAgentOnly", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* PR-Review */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Eye className="w-4 h-4 text-indigo-400" />
            <div>
              <span className="text-sm text-foreground">PR-Review</span>
              <p className="text-xs text-muted-foreground">Automatically run AI PR review on completed tasks</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoReviewEnabled}
              onChange={(e) => updateSetting("autoReviewEnabled", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* Auto-Deploy */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Rocket className="w-4 h-4 text-green-400" />
            <div>
              <span className="text-sm text-foreground">
                Auto-Deploy
                {isProPlan && <span className="ml-2"><MaxBadge /></span>}
              </span>
              <p className="text-xs text-muted-foreground">Automatically merge and deploy after successful review</p>
            </div>
          </div>
          <label className={`relative inline-flex items-center ${isProPlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={settings.autoDeployEnabled}
              onChange={(e) => { if (!isProPlan) updateSetting("autoDeployEnabled", e.target.checked); }}
              disabled={isProPlan}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* Anneal */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <div>
              <span className="text-sm text-foreground">
                Anneal
                {isProPlan && <span className="ml-2"><MaxBadge /></span>}
              </span>
              <p className="text-xs text-muted-foreground">Iteratively refine and improve code quality after completion</p>
            </div>
          </div>
          <label className={`relative inline-flex items-center ${isProPlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={settings.autoImproveEnabled}
              onChange={(e) => { if (!isProPlan) updateSetting("autoImproveEnabled", e.target.checked); }}
              disabled={isProPlan}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>

      {/* Quality Gates */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1 flex items-center gap-2">
            Quality Gates {isProPlan && <MaxBadge />}
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure quality thresholds to enforce standards before PRs are created
          </p>
        </div>
      </div>

      {/* Master Toggle */}
      <div className="relative">
        {isProPlan && <LockedOverlay />}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-foreground">Enable Quality Gates</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Block PR creation when quality thresholds are not met
            </p>
          </div>
          <label className={`relative inline-flex items-center ${isProPlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={settings.qualityGateEnabled}
              onChange={(e) => { if (!isProPlan) updateSetting("qualityGateEnabled", e.target.checked); }}
              disabled={isProPlan}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>
      </div>

      {/* Quality Thresholds */}
      {settings.qualityGateEnabled && (
        <>
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">Quality Thresholds</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Minimum Quality Score */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Minimum Quality Score
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g., 80"
                  value={settings.minQualityScore ?? ""}
                  onChange={(e) => {
                    const value = e.target.value === "" ? null : parseInt(e.target.value, 10);
                    updateSetting("minQualityScore", value);
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">0-100, leave empty to skip</p>
                {validationErrors.minQualityScore && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.minQualityScore}</p>
                )}
              </div>

              {/* Minimum Test Coverage */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Minimum Test Coverage (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g., 70"
                  value={settings.minTestCoveragePercent ?? ""}
                  onChange={(e) => {
                    const value = e.target.value === "" ? null : parseInt(e.target.value, 10);
                    updateSetting("minTestCoveragePercent", value);
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">0-100%, leave empty to skip</p>
                {validationErrors.minTestCoveragePercent && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.minTestCoveragePercent}</p>
                )}
              </div>

              {/* Max Security Vulnerabilities */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Max High-Severity Vulnerabilities
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g., 0"
                  value={settings.maxSecurityHighVulns ?? ""}
                  onChange={(e) => {
                    const value = e.target.value === "" ? null : parseInt(e.target.value, 10);
                    updateSetting("maxSecurityHighVulns", value);
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty to skip</p>
                {validationErrors.maxSecurityHighVulns && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.maxSecurityHighVulns}</p>
                )}
              </div>
            </div>

            {/* Blocking Toggles */}
            <div className="mt-6 space-y-4">
              <h4 className="text-sm font-medium text-foreground">Blocking Rules</h4>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Block on Type Errors</span>
                  <p className="text-xs text-muted-foreground">Require zero TypeScript errors</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.blockOnTypeErrors}
                    onChange={(e) => updateSetting("blockOnTypeErrors", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Block on Test Failures</span>
                  <p className="text-xs text-muted-foreground">Require all tests to pass</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.blockOnTestFailures}
                    onChange={(e) => updateSetting("blockOnTestFailures", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Auto-Fix Settings */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">Auto-Fix Agent</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Automatically attempt to fix quality issues (lint errors, formatting) before blocking
            </p>

            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-sm text-foreground">Enable Auto-Fix</span>
                <p className="text-xs text-muted-foreground">Try to fix issues before failing the quality gate</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoFixEnabled}
                  onChange={(e) => updateSetting("autoFixEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {settings.autoFixEnabled && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Max Fix Iterations
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.autoFixMaxIterations}
                  onChange={(e) => updateSetting("autoFixMaxIterations", parseInt(e.target.value, 10) || 3)}
                  className="w-32 px-3 py-2 bg-background border border-border rounded-md text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">1-10 iterations (default: 3)</p>
              </div>
            )}
          </div>

          {/* Resilience Settings */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">Resilience Settings</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure checkpoint recovery, blocker handling, and self-review for worker executions
            </p>

            {/* Auto-Retry for Blockers */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-sm text-foreground">Enable Blocker Auto-Retry</span>
                <p className="text-xs text-muted-foreground">Automatically retry fixable errors (TypeScript, lint, test failures)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.blockerAutoRetryEnabled}
                  onChange={(e) => updateSetting("blockerAutoRetryEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {settings.blockerAutoRetryEnabled && (
              <div className="mt-4 mb-6">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Max Auto-Retry Attempts
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.blockerMaxAutoRetries}
                  onChange={(e) => updateSetting("blockerMaxAutoRetries", parseInt(e.target.value, 10) || 3)}
                  className="w-32 px-3 py-2 bg-background border border-border rounded-md text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">1-10 attempts before escalating to human (default: 3)</p>
              </div>
            )}

            {/* Quality Gate Max Retries */}
            <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">Quality Gate Max Retries</span>
                <p className="text-xs text-muted-foreground">Max retries when pre-commit quality gates (lint, test, build) fail</p>
              </div>
              <input
                type="number"
                min="1"
                max="20"
                value={settings.qualityGateMaxRetries}
                onChange={(e) => updateSetting("qualityGateMaxRetries", parseInt(e.target.value, 10) || 5)}
                className="w-20 px-3 py-2 bg-background border border-border rounded-md text-foreground text-center"
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-3 mb-4 ml-0">1-20 attempts before escalating as blocker (default: 5). Separate from general auto-retry — quality gate failures give experts more chances since each retry re-runs the full code generation.</p>

            {/* CI Fix Max Retries */}
            <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">CI Fix Max Retries</span>
                <p className="text-xs text-muted-foreground">Max attempts for the CI Fix Agent to resolve PR CI failures before merging</p>
              </div>
              <input
                type="number"
                min="0"
                max="10"
                value={settings.maxCiFixRetries}
                onChange={(e) => updateSetting("maxCiFixRetries", parseInt(e.target.value, 10) || 3)}
                className="w-20 px-3 py-2 bg-background border border-border rounded-md text-foreground text-center"
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-3 mb-4 ml-0">0-10 attempts (default: 3). After CI fails on a PR, the CI Fix Agent makes surgical fixes (unused imports, type errors, lint). Set to 0 to skip CI verification and merge immediately.</p>

            {/* Blocker Wait Timeout */}
            <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">Blocker Wait Timeout (minutes)</span>
                <p className="text-xs text-muted-foreground">How long to wait for human blocker resolution before aborting</p>
              </div>
              <input
                type="number"
                min="1"
                max="120"
                value={settings.blockerWaitTimeoutMinutes}
                onChange={(e) => updateSetting("blockerWaitTimeoutMinutes", parseInt(e.target.value, 10) || 20)}
                className="w-20 px-3 py-2 bg-background border border-border rounded-md text-foreground text-center"
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-3 mb-4 ml-0">1-120 minutes (default: 20). After escalating a blocker, workers wait this long for human response before aborting the run.</p>

            {/* Push After Commit */}
            <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">Push After Each Commit</span>
                <p className="text-xs text-muted-foreground">Push to remote immediately after each agent commit (checkpoint safety)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.pushAfterCommit}
                  onChange={(e) => updateSetting("pushAfterCommit", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Graceful Shutdown */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-foreground">Graceful Shutdown</span>
                <p className="text-xs text-muted-foreground">Save uncommitted work when container receives SIGTERM</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.gracefulShutdownEnabled}
                  onChange={(e) => updateSetting("gracefulShutdownEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Self-Review */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div>
                <span className="text-sm text-foreground">
                  Self-Review
                  {isProPlan && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 rounded-full border border-amber-500/30">
                      <Crown className="w-3 h-3" />
                      Max
                    </span>
                  )}
                </span>
                <p className="text-xs text-muted-foreground">Run an extra Claude CLI pass to review each story before merging (adds latency and cost)</p>
              </div>
              <label className={`relative inline-flex items-center ${isProPlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={settings.selfReviewEnabled}
                  onChange={(e) => { if (!isProPlan) updateSetting("selfReviewEnabled", e.target.checked); }}
                  disabled={isProPlan}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>

          {/* External Quality Tools */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-medium text-foreground mb-4">External Quality Tools</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Integrate with external code quality and security tools
            </p>

            {/* SonarQube */}
            <div className="border-b border-border pb-4 mb-4">
              <h4 className="text-sm font-medium text-foreground mb-3">SonarQube</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Server URL</label>
                  <input
                    type="url"
                    placeholder="https://sonarqube.example.com"
                    value={settings.sonarqubeUrl ?? ""}
                    onChange={(e) => updateSetting("sonarqubeUrl", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Token</label>
                  <input
                    type="password"
                    placeholder="squ_..."
                    value={settings.sonarqubeToken ?? ""}
                    onChange={(e) => updateSetting("sonarqubeToken", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
              </div>
            </div>

            {/* CodeRabbit */}
            <div className="border-b border-border pb-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground">CodeRabbit</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.coderabbitEnabled}
                    onChange={(e) => updateSetting("coderabbitEnabled", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              {settings.coderabbitEnabled && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">API Key</label>
                  <input
                    type="password"
                    placeholder="cr_..."
                    value={settings.coderabbitApiKey ?? ""}
                    onChange={(e) => updateSetting("coderabbitApiKey", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
              )}
            </div>

            {/* DeepSource */}
            <div className="border-b border-border pb-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground">DeepSource</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.deepsourceEnabled}
                    onChange={(e) => updateSetting("deepsourceEnabled", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              {settings.deepsourceEnabled && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">API Token</label>
                  <input
                    type="password"
                    placeholder="ds_..."
                    value={settings.deepsourceToken ?? ""}
                    onChange={(e) => updateSetting("deepsourceToken", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
              )}
            </div>

            {/* Custom Webhook */}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">Custom Quality Webhook</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Send quality data to your own endpoint for custom validation
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Webhook URL</label>
                  <input
                    type="url"
                    placeholder="https://api.example.com/quality-check"
                    value={settings.qualityWebhookUrl ?? ""}
                    onChange={(e) => updateSetting("qualityWebhookUrl", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Secret (for HMAC)</label>
                  <input
                    type="password"
                    placeholder="Optional signing secret"
                    value={settings.qualityWebhookSecret ?? ""}
                    onChange={(e) => updateSetting("qualityWebhookSecret", e.target.value || null)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Spec Engineering */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-400" />
            Spec Engineering
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure governance rules for spec quality before decomposition into boards
          </p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6 space-y-6">
        {/* Minimum Quality Score */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Minimum Spec Quality Score
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={settings.specMinQualityScore}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              updateSetting("specMinQualityScore", isNaN(value) ? 0 : Math.max(0, Math.min(100, value)));
            }}
            className="w-full max-w-xs px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Specs must score at least this value before they can be decomposed into boards. Set to 0 to disable the quality gate.
          </p>
        </div>

        {/* Required Sections */}
        <div className="pt-4 border-t border-border">
          <label className="block text-sm font-medium text-foreground mb-3">
            Required Sections
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Select which sections must be present in a spec before it can be decomposed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              "Overview",
              "Technical Specification",
              "Data Model",
              "File Structure",
              "API Specification",
              "Component Specification",
              "Quality Gates",
              "Acceptance Criteria",
              "Scope Boundary",
            ].map((section) => {
              const currentSections = settings.specRequiredSections ?? [];
              const isChecked = currentSections.includes(section);
              return (
                <label
                  key={section}
                  className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      let updated: string[];
                      if (e.target.checked) {
                        updated = [...currentSections, section];
                      } else {
                        updated = currentSections.filter((s) => s !== section);
                      }
                      updateSetting("specRequiredSections", updated.length > 0 ? updated : null);
                    }}
                    className="rounded border-border text-primary focus:ring-primary/20"
                  />
                  <span className="text-sm text-foreground">{section}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
