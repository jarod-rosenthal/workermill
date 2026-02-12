import {
  Bell,
  Building,
  CheckCircle,
  ChevronRight,
  Loader2,
  Mail,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import { CollapsibleSection } from "../../components/ui/CollapsibleSection";
import type { Settings, ValidationErrors, IntegrationStatus, EmailPreferences } from "./types";
import { API_BASE } from "./types";

interface NotificationsSectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  settingsLoading: boolean;
  settingsSaving: boolean;
  validationErrors: ValidationErrors;
  hasUnsavedChanges: boolean;
  handleSaveSettings: () => void;
  userEmailPreferences: EmailPreferences;
  userEmailPrefsLoading: boolean;
  userEmailPrefsSaving: boolean;
  hasUnsavedUserEmailPrefs: boolean;
  updateUserEmailPref: <K extends keyof EmailPreferences>(key: K, value: EmailPreferences[K]) => void;
  saveUserEmailPreferences: () => void;
  testEmailLoading: boolean;
  setTestEmailLoading: (loading: boolean) => void;
  testEmailMessage: { type: "success" | "error"; text: string } | null;
  setTestEmailMessage: (msg: { type: "success" | "error"; text: string } | null) => void;
  slackStatus: IntegrationStatus;
  teamsStatus: IntegrationStatus;
  setSlackSlideOpen: (open: boolean) => void;
  setTeamsSlideOpen: (open: boolean) => void;
}

