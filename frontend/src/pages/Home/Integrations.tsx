import {
  ArrowRight,
  CheckCircle,
  GitPullRequest,
  ListTodo,
  Bot,
  Clock,
} from "lucide-react";

interface IntegrationFeature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const jiraFeatures: IntegrationFeature[] = [
  {
    icon: <ListTodo className="w-4 h-4" />,
    title: "Auto-fetch tickets",
    description: "Pull assigned issues automatically",
  },
  {
    icon: <CheckCircle className="w-4 h-4" />,
    title: "Status sync",
    description: "Update Jira as work progresses",
  },
  {
    icon: <Clock className="w-4 h-4" />,
    title: "Time tracking",
    description: "Log work hours automatically",
  },
];

const githubFeatures: IntegrationFeature[] = [
  {
    icon: <GitPullRequest className="w-4 h-4" />,
    title: "Auto PR creation",
    description: "Open PRs with proper descriptions",
  },
  {
    icon: <Bot className="w-4 h-4" />,
    title: "Branch management",
    description: "Create feature branches automatically",
  },
  {
    icon: <CheckCircle className="w-4 h-4" />,
    title: "CI integration",
    description: "Wait for checks before completion",
  },
];

const comingSoon = ["Linear", "GitLab", "Bitbucket", "Azure DevOps"];

export function Integrations() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Seamless Integrations
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            WorkerMill connects your project management and code repositories for
            end-to-end automation.
          </p>
        </div>

        {/* Integration Flow */}
        <div className="flex flex-col lg:flex-row items-center justify-center gap-6 mb-12">
          {/* Jira Card */}
          <div className="w-full lg:w-80 bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-blue-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.005 1.005 0 0 0 23.013 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Jira</h3>
                <p className="text-xs text-muted-foreground">Project Management</p>
              </div>
            </div>
            <ul className="space-y-3">
              {jiraFeatures.map((feature, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div className="text-blue-500 mt-0.5">{feature.icon}</div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {feature.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {feature.description}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-2">
            <ArrowRight className="w-8 h-8 text-primary hidden lg:block" />
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
              <Bot className="w-8 h-8 text-primary-foreground" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              WorkerMill
            </span>
            <ArrowRight className="w-8 h-8 text-primary hidden lg:block" />
          </div>

          {/* GitHub Card */}
          <div className="w-full lg:w-80 bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gray-500/10 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-foreground"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">GitHub</h3>
                <p className="text-xs text-muted-foreground">Code Repository</p>
              </div>
            </div>
            <ul className="space-y-3">
              {githubFeatures.map((feature, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div className="text-foreground mt-0.5">{feature.icon}</div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {feature.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {feature.description}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Coming Soon */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-3">Coming soon:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {comingSoon.map((platform) => (
              <span
                key={platform}
                className="px-3 py-1.5 text-sm bg-muted/50 border border-border rounded-full text-muted-foreground"
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
