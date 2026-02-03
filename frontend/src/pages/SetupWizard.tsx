import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Settings,
  GitBranch,
  Ticket,
  Bot,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface StepProps {
  onNext: () => void;
  onBack?: () => void;
}

// Step 1: Organization Settings
function OrganizationStep({ onNext }: StepProps) {
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/organizations/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: orgName }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update organization");
      }

      onNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">
          Organization Name
        </label>
        <Input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Acme Corp"
          required
        />
        <p className="text-xs text-muted-foreground">
          This is your company or team name
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <div />
        <Button type="submit" disabled={loading || !orgName.trim()}>
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4 mr-2" />
          )}
          Continue
        </Button>
      </div>
    </form>
  );
}

// Step 2: Issue Tracker Integration (Jira or Linear)
type IssueTrackerProvider = "jira" | "linear";

function IssueTrackerStep({ onNext, onBack }: StepProps) {
  const [provider, setProvider] = useState<IssueTrackerProvider>("jira");

  // Jira fields
  const [jiraHost, setJiraHost] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");

  // Linear fields
  const [linearApiKey, setLinearApiKey] = useState("");
  const [linearTeamId, setLinearTeamId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setTestSuccess(false);

    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = provider === "jira"
        ? `${API_BASE}/api/integrations/jira/test`
        : `${API_BASE}/api/integrations/linear/test`;

      const body = provider === "jira"
        ? { host: jiraHost, email: jiraEmail, apiToken: jiraApiToken, projectKey: jiraProjectKey }
        : { apiKey: linearApiKey, teamId: linearTeamId };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Connection test failed");
      }

      setTestSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = provider === "jira"
        ? `${API_BASE}/api/integrations/jira`
        : `${API_BASE}/api/integrations/linear`;

      const body = provider === "jira"
        ? { host: jiraHost, email: jiraEmail, apiToken: jiraApiToken, projectKey: jiraProjectKey }
        : { apiKey: linearApiKey, teamId: linearTeamId };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to save ${provider === "jira" ? "Jira" : "Linear"} settings`);
      }

      onNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onNext();
  };

  const isFormValid = provider === "jira"
    ? jiraHost && jiraEmail && jiraApiToken
    : linearApiKey;

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-muted-foreground">
          Issue Tracker
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setProvider("jira"); setTestSuccess(false); setError(null); }}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              provider === "jira"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔷</span>
              <div>
                <div className="font-medium text-foreground">Jira</div>
                <div className="text-xs text-muted-foreground">Atlassian Jira</div>
              </div>
              {provider === "jira" && <CheckCircle className="w-5 h-5 text-primary ml-auto" />}
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setProvider("linear"); setTestSuccess(false); setError(null); }}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              provider === "linear"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <div>
                <div className="font-medium text-foreground">Linear</div>
                <div className="text-xs text-muted-foreground">Linear.app</div>
              </div>
              {provider === "linear" && <CheckCircle className="w-5 h-5 text-primary ml-auto" />}
            </div>
          </button>
        </div>
      </div>

      {/* Jira Fields */}
      {provider === "jira" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Jira Host URL
            </label>
            <Input
              value={jiraHost}
              onChange={(e) => setJiraHost(e.target.value)}
              placeholder="https://yourcompany.atlassian.net"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Jira Email
            </label>
            <Input
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Jira API Token
            </label>
            <Input
              type="password"
              value={jiraApiToken}
              onChange={(e) => setJiraApiToken(e.target.value)}
              placeholder="Your Jira API token"
            />
            <p className="text-xs text-muted-foreground">
              Create an API token at{" "}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Atlassian Account Settings <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Default Project Key
            </label>
            <Input
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
              placeholder="PROJ"
            />
          </div>
        </div>
      )}

      {/* Linear Fields */}
      {provider === "linear" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Linear API Key
            </label>
            <Input
              type="password"
              value={linearApiKey}
              onChange={(e) => setLinearApiKey(e.target.value)}
              placeholder="lin_api_..."
            />
            <p className="text-xs text-muted-foreground">
              Create an API key at{" "}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Linear Settings <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Team ID (optional)
            </label>
            <Input
              value={linearTeamId}
              onChange={(e) => setLinearTeamId(e.target.value)}
              placeholder="Your team identifier"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {testSuccess && (
        <div className="p-3 text-sm text-green-500 bg-green-500/10 rounded-md border border-green-500/20 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          Connection successful!
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={loading}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={loading}>
            Skip for now
          </Button>
          {!testSuccess ? (
            <Button
              onClick={handleTest}
              disabled={loading || !isFormValid}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Test Connection
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Save & Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Step 3: SCM Integration (GitHub or Bitbucket)
type SCMProvider = "github" | "bitbucket";

function SCMStep({ onNext, onBack }: StepProps) {
  const [provider, setProvider] = useState<SCMProvider>("github");

  // GitHub fields
  const [githubToken, setGithubToken] = useState("");
  const [githubDefaultRepo, setGithubDefaultRepo] = useState("");

  // Bitbucket fields
  const [bitbucketUsername, setBitbucketUsername] = useState("");
  const [bitbucketAppPassword, setBitbucketAppPassword] = useState("");
  const [bitbucketWorkspace, setBitbucketWorkspace] = useState("");
  const [bitbucketDefaultRepo, setBitbucketDefaultRepo] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setTestSuccess(false);

    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = provider === "github"
        ? `${API_BASE}/api/integrations/github/test`
        : `${API_BASE}/api/integrations/bitbucket/test`;

      const body = provider === "github"
        ? { token: githubToken, defaultRepo: githubDefaultRepo }
        : { username: bitbucketUsername, appPassword: bitbucketAppPassword, workspace: bitbucketWorkspace, defaultRepo: bitbucketDefaultRepo };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Connection test failed");
      }

      setTestSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const endpoint = provider === "github"
        ? `${API_BASE}/api/integrations/github`
        : `${API_BASE}/api/integrations/bitbucket`;

      const body = provider === "github"
        ? { token: githubToken, defaultRepo: githubDefaultRepo }
        : { username: bitbucketUsername, appPassword: bitbucketAppPassword, workspace: bitbucketWorkspace, defaultRepo: bitbucketDefaultRepo };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to save ${provider === "github" ? "GitHub" : "Bitbucket"} settings`);
      }

      onNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onNext();
  };

  const isFormValid = provider === "github"
    ? githubToken && githubDefaultRepo
    : bitbucketUsername && bitbucketAppPassword && bitbucketWorkspace;

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-muted-foreground">
          Source Control
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setProvider("github"); setTestSuccess(false); setError(null); }}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              provider === "github"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🐙</span>
              <div>
                <div className="font-medium text-foreground">GitHub</div>
                <div className="text-xs text-muted-foreground">GitHub.com</div>
              </div>
              {provider === "github" && <CheckCircle className="w-5 h-5 text-primary ml-auto" />}
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setProvider("bitbucket"); setTestSuccess(false); setError(null); }}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              provider === "bitbucket"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🪣</span>
              <div>
                <div className="font-medium text-foreground">Bitbucket</div>
                <div className="text-xs text-muted-foreground">Bitbucket Cloud</div>
              </div>
              {provider === "bitbucket" && <CheckCircle className="w-5 h-5 text-primary ml-auto" />}
            </div>
          </button>
        </div>
      </div>

      {/* GitHub Fields */}
      {provider === "github" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              GitHub Personal Access Token
            </label>
            <Input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
            />
            <p className="text-xs text-muted-foreground">
              Create a token with <code className="text-primary">repo</code> scope at{" "}
              <a
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                GitHub Settings <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Default Repository
            </label>
            <Input
              value={githubDefaultRepo}
              onChange={(e) => setGithubDefaultRepo(e.target.value)}
              placeholder="owner/repo"
            />
            <p className="text-xs text-muted-foreground">
              The repository where AI workers will create PRs
            </p>
          </div>
        </div>
      )}

      {/* Bitbucket Fields */}
      {provider === "bitbucket" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Bitbucket Username
            </label>
            <Input
              value={bitbucketUsername}
              onChange={(e) => setBitbucketUsername(e.target.value)}
              placeholder="your-username"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              App Password
            </label>
            <Input
              type="password"
              value={bitbucketAppPassword}
              onChange={(e) => setBitbucketAppPassword(e.target.value)}
              placeholder="Your app password"
            />
            <p className="text-xs text-muted-foreground">
              Create an app password at{" "}
              <a
                href="https://bitbucket.org/account/settings/app-passwords/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Bitbucket Settings <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Workspace
            </label>
            <Input
              value={bitbucketWorkspace}
              onChange={(e) => setBitbucketWorkspace(e.target.value)}
              placeholder="your-workspace"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Default Repository (optional)
            </label>
            <Input
              value={bitbucketDefaultRepo}
              onChange={(e) => setBitbucketDefaultRepo(e.target.value)}
              placeholder="repo-slug"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {testSuccess && (
        <div className="p-3 text-sm text-green-500 bg-green-500/10 rounded-md border border-green-500/20 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          Connection successful!
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={loading}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={loading}>
            Skip for now
          </Button>
          {!testSuccess ? (
            <Button
              onClick={handleTest}
              disabled={loading || !isFormValid}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Test Connection
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Save & Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Step 4: AI Provider Configuration
type AIProvider = "anthropic" | "openai" | "google";

function AIProviderStep({ onBack }: Omit<StepProps, "onNext">) {
  const navigate = useNavigate();
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const providers = [
    {
      id: "anthropic" as const,
      name: "Anthropic",
      icon: "🧠",
      description: "Claude models (recommended)",
      placeholder: "sk-ant-...",
      helpUrl: "https://console.anthropic.com/settings/keys",
      color: "orange",
    },
    {
      id: "openai" as const,
      name: "OpenAI",
      icon: "🤖",
      description: "GPT models",
      placeholder: "sk-...",
      helpUrl: "https://platform.openai.com/api-keys",
      color: "emerald",
    },
    {
      id: "google" as const,
      name: "Google",
      icon: "🌐",
      description: "Gemini models",
      placeholder: "AIza...",
      helpUrl: "https://aistudio.google.com/app/apikey",
      color: "blue",
    },
  ];

  const currentProvider = providers.find(p => p.id === selectedProvider)!;

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setTestSuccess(false);

    try {
      const token = localStorage.getItem("accessToken");
      const _response = await fetch(`${API_BASE}/api/settings/providers/${selectedProvider}/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // First save the key, then test
      const saveResponse = await fetch(`${API_BASE}/api/settings/providers/${selectedProvider}/credentials`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey }),
      });

      if (!saveResponse.ok) {
        const data = await saveResponse.json();
        throw new Error(data.error || "Failed to save API key");
      }

      // Now test the saved key
      const testResponse = await fetch(`${API_BASE}/api/settings/providers/${selectedProvider}/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await testResponse.json();
      if (!testResponse.ok || !data.success) {
        throw new Error(data.error || data.message || "Connection test failed");
      }

      setTestSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setError(message);
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");

      // If not already saved (test success), save the key first
      if (!testSuccess && apiKey) {
        const saveResponse = await fetch(`${API_BASE}/api/settings/providers/${selectedProvider}/credentials`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ apiKey }),
        });

        if (!saveResponse.ok) {
          const data = await saveResponse.json();
          throw new Error(data.error || "Failed to save API key");
        }
      }

      // Update primary provider setting
      await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ primaryProvider: selectedProvider }),
      });

      // Mark setup as complete
      await fetch(`${API_BASE}/api/organizations/complete-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      navigate("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      await fetch(`${API_BASE}/api/organizations/complete-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      navigate("/dashboard");
    } catch {
      navigate("/dashboard");
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure at least one AI provider to power your workers. You can add more providers later in Settings.
      </p>

      {/* Provider Selection */}
      <div className="grid grid-cols-3 gap-3">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => {
              setSelectedProvider(provider.id);
              setTestSuccess(false);
              setError(null);
              setApiKey("");
            }}
            className={`p-4 rounded-xl border-2 text-center transition-all ${
              selectedProvider === provider.id
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="text-3xl mb-2">{provider.icon}</div>
            <div className="font-medium text-foreground">{provider.name}</div>
            <div className="text-xs text-muted-foreground">{provider.description}</div>
            {selectedProvider === provider.id && (
              <CheckCircle className="w-5 h-5 text-primary mx-auto mt-2" />
            )}
          </button>
        ))}
      </div>

      {/* API Key Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">
          {currentProvider.name} API Key
        </label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setTestSuccess(false); }}
          placeholder={currentProvider.placeholder}
        />
        <p className="text-xs text-muted-foreground">
          Get your API key from{" "}
          <a
            href={currentProvider.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {currentProvider.name} Console <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {testSuccess && (
        <div className="p-3 text-sm text-green-500 bg-green-500/10 rounded-md border border-green-500/20 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          API key verified successfully!
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={loading || testing}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={loading || testing}>
            Skip for now
          </Button>
          {!testSuccess ? (
            <Button
              onClick={handleTest}
              disabled={testing || !apiKey}
            >
              {testing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Test & Save
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Finish Setup
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const steps = [
  {
    id: "organization",
    title: "Organization",
    description: "Set up your organization",
    icon: Settings,
  },
  {
    id: "issue-tracker",
    title: "Issue Tracker",
    description: "Connect Jira or Linear",
    icon: Ticket,
  },
  {
    id: "scm",
    title: "Source Control",
    description: "Connect GitHub or Bitbucket",
    icon: GitBranch,
  },
  {
    id: "ai-provider",
    title: "AI Provider",
    description: "Configure AI models",
    icon: Bot,
  },
];

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(0);

  const goNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <OrganizationStep onNext={goNext} />;
      case 1:
        return <IssueTrackerStep onNext={goNext} onBack={goBack} />;
      case 2:
        return <SCMStep onNext={goNext} onBack={goBack} />;
      case 3:
        return <AIProviderStep onBack={goBack} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            WorkerMill
          </h1>
          <p className="text-muted-foreground mt-2">
            Let's get your AI workers set up
          </p>
        </div>

        {/* Progress Bar (Zeigarnik Effect) */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Setup Progress</span>
            <span>{Math.round(((currentStep + 1) / steps.length) * 100)}%</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                    isCompleted
                      ? "bg-primary border-primary"
                      : isActive
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="w-5 h-5 text-primary-foreground" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`w-12 h-0.5 mx-2 ${
                      isCompleted ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => {
                const Icon = steps[currentStep].icon;
                return <Icon className="w-5 h-5 text-primary" />;
              })()}
              {steps[currentStep].title}
            </CardTitle>
            <CardDescription>{steps[currentStep].description}</CardDescription>
          </CardHeader>
          <CardContent>{renderStep()}</CardContent>
        </Card>
      </div>
    </div>
  );
}