export function NotificationsSection({
  settings,
  updateSetting,
  settingsLoading,
  settingsSaving,
  validationErrors,
  hasUnsavedChanges,
  handleSaveSettings,
  userEmailPreferences,
  userEmailPrefsLoading,
  userEmailPrefsSaving,
  hasUnsavedUserEmailPrefs,
  updateUserEmailPref,
  saveUserEmailPreferences,
  testEmailLoading,
  setTestEmailLoading,
  testEmailMessage,
  setTestEmailMessage,
  slackStatus,
  teamsStatus,
  setSlackSlideOpen,
  setTeamsSlideOpen,
}: NotificationsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground">Configure how WorkerMill notifies you about tasks and alerts</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Your Email Preferences Card (User-level) */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Your Email Preferences</h3>
                  <p className="text-sm text-muted-foreground">Choose which notifications you want to receive</p>
                </div>
              </div>
              {userEmailPrefsLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>

            {!settings.emailNotificationsEnabled ? (
              <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
                <p className="text-sm">Email notifications are disabled for this organization. Contact an admin to enable them.</p>
              </div>
            ) : userEmailPrefsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Notification Types */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">Notification Types</h4>

                  {/* Task Completed */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Task Completed</p>
                      <p className="text-xs text-muted-foreground">Get notified when tasks complete successfully</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.taskCompleted ?? true}
                      onChange={(e) => updateUserEmailPref("taskCompleted", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* Task Failed */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Task Failed</p>
                      <p className="text-xs text-muted-foreground">Get notified when tasks fail or error</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.taskFailed ?? true}
                      onChange={(e) => updateUserEmailPref("taskFailed", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* Cost Alerts */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Cost Alerts</p>
                      <p className="text-xs text-muted-foreground">Get notified when spending exceeds thresholds</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.costAlerts ?? true}
                      onChange={(e) => updateUserEmailPref("costAlerts", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* PR Created */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">PR Created</p>
                      <p className="text-xs text-muted-foreground">Get notified when pull requests are created</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.prCreated ?? false}
                      onChange={(e) => updateUserEmailPref("prCreated", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Delivery Frequency</label>
                  <select
                    value={userEmailPreferences.frequency ?? "immediate"}
                    onChange={(e) => updateUserEmailPref("frequency", e.target.value as EmailPreferences["frequency"])}
                    className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="daily">Daily Digest</option>
                    <option value="weekly">Weekly Digest</option>
                    <option value="never">Never (disabled)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {userEmailPreferences.frequency === "immediate" && "Receive notifications as events happen"}
                    {userEmailPreferences.frequency === "daily" && "Receive a daily summary at 9am"}
                    {userEmailPreferences.frequency === "weekly" && "Receive a weekly summary on Mondays"}
                    {userEmailPreferences.frequency === "never" && "Email notifications are disabled for you"}
                  </p>
                </div>

                {/* Save Button for User Preferences */}
                {hasUnsavedUserEmailPrefs && (
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={saveUserEmailPreferences}
                      disabled={userEmailPrefsSaving}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2 text-sm font-medium"
                    >
                      {userEmailPrefsSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Preferences
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Organization Email Settings Card (Admin-only) */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Building className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Organization Email Settings</h3>
                  <p className="text-sm text-muted-foreground">Admin settings that apply to all team members</p>
                </div>
              </div>
              {/* Master Toggle */}
              <button
                onClick={() => updateSetting("emailNotificationsEnabled", !settings.emailNotificationsEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.emailNotificationsEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    settings.emailNotificationsEnabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div>
                  <p className="font-medium text-foreground">Enable Email Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {settings.emailNotificationsEnabled
                      ? "Emails are enabled for this organization"
                      : "Emails are disabled for all team members"}
                  </p>
                </div>
                <span className={`text-sm font-medium ${settings.emailNotificationsEnabled ? "text-green-500" : "text-muted-foreground"}`}>
                  {settings.emailNotificationsEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              {settings.emailNotificationsEnabled && (
                <CollapsibleSection
                  title="Default Preferences for New Members"
                  defaultOpen={false}
                  summary="Set the default notification preferences for new team members"
                >
                  <div className="space-y-3 pt-2">
                    {/* Task Completed Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Task Completed</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.taskCompleted ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          taskCompleted: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Task Failed Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Task Failed</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.taskFailed ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          taskFailed: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Cost Alerts Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Cost Alerts</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.costAlerts ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          costAlerts: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* PR Created Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">PR Created</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.prCreated ?? false}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          prCreated: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Default Frequency */}
                    <div className="pt-2">
                      <label className="block text-sm font-medium text-foreground mb-2">Default Delivery Frequency</label>
                      <select
                        value={settings.defaultEmailPreferences.frequency ?? "immediate"}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          frequency: e.target.value as EmailPreferences["frequency"],
                        })}
                        className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                      >
                        <option value="immediate">Immediate</option>
                        <option value="daily">Daily Digest</option>
                        <option value="weekly">Weekly Digest</option>
                        <option value="never">Never (disabled)</option>
                      </select>
                    </div>
                  </div>
                </CollapsibleSection>
              )}

              {/* Send Test Email Button */}
              {settings.emailNotificationsEnabled && (
                <div className="pt-4 border-t border-border/50">
                  <button
                    onClick={async () => {
                      setTestEmailLoading(true);
                      setTestEmailMessage(null);
                      try {
                        const token = localStorage.getItem("accessToken");
                        const response = await fetch(`${API_BASE}/api/settings/test-email`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                          },
                        });
                        const data = await response.json();
                        if (response.ok) {
                          setTestEmailMessage({ type: "success", text: data.message });
                        } else {
                          setTestEmailMessage({ type: "error", text: data.error || "Failed to send test email" });
                        }
                      } catch {
                        setTestEmailMessage({ type: "error", text: "Failed to send test email" });
                      } finally {
                        setTestEmailLoading(false);
                        setTimeout(() => setTestEmailMessage(null), 5000);
                      }
                    }}
                    disabled={testEmailLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {testEmailLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send Test Email
                  </button>
                  {testEmailMessage && (
                    <p className={`mt-2 text-sm ${testEmailMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
                      {testEmailMessage.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Webhook Notifications Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Webhook Notifications</h3>
                <p className="text-sm text-muted-foreground">Send notifications to Slack or Teams channels</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Slack */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[***REMOVED***4A154B] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Slack</p>
                    <p className="text-xs text-muted-foreground">
                      {slackStatus.connected ? "Connected" : "Not configured"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {slackStatus.connected ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <button
                    onClick={() => setSlackSlideOpen(true)}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    Configure <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Microsoft Teams */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[***REMOVED***6264A7] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.625 8.073c.574 0 1.125.228 1.532.634a2.164 2.164 0 0 1 0 3.063 2.168 2.168 0 0 1-1.532.635c-.574 0-1.125-.229-1.532-.635a2.164 2.164 0 0 1 0-3.063 2.168 2.168 0 0 1 1.532-.634zm-4.219 1.761a3.438 3.438 0 0 1 3.438 3.438v5.156a.625.625 0 0 1-.625.625h-5.625a.625.625 0 0 1-.625-.625v-5.156a3.438 3.438 0 0 1 3.437-3.438zm-1.562-5.459a2.813 2.813 0 1 1 0 5.625 2.813 2.813 0 0 1 0-5.625zM9.375 6.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5zm0 8.75a5.625 5.625 0 0 1 5.625 5.625.625.625 0 0 1-.625.625H4.375a.625.625 0 0 1-.625-.625A5.625 5.625 0 0 1 9.375 15z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Microsoft Teams</p>
                    <p className="text-xs text-muted-foreground">
                      {teamsStatus.connected ? "Connected" : "Not configured"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {teamsStatus.connected ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <button
                    onClick={() => setTeamsSlideOpen(true)}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    Configure <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
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
