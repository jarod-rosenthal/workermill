import { Crown, Lock } from "lucide-react";
import type { Settings, ValidationErrors } from "./types";

interface QualitySectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  validationErrors: ValidationErrors;
  orgPlan?: string;
}

export function QualitySection({
  settings,
  updateSetting,
  validationErrors,
  orgPlan,
}: QualitySectionProps) {
  const isFreePlan = !orgPlan || orgPlan === "free";
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Quality Gates</h2>
        <p className="text-sm text-muted-foreground">
          Configure quality thresholds to enforce standards before PRs are created
        </p>
      </div>

      {/* Master Toggle */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-foreground">Enable Quality Gates</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Block PR creation when quality thresholds are not met
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.qualityGateEnabled}
              onChange={(e) => updateSetting("qualityGateEnabled", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
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
                  {isFreePlan && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 rounded-full border border-amber-500/30">
                      <Crown className="w-3 h-3" />
                      Pro
                    </span>
                  )}
                </span>
                <p className="text-xs text-muted-foreground">Run an extra Claude CLI pass to review each story before merging (adds latency and cost)</p>
              </div>
              <label className={`relative inline-flex items-center ${isFreePlan ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={settings.selfReviewEnabled}
                  onChange={(e) => { if (!isFreePlan) updateSetting("selfReviewEnabled", e.target.checked); }}
                  disabled={isFreePlan}
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
    </div>
  );
}
