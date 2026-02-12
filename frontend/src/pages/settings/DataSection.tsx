import {
  Clock,
  Database,
  Loader2,
  Settings as SettingsIcon,
} from "lucide-react";
import { CollapsibleSection } from "../../components/ui/CollapsibleSection";
import type { Settings, ValidationErrors } from "./types";

interface DataSectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  settingsLoading: boolean;
  validationErrors: ValidationErrors;
}

export function DataSection({
  settings,
  updateSetting,
  settingsLoading,
  validationErrors,
}: DataSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Data & Display</h2>
        <p className="text-sm text-muted-foreground">Configure retention policies and dashboard display</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Retention Policies */}
          <CollapsibleSection
            title="Retention Policies"
            icon={<Database className="w-4 h-4" />}
            iconBgColor="bg-blue-500/20"
            iconColor="text-blue-500"
            summary={`Logs: ${settings.logRetentionDays}d, Tasks: ${settings.taskRetentionDays}d`}
            defaultOpen={true}
          >
            <div className="space-y-6">
              {/* Log Retention */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Log Retention Period
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="365"
                    value={settings.logRetentionDays}
                    onChange={(e) => updateSetting("logRetentionDays", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings.logRetentionDays}
                      onChange={(e) => updateSetting("logRetentionDays", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">days</span>
                </div>
                {validationErrors.logRetentionDays && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.logRetentionDays}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Worker logs older than this are deleted (1-365)</p>
              </div>

              {/* Task Retention */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Task History Retention
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="730"
                    value={settings.taskRetentionDays}
                    onChange={(e) => updateSetting("taskRetentionDays", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="730"
                      value={settings.taskRetentionDays}
                      onChange={(e) => updateSetting("taskRetentionDays", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">days</span>
                </div>
                {validationErrors.taskRetentionDays && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.taskRetentionDays}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Task records older than this are archived (1-730)</p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Dashboard Display */}
          <CollapsibleSection
            title="Dashboard Display"
            icon={<SettingsIcon className="w-4 h-4" />}
            iconBgColor="bg-gray-500/20"
            iconColor="text-gray-400"
            summary={`Completed: ${settings.completedTaskDisplayMinutes}m, In-progress: ${settings.intermediateTaskDisplayMinutes}m`}
          >
            <div className="space-y-6">
              {/* Completed Task Display */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Completed Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={settings.completedTaskDisplayMinutes}
                    onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.completedTaskDisplayMinutes}
                      onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.completedTaskDisplayMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.completedTaskDisplayMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">How long completed tasks show on dashboard (1-60)</p>
              </div>

              {/* In-Progress Task Display */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">In-Progress Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="1440"
                    step="15"
                    value={settings.intermediateTaskDisplayMinutes}
                    onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={settings.intermediateTaskDisplayMinutes}
                      onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.intermediateTaskDisplayMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.intermediateTaskDisplayMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">In-progress tasks (PR created, awaiting review) visibility (1-1440)</p>
              </div>

              {/* Dry Run Visibility */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Dry-Run Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={settings.dryRunVisibilityMinutes}
                    onChange={(e) => updateSetting("dryRunVisibilityMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.dryRunVisibilityMinutes}
                      onChange={(e) => updateSetting("dryRunVisibilityMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.dryRunVisibilityMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.dryRunVisibilityMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Dry-run test tasks visibility after completion (1-60)</p>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
