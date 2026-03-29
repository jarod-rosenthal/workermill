import { Link } from "react-router-dom";
import { ExternalLink, FileText, Lock, Rocket, Sparkles } from "lucide-react";
import type { Settings, ValidationErrors } from "./types";

interface QualitySectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  validationErrors: ValidationErrors;
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

export function QualitySection({
  settings,
  updateSetting,
  validationErrors,
  orgPlan: _orgPlan,
}: QualitySectionProps) {
  const isProPlan = false; // Plan-gating removed — all features available
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
        {/* Auto-Deploy — Coming Soon */}
        <div className="flex items-center justify-between pt-4 border-t border-border opacity-50">
          <div className="flex items-center gap-3">
            <Rocket className="w-4 h-4 text-green-400" />
            <div>
              <span className="text-sm text-foreground">
                Auto-Deploy
                <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded-full">Coming Soon</span>
              </span>
              <p className="text-xs text-muted-foreground">Automatically merge and deploy after successful review</p>
            </div>
          </div>
          <label className="relative inline-flex items-center opacity-40 cursor-not-allowed">
            <input type="checkbox" checked={false} disabled className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 rounded-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
          </label>
        </div>

        {/* Anneal — Coming Soon */}
        <div className="flex items-center justify-between pt-4 border-t border-border opacity-50">
          <div className="flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <div>
              <span className="text-sm text-foreground">
                Anneal
                <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground rounded-full">Coming Soon</span>
              </span>
              <p className="text-xs text-muted-foreground">Analyze worker logs for environment issues (missing tools, broken deps) and auto-fix worker infrastructure</p>
            </div>
          </div>
          <label className="relative inline-flex items-center opacity-40 cursor-not-allowed">
            <input type="checkbox" checked={false} disabled className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 rounded-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
          </label>
        </div>
      </div>

      {/* Quality Gates */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">
            Quality Gates
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
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Block on Lint Errors</span>
                  <p className="text-xs text-muted-foreground">Require zero lint errors (ruff, eslint, etc.)</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.blockOnLintErrors}
                    onChange={(e) => updateSetting("blockOnLintErrors", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Block on E2E Test Failures</span>
                  <p className="text-xs text-muted-foreground">Require E2E tests to pass before PR approval</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.blockOnE2EFailures}
                    onChange={(e) => updateSetting("blockOnE2EFailures", e.target.checked)}
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

          {/* Execution Limits */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-medium text-foreground mb-2">Execution Limits</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Control how many attempts agents get before stopping
            </p>

            {/* Numeric limits in a clean grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Max Agent Turns */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Max Agent Turns</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  placeholder="No limit"
                  value={settings.maxAgentTurns ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateSetting("maxAgentTurns", val === "" ? null : Math.max(1, parseInt(val, 10) || 1));
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">CLI turns per agent invocation. Empty = no limit.</p>
              </div>

              {/* Fix Agent Retries */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Fix Agent Retries</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={settings.maxFixRetries}
                  onChange={(e) => updateSetting("maxFixRetries", parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Attempts to fix quality gate / CI failures. 0 = skip.</p>
              </div>

              {/* Blocker Wait Timeout */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Blocker Wait Timeout</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={settings.blockerWaitTimeoutMinutes}
                  onChange={(e) => updateSetting("blockerWaitTimeoutMinutes", parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Minutes to wait for human blocker response before aborting.</p>
              </div>

              {/* Blocker Auto-Retry Attempts */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Blocker Auto-Retry Attempts</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={settings.blockerAutoRetryEnabled ? settings.blockerMaxAutoRetries : 0}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    if (val === 0) {
                      updateSetting("blockerAutoRetryEnabled", false);
                    } else {
                      updateSetting("blockerAutoRetryEnabled", true);
                      updateSetting("blockerMaxAutoRetries", val);
                    }
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Auto-retry fixable errors (lint, type, test). 0 = disabled.</p>
              </div>
            </div>

            {/* Toggle switches */}
            <div className="pt-4 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Push After Each Commit</span>
                  <p className="text-xs text-muted-foreground">Checkpoint safety — push to remote after each commit</p>
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

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">Graceful Shutdown</span>
                  <p className="text-xs text-muted-foreground">Save uncommitted work on container SIGTERM</p>
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

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground">
                    Self-Review
                  </span>
                  <p className="text-xs text-muted-foreground">Extra review pass per story before merging (adds latency + cost)</p>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-400" />
            Spec Engineering
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure governance rules for spec quality before decomposition into boards
          </p>
        </div>
        <Link to="/specs" className="flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0">
          <ExternalLink className="w-3.5 h-3.5" />
          Open Specs
        </Link>
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
