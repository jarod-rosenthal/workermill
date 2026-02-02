import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  X,
  CheckCircle,
  Circle,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Settings,
  Github,
  Tag,
  Rocket,
  Bot,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { useToast } from "../contexts/ToastContext";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface IntegrationStatus {
  jira: {
    configured: boolean;
    baseUrl?: string;
  };
  linear: {
    configured: boolean;
  };
  github: {
    configured: boolean;
    defaultRepo?: string;
  };
  bitbucket: {
    configured: boolean;
    workspace?: string;
  };
  aiProvider: {
    configured: boolean;
    providers: string[];
  };
}

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  isComplete: boolean;
}

interface OnboardingWizardProps {
  onClose: () => void;
  onComplete: () => void;
}

const WEBHOOK_URL = "https://workermill.com/api/webhooks/jira";

export function OnboardingWizard({ onClose, onComplete }: OnboardingWizardProps) {
  const tokens = useAuthStore((state) => state.tokens);
  const toast = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Fetch integration status
  const fetchIntegrationStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      // Fetch integrations and providers in parallel
      const [integrationsResponse, providersResponse] = await Promise.all([
        fetch(`${API_BASE}/api/settings/integrations`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
        fetch(`${API_BASE}/api/settings/providers`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
      ]);

      if (integrationsResponse.ok) {
        const data = await integrationsResponse.json();

        // Parse AI provider status
        let aiProviderConfigured = false;
        const configuredProviders: string[] = [];

        if (providersResponse.ok) {
          const providersData = await providersResponse.json();
          const providers = providersData.providers || [];
          for (const p of providers) {
            if (p.configured && ["anthropic", "openai", "google"].includes(p.id)) {
              const name = p.id === "anthropic" ? "Anthropic" : p.id === "openai" ? "OpenAI" : "Google";
              configuredProviders.push(name);
            }
          }
          aiProviderConfigured = configuredProviders.length > 0;
        }

        setIntegrationStatus({
          jira: {
            configured: data.jira?.configured || false,
            baseUrl: data.jira?.baseUrl,
          },
          linear: {
            configured: data.linear?.configured || false,
          },
          github: {
            configured: data.github?.configured || false,
            defaultRepo: data.github?.defaultRepo,
          },
          bitbucket: {
            configured: data.bitbucket?.configured || false,
            workspace: data.bitbucket?.workspace,
          },
          aiProvider: {
            configured: aiProviderConfigured,
            providers: configuredProviders,
          },
        });
      } else {
        toast.warning("Could not load integration status");
      }
    } catch {
      toast.warning("Could not load integration status");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken, toast]);

  useEffect(() => {
    fetchIntegrationStatus();
  }, [fetchIntegrationStatus]);

  // Copy webhook URL to clipboard
  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(WEBHOOK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  // Build steps with completion status
  const issueTrackerConfigured = integrationStatus?.jira?.configured || integrationStatus?.linear?.configured || false;
  const scmConfigured = integrationStatus?.github?.configured || integrationStatus?.bitbucket?.configured || false;

  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: "Issue Tracker",
      description: "Connect Jira or Linear for task management",
      isComplete: issueTrackerConfigured,
    },
    {
      id: 2,
      title: "Source Control",
      description: "Link GitHub or Bitbucket for code changes",
      isComplete: scmConfigured,
    },
    {
      id: 3,
      title: "AI Provider",
      description: "Configure your AI model provider",
      isComplete: integrationStatus?.aiProvider?.configured || false,
    },
    {
      id: 4,
      title: "Run First Task",
      description: "Learn how to trigger your first AI worker",
      isComplete: false, // This is an informational step
    },
    {
      id: 5,
      title: "Complete!",
      description: "You're ready to use WorkerMill",
      isComplete: false,
    },
  ];

  const handleNext = () => {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem("workermill_onboarding_completed", "true");
    onComplete();
  };

  const handleSkip = () => {
    localStorage.setItem("workermill_onboarding_completed", "true");
    onClose();
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Tag className="w-7 h-7 text-blue-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Connect Issue Tracker</h3>
                <p className="text-sm text-muted-foreground">
                  WorkerMill receives tasks via webhooks from Jira or Linear
                </p>
              </div>
              {issueTrackerConfigured && (
                <span className="ml-auto flex items-center gap-1 text-green-500 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Connected
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Jira Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.jira?.configured ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-500" fill="currentColor">
                    <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6c0 2.4 1.94 4.35 4.35 4.35h1.78v1.7c.01 2.39 1.95 4.34 4.34 4.35v-9.57a.84.84 0 0 0-.84-.83H2z" />
                  </svg>
                  <span className="font-medium text-foreground">Jira</span>
                  {integrationStatus?.jira?.configured && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Configure Jira credentials in Settings, then set up a webhook pointing to:
                </p>
                <div className="flex items-center gap-2 p-2 bg-muted/30 rounded border border-border text-xs">
                  <code className="flex-1 font-mono break-all">{WEBHOOK_URL}</code>
                  <button onClick={handleCopyWebhook} className="p-1 hover:bg-muted rounded">
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {/* Linear Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.linear?.configured ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">⚡</span>
                  <span className="font-medium text-foreground">Linear</span>
                  {integrationStatus?.linear?.configured && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Configure Linear API key in Settings. Webhook is set up automatically.
                </p>
              </div>

              <Link
                to="/settings"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Configure in Settings
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gray-500/20 flex items-center justify-center">
                <Github className="w-7 h-7 text-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Connect Source Control</h3>
                <p className="text-sm text-muted-foreground">
                  Allow workers to create PRs in your repository
                </p>
              </div>
              {scmConfigured && (
                <span className="ml-auto flex items-center gap-1 text-green-500 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Connected
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* GitHub Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.github?.configured ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <Github className="w-6 h-6" />
                  <span className="font-medium text-foreground">GitHub</span>
                  {integrationStatus?.github?.configured && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Create a Personal Access Token with <code className="bg-muted/50 px-1 rounded">repo</code> scope.
                </p>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=WorkerMill"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Create GitHub Token <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Bitbucket Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.bitbucket?.configured ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">🪣</span>
                  <span className="font-medium text-foreground">Bitbucket</span>
                  {integrationStatus?.bitbucket?.configured && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Create a Repository Access Token with <code className="bg-muted/50 px-1 rounded">repository:write</code> and <code className="bg-muted/50 px-1 rounded">pullrequest:write</code> scopes.
                </p>
                <a
                  href="https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Bitbucket Token Docs <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <Link
                to="/settings"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Configure in Settings
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <Bot className="w-7 h-7 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Configure AI Provider</h3>
                <p className="text-sm text-muted-foreground">
                  Add your API key for AI-powered code generation
                </p>
              </div>
              {integrationStatus?.aiProvider?.configured && (
                <span className="ml-auto flex items-center gap-1 text-green-500 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Configured
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Anthropic Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.aiProvider?.providers.includes('Anthropic') ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🧠</span>
                  <span className="font-medium text-foreground">Anthropic</span>
                  <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">Recommended</span>
                  {integrationStatus?.aiProvider?.providers.includes('Anthropic') && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Claude models - best for code generation and analysis
                </p>
              </div>

              {/* OpenAI Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.aiProvider?.providers.includes('OpenAI') ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🤖</span>
                  <span className="font-medium text-foreground">OpenAI</span>
                  {integrationStatus?.aiProvider?.providers.includes('OpenAI') && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  GPT models for code completion and generation
                </p>
              </div>

              {/* Google Option */}
              <div className={`p-4 rounded-lg border ${integrationStatus?.aiProvider?.providers.includes('Google') ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🌐</span>
                  <span className="font-medium text-foreground">Google</span>
                  {integrationStatus?.aiProvider?.providers.includes('Google') && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Gemini models for AI-powered development
                </p>
              </div>

              <Link
                to="/settings"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Add API Key in Settings
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <Rocket className="w-7 h-7 text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Run Your First Task</h3>
                <p className="text-sm text-muted-foreground">
                  Trigger an AI worker to work on a ticket
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="text-sm font-medium text-foreground mb-3">How it works:</h4>
                <ol className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <span>Create or select a Jira ticket with clear requirements</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                      2
                    </span>
                    <span>
                      Add the <code className="bg-muted/50 px-1.5 py-0.5 rounded font-mono">workermill</code> label to the ticket
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                      3
                    </span>
                    <span>WorkerMill automatically spawns an AI worker to complete the task</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                      4
                    </span>
                    <span>The worker creates a PR with the changes for your review</span>
                  </li>
                </ol>
              </div>

              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">Optional Labels</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Control worker behavior with additional labels:
                </p>
                <div className="grid gap-2">
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                    <code className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">
                      haiku
                    </code>
                    <span className="text-sm text-muted-foreground">Fast, cost-effective model</span>
                  </div>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                    <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-mono">
                      sonnet
                    </code>
                    <span className="text-sm text-muted-foreground">Balanced performance (default)</span>
                  </div>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                    <code className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded font-mono">
                      opus
                    </code>
                    <span className="text-sm text-muted-foreground">Most capable model</span>
                  </div>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                    <code className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded font-mono">
                      deploy
                    </code>
                    <span className="text-sm text-muted-foreground">Auto-merge and deploy (skip review)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-foreground mb-2">You're All Set!</h3>
              <p className="text-muted-foreground">
                WorkerMill is ready to supercharge your development workflow
              </p>
            </div>

            <div className="grid gap-3 text-left">
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${issueTrackerConfigured ? 'bg-green-500/10 border-green-500/20' : 'bg-muted/10 border-border'}`}>
                {issueTrackerConfigured ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
                <span className={issueTrackerConfigured ? "text-foreground" : "text-muted-foreground"}>
                  Issue Tracker {issueTrackerConfigured && `(${integrationStatus?.jira?.configured ? 'Jira' : 'Linear'})`}
                </span>
              </div>
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${scmConfigured ? 'bg-green-500/10 border-green-500/20' : 'bg-muted/10 border-border'}`}>
                {scmConfigured ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
                <span className={scmConfigured ? "text-foreground" : "text-muted-foreground"}>
                  Source Control {scmConfigured && `(${integrationStatus?.github?.configured ? 'GitHub' : 'Bitbucket'})`}
                </span>
              </div>
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${integrationStatus?.aiProvider?.configured ? 'bg-green-500/10 border-green-500/20' : 'bg-muted/10 border-border'}`}>
                {integrationStatus?.aiProvider?.configured ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
                <span className={integrationStatus?.aiProvider?.configured ? "text-foreground" : "text-muted-foreground"}>
                  AI Provider {integrationStatus?.aiProvider?.configured && `(${integrationStatus.aiProvider.providers.join(', ')})`}
                </span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {!issueTrackerConfigured || !scmConfigured || !integrationStatus?.aiProvider?.configured
                ? "You can complete the remaining setup later in Settings."
                : "All integrations are connected! Add the workermill label to a ticket to get started."}
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-8 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 via-transparent to-accent/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Welcome to WorkerMill</h2>
              <p className="text-xs text-muted-foreground">Let's get you set up</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress indicator */}
        <div className="px-6 pt-4">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step.id)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    step.id === currentStep
                      ? "bg-primary text-primary-foreground"
                      : step.id < currentStep || step.isComplete
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.id < currentStep || step.isComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    step.id
                  )}
                </button>
                {index < steps.length - 1 && (
                  <div
                    className={`w-12 h-0.5 mx-1 ${
                      step.id < currentStep ? "bg-green-500" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">{renderStepContent()}</div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 bg-muted/20 flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              {currentStep === 5 ? (
                <>
                  Go to Dashboard
                  <Rocket className="w-4 h-4" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to check if onboarding should be shown
export function useOnboardingState() {
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const tokens = useAuthStore((state) => state.tokens);
  const organization = useAuthStore((state) => state.organization);

  useEffect(() => {
    const checkOnboardingState = async () => {
      // Check if already completed
      const completed = localStorage.getItem("workermill_onboarding_completed");
      if (completed === "true") {
        setShouldShowOnboarding(false);
        return;
      }

      // Check if org is new (optional - could check org creation date)
      // For now, show onboarding if not completed and user is authenticated
      if (tokens?.accessToken) {
        // Check if there are any completed tasks
        try {
          const response = await fetch(
            `${API_BASE}/api/control-center`,
            {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            // Show onboarding if no completed tasks
            const hasCompletedTasks = data.recentCompleted && data.recentCompleted.length > 0;
            setShouldShowOnboarding(!hasCompletedTasks);
          }
        } catch {
          // On error, don't show onboarding to avoid blocking users
          // Silent failure is acceptable here - don't spam toasts on app load
          setShouldShowOnboarding(false);
        }
      }
    };

    checkOnboardingState();
  }, [tokens?.accessToken, organization]);

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem("workermill_onboarding_completed", "true");
    setShouldShowOnboarding(false);
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem("workermill_onboarding_completed");
    setShouldShowOnboarding(true);
  }, []);

  return {
    shouldShowOnboarding,
    dismissOnboarding,
    resetOnboarding,
  };
}
