import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Building,
  Crown,
  ExternalLink,
  Github,
  Loader2,
  Shield,
  Users,
} from "lucide-react";
import type { UserOrganization } from "../../lib/api-client";
import type { Settings, UsageData } from "./types";

interface GeneralSectionProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  orgName: string;
  orgSlug: string;
  organization: { id: string; plan?: string } | null;
  userOrganizations: UserOrganization[];
  orgsLoading: boolean;
  usageLoading: boolean;
  usageData: UsageData | null;
}

export function GeneralSection({
  settings,
  updateSetting,
  orgName,
  orgSlug,
  organization,
  userOrganizations,
  orgsLoading,
  usageLoading,
  usageData,
}: GeneralSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">General</h2>
        <p className="text-sm text-muted-foreground">Organization settings and usage</p>
      </div>

      {/* Organization Card */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Building className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Organization</h3>
            <p className="text-sm text-muted-foreground">Your workspace details</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Organization Name</label>
            <input
              type="text"
              value={orgName || "Loading..."}
              disabled
              className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Organization Slug</label>
            <p className="text-xs text-muted-foreground mb-2">Used in webhook URLs. Contact support if you need to change this.</p>
            <input
              type="text"
              value={orgSlug || "Not set"}
              disabled
              className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground cursor-not-allowed font-mono text-sm"
            />
            {orgSlug && (
              <p className="mt-2 text-xs text-muted-foreground">
                Current webhook base: <code className="bg-muted px-1 rounded">https://workermill.com/api/webhooks/{orgSlug}/</code>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Plan</label>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 text-sm font-medium rounded-full bg-primary/20 text-primary capitalize">
                {organization?.plan || "Free"}
              </span>
              <Link to="/billing" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                Manage billing <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Organization Memberships Card */}
      {userOrganizations.length > 1 && (
        <div className="border border-border/50 rounded-xl p-6 bg-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Building className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Organization Memberships</h3>
              <p className="text-sm text-muted-foreground">You belong to {userOrganizations.length} organizations</p>
            </div>
          </div>
          {orgsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading organizations...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {userOrganizations.map((org) => (
                <div
                  key={org.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    org.id === organization?.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/50 bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Building className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">
                        {org.name}
                        {org.id === organization?.id && (
                          <span className="ml-2 text-xs text-primary">(current)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {org.role === "owner" && <Crown className="w-3 h-3 text-yellow-500" />}
                        {org.role === "admin" && <Shield className="w-3 h-3 text-blue-500" />}
                        {org.role === "member" && <Users className="w-3 h-3 text-muted-foreground" />}
                        <span className="capitalize">{org.role}</span>
                        {org.isDefault && <span className="text-primary ml-1">(default)</span>}
                      </p>
                    </div>
                  </div>
                  {org.slug && (
                    <code className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                      {org.slug}
                    </code>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-3">
                Use the org switcher in the dashboard header to switch between organizations.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Usage Card */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Usage</h3>
            <p className="text-sm text-muted-foreground">Track your compute hours this billing period</p>
          </div>
        </div>
        {usageLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Loading usage data...</span>
          </div>
        ) : usageData ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Compute hours this month</span>
                <span className="text-sm text-muted-foreground">
                  {usageData.hours.isUnlimited ? (
                    <>{usageData.hours.used.toFixed(1)}h / Unlimited</>
                  ) : (
                    <>{usageData.hours.used.toFixed(1)}h / {usageData.hours.included}h</>
                  )}
                </span>
              </div>
              {!usageData.hours.isUnlimited && (
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usageData.hours.percent >= 90
                        ? "bg-red-500"
                        : usageData.hours.percent >= 75
                          ? "bg-yellow-500"
                          : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(usageData.hours.percent, 100)}%` }}
                  />
                </div>
              )}
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span className="capitalize">{usageData.plan} plan</span>
                {usageData.billingPeriod.daysUntilReset > 0 && (
                  <span>Resets in {usageData.billingPeriod.daysUntilReset} days</span>
                )}
              </div>
            </div>
            {!usageData.hours.isUnlimited && usageData.hours.percent >= 90 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>You&apos;ve used {usageData.hours.percent.toFixed(0)}% of your included compute hours.</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-4">Unable to load usage data</p>
        )}
      </div>

      {/* Repositories Card */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Github className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Repositories</h3>
            <p className="text-sm text-muted-foreground">Repositories your AI workers operate on</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Repository List
            </label>
            <textarea
              rows={4}
              value={settings.repositories.join("\n")}
              onChange={(e) => {
                const repos = e.target.value.split("\n").map((r) => r.trim()).filter((r) => r);
                updateSetting("repositories", repos);
              }}
              placeholder="owner/repo1&***REMOVED***10;owner/repo2&***REMOVED***10;owner/repo3"
              className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-foreground font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              One repository per line in <code className="bg-muted px-1 rounded">owner/repo</code> format. Max 50 repositories.
            </p>
          </div>
          {settings.repositories.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {settings.repositories.length} repositor{settings.repositories.length === 1 ? "y" : "ies"} configured
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
