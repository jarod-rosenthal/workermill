import { useState, useEffect } from "react";
import type { IssueTrackerConfig } from "../lib/utils";

let cachedConfig: IssueTrackerConfig | null = null;
let fetchPromise: Promise<IssueTrackerConfig | null> | null = null;

/**
 * Hook to fetch and cache issue tracker configuration from org settings.
 * Uses a module-level cache to avoid redundant API calls across components.
 */
export function useIssueTrackerConfig(): IssueTrackerConfig | null {
  const [config, setConfig] = useState<IssueTrackerConfig | null>(cachedConfig);

  useEffect(() => {
    // If we already have cached config, use it
    if (cachedConfig) {
      setConfig(cachedConfig);
      return;
    }

    // If a fetch is already in progress, wait for it
    if (fetchPromise) {
      fetchPromise.then((result) => {
        if (result) setConfig(result);
      });
      return;
    }

    // Start a new fetch
    fetchPromise = (async () => {
      try {
        const response = await fetch("/api/settings/integrations", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });
        if (response.ok) {
          const integrations = await response.json();
          const newConfig: IssueTrackerConfig = {
            provider: integrations.defaultIssueTracker || "jira",
            jiraBaseUrl: integrations.jira?.baseUrl || "",
            linearWorkspace: integrations.linear?.workspace || "",
            githubRepo: integrations.github?.issuesRepo || integrations.github?.defaultRepo || "",
          };
          cachedConfig = newConfig;
          return newConfig;
        }
      } catch (error) {
        console.error("Failed to fetch issue tracker config:", error);
      }
      return null;
    })();

    fetchPromise.then((result) => {
      if (result) setConfig(result);
      fetchPromise = null;
    });
  }, []);

  return config;
}

/**
 * Invalidate the cached config (call when settings are updated)
 */
export function invalidateIssueTrackerConfigCache(): void {
  cachedConfig = null;
  fetchPromise = null;
}
