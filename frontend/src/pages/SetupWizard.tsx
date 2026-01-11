import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Settings,
  GitBranch,
  Ticket,
  Users,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
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
    } catch (err: any) {
      setError(err.message || "Something went wrong");
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

// Step 2: Jira Integration
function JiraStep({ onNext, onBack }: StepProps) {
  const [jiraHost, setJiraHost] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setTestSuccess(false);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/integrations/jira/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: jiraHost,
          email: jiraEmail,
          apiToken: jiraApiToken,
          projectKey: jiraProjectKey,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Connection test failed");
      }

      setTestSuccess(true);
    } catch (err: any) {
      setError(err.message || "Connection test failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/integrations/jira`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: jiraHost,
          email: jiraEmail,
          apiToken: jiraApiToken,
          projectKey: jiraProjectKey,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save Jira settings");
      }

      onNext();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onNext();
  };

  return (
    <div className="space-y-6">
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
              className="text-primary hover:underline"
            >
              Atlassian Account Settings
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
              disabled={loading || !jiraHost || !jiraEmail || !jiraApiToken}
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

// Step 3: GitHub Integration
function GitHubStep({ onNext, onBack }: StepProps) {
  const [githubToken, setGithubToken] = useState("");
  const [defaultRepo, setDefaultRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setTestSuccess(false);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/integrations/github/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: githubToken,
          defaultRepo,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Connection test failed");
      }

      setTestSuccess(true);
    } catch (err: any) {
      setError(err.message || "Connection test failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/integrations/github`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: githubToken,
          defaultRepo,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save GitHub settings");
      }

      onNext();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onNext();
  };

  return (
    <div className="space-y-6">
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
              className="text-primary hover:underline"
            >
              GitHub Settings
            </a>
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Default Repository
          </label>
          <Input
            value={defaultRepo}
            onChange={(e) => setDefaultRepo(e.target.value)}
            placeholder="owner/repo"
          />
          <p className="text-xs text-muted-foreground">
            The repository where AI workers will create PRs
          </p>
        </div>
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
              disabled={loading || !githubToken || !defaultRepo}
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

// Step 4: Worker Configuration
function WorkersStep({ onBack }: Omit<StepProps, "onNext">) {
  const navigate = useNavigate();
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([
    "backend_developer",
    "frontend_developer",
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personas = [
    {
      id: "frontend_developer",
      emoji: "🎨",
      title: "Frontend Developer",
      description: "React, TypeScript, CSS, UI/UX",
    },
    {
      id: "backend_developer",
      emoji: "⚙️",
      title: "Backend Developer",
      description: "APIs, databases, server logic",
    },
    {
      id: "devops_engineer",
      emoji: "🔧",
      title: "DevOps Engineer",
      description: "Infrastructure, CI/CD, Docker",
    },
    {
      id: "security_engineer",
      emoji: "🔒",
      title: "Security Engineer",
      description: "Security audits, compliance",
    },
    {
      id: "qa_engineer",
      emoji: "🧪",
      title: "QA Engineer",
      description: "Testing, quality assurance",
    },
    {
      id: "tech_writer",
      emoji: "📝",
      title: "Technical Writer",
      description: "Documentation, guides",
    },
    {
      id: "project_manager",
      emoji: "📋",
      title: "Project Manager",
      description: "Planning, coordination",
    },
  ];

  const togglePersona = (id: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/workers/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ personas: selectedPersonas }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create workers");
      }

      // Mark setup as complete and go to dashboard
      await fetch(`${API_BASE}/api/organizations/complete-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Select which AI worker personas you want to enable. You can add or
        remove workers later from the dashboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {personas.map((persona) => {
          const isSelected = selectedPersonas.includes(persona.id);
          return (
            <button
              key={persona.id}
              onClick={() => togglePersona(persona.id)}
              className={`p-4 rounded-xl border text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{persona.emoji}</span>
                <div>
                  <div className="font-medium text-foreground">
                    {persona.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {persona.description}
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle className="w-5 h-5 text-primary ml-auto" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={loading}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleFinish}
          disabled={loading || selectedPersonas.length === 0}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4 mr-2" />
          )}
          Finish Setup
        </Button>
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
    id: "jira",
    title: "Jira",
    description: "Connect to Jira",
    icon: Ticket,
  },
  {
    id: "github",
    title: "GitHub",
    description: "Connect to GitHub",
    icon: GitBranch,
  },
  {
    id: "workers",
    title: "Workers",
    description: "Configure AI workers",
    icon: Users,
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
        return <JiraStep onNext={goNext} onBack={goBack} />;
      case 2:
        return <GitHubStep onNext={goNext} onBack={goBack} />;
      case 3:
        return <WorkersStep onBack={goBack} />;
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
