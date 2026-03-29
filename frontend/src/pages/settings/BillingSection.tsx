import { Link } from "react-router-dom";
import {
  AlertTriangle,
  DollarSign,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Zap,
} from "lucide-react";
import type { Settings, ValidationErrors } from "./types";

interface BillingSectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  settingsLoading: boolean;
  settingsSaving: boolean;
  validationErrors: ValidationErrors;
  hasUnsavedChanges: boolean;
  handleSaveSettings: () => void;
  organization: { plan?: string } | null;
  handleOpenBillingPortal: () => void;
  handleResetCounters: () => void;
  resetCountersLoading: boolean;
  resetMessage: { type: string; text: string } | null;
}

export function BillingSection({
  settings,
  updateSetting,
  settingsLoading,
  settingsSaving,
  validationErrors,
  hasUnsavedChanges,
  handleSaveSettings,
  organization,
  handleOpenBillingPortal,
  handleResetCounters,
  resetCountersLoading,
  resetMessage,
}: BillingSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Billing & Usage</h2>
        <p className="text-sm text-muted-foreground">Manage your subscription, credits, and spending controls</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current Plan Overview */}
          <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
            <div className="p-6 border-b border-border/50 bg-gradient-to-r from-primary/5 to-cyan-500/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Current Plan</h3>
                    <p className="text-sm text-muted-foreground capitalize">{organization?.plan || "Pro"} Plan</p>
                  </div>
                </div>
                <Link
                  to="/billing"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 inline-flex items-center gap-2 font-medium text-sm"
                >
                  <DollarSign className="w-4 h-4" />
                  Billing Dashboard
                </Link>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/30 text-center">
                  <p className="text-sm text-muted-foreground mb-1">Credits Balance</p>
                  <Link to="/billing" className="text-xl font-bold text-foreground hover:text-primary transition-colors">
                    View Balance
                  </Link>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 text-center">
                  <p className="text-sm text-muted-foreground mb-1">Payment Methods</p>
                  <Link to="/billing" className="text-xl font-bold text-foreground hover:text-primary transition-colors">
                    Manage Cards
                  </Link>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 text-center">
                  <p className="text-sm text-muted-foreground mb-1">Transactions</p>
                  <Link to="/billing" className="text-xl font-bold text-foreground hover:text-primary transition-colors">
                    View History
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Cost Control Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Cost Control</h3>
                <p className="text-sm text-muted-foreground">Set spending limits and budget alerts</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Monthly Budget Alert (USD)
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="No limit"
                      value={settings.costAlertThresholdUsd ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : parseFloat(e.target.value);
                        updateSetting("costAlertThresholdUsd", value);
                      }}
                      className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  {settings.costAlertThresholdUsd !== null && (
                    <button
                      onClick={() => updateSetting("costAlertThresholdUsd", null)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {validationErrors.costAlertThresholdUsd && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.costAlertThresholdUsd}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {settings.costAlertThresholdUsd
                    ? `You'll be notified when spending exceeds $${settings.costAlertThresholdUsd}`
                    : "Set a budget to receive alerts when spending approaches your limit"}
                </p>
              </div>

              {/* Budget Limits */}
              <div className="pt-4 border-t border-border/50">
                <h4 className="text-sm font-medium text-foreground mb-3">Budget Limits</h4>
                <p className="text-xs text-muted-foreground mb-4">
                  Set spending limits to control costs. Tasks will pause when limits are reached.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {/* Daily Limit */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">Daily Limit</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="No limit"
                        value={settings.dailyBudgetLimitUsd ?? ""}
                        onChange={(e) => {
                          const value = e.target.value === "" ? null : parseFloat(e.target.value);
                          updateSetting("dailyBudgetLimitUsd", value);
                        }}
                        className="w-full pl-7 pr-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                      />
                    </div>
                    {validationErrors.dailyBudgetLimitUsd && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.dailyBudgetLimitUsd}</p>
                    )}
                  </div>

                  {/* Weekly Limit */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">Weekly Limit</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="No limit"
                        value={settings.weeklyBudgetLimitUsd ?? ""}
                        onChange={(e) => {
                          const value = e.target.value === "" ? null : parseFloat(e.target.value);
                          updateSetting("weeklyBudgetLimitUsd", value);
                        }}
                        className="w-full pl-7 pr-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                      />
                    </div>
                    {validationErrors.weeklyBudgetLimitUsd && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.weeklyBudgetLimitUsd}</p>
                    )}
                  </div>

                  {/* Monthly Limit */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">Monthly Limit</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="No limit"
                        value={settings.monthlyBudgetLimitUsd ?? ""}
                        onChange={(e) => {
                          const value = e.target.value === "" ? null : parseFloat(e.target.value);
                          updateSetting("monthlyBudgetLimitUsd", value);
                        }}
                        className="w-full pl-7 pr-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                      />
                    </div>
                    {validationErrors.monthlyBudgetLimitUsd && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.monthlyBudgetLimitUsd}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Per-Task Cost Ceiling */}
              <div className="pt-4 border-t border-border/50">
                <h4 className="text-sm font-medium text-foreground mb-3">Per-Task Cost Ceiling</h4>
                <p className="text-xs text-muted-foreground mb-4">
                  Automatically terminate tasks that exceed this cost limit.
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="No limit"
                      value={settings.perTaskCostCeilingUsd ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : parseFloat(e.target.value);
                        updateSetting("perTaskCostCeilingUsd", value);
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                    />
                  </div>
                  {settings.perTaskCostCeilingUsd !== null && (
                    <button
                      onClick={() => updateSetting("perTaskCostCeilingUsd", null)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {validationErrors.perTaskCostCeilingUsd && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.perTaskCostCeilingUsd}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {settings.perTaskCostCeilingUsd
                    ? `Tasks will be auto-terminated if cost exceeds $${settings.perTaskCostCeilingUsd}`
                    : "Set a ceiling to prevent runaway task costs"}
                </p>
              </div>

              {/* Reset Counters */}
              <div className="pt-4 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">Reset Statistics</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Reset completed/failed task counts and cost tracking
                    </p>
                  </div>
                  <button
                    onClick={handleResetCounters}
                    disabled={resetCountersLoading}
                    className="px-4 py-2 rounded-lg bg-muted/50 border border-border hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {resetCountersLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        Reset Counters
                      </>
                    )}
                  </button>
                </div>
                {resetMessage && (
                  <p className={`text-xs mt-2 ${resetMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
                    {resetMessage.text}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Save Button */}
          {hasUnsavedChanges && (
            <div className="flex justify-end pt-4">
              <button
                onClick={handleSaveSettings}
                disabled={settingsSaving || Object.keys(validationErrors).length > 0}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 font-medium"
              >
                {settingsSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
