import {
  GitBranch,
  Settings,
  CheckCircle,
  AlertCircle,
  FolderGit2,
  Plus,
  ArrowRight,
} from "lucide-react";

const scmProviders = [
  {
    name: "GitHub",
    icon: "🐙",
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    authMethod: "Personal Access Token or GitHub App",
    urlFormat: "owner/repo",
  },
  {
    name: "GitLab",
    icon: "🦊",
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    authMethod: "Private Token (PRIVATE-TOKEN header)",
    urlFormat: "group/project",
  },
  {
    name: "Bitbucket",
    icon: "🪣",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    authMethod: "Repository Access Token (Bearer)",
    urlFormat: "workspace/repo",
  },
];

export default function Repositories() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Repositories
        </h1>
        <p className="text-muted-foreground">
          Connect multiple repositories across GitHub, GitLab, and Bitbucket.
          Workers automatically clone the right repo for each task and create
          pull requests back.
        </p>
      </div>

      {/* SCM Providers */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          Supported SCM Providers
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {scmProviders.map((provider) => (
            <div
              key={provider.name}
              className="bg-card border border-border rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{provider.icon}</span>
                <h3 className="font-semibold text-foreground">
                  {provider.name}
                </h3>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Auth: </span>
                  <span className="text-foreground">
                    {provider.authMethod}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Format: </span>
                  <code className="px-1.5 py-0.5 bg-muted rounded text-foreground">
                    {provider.urlFormat}
                  </code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Adding Repositories */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" />
          Adding Repositories
        </h2>
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Add SCM Credentials
                </h3>
                <p className="text-muted-foreground">
                  Go to{" "}
                  <strong className="text-foreground">
                    Settings &gt; Integrations
                  </strong>{" "}
                  and add your token for each SCM provider you use. Each
                  provider requires its own credentials.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Set Default Repository
                </h3>
                <p className="text-muted-foreground">
                  Set a default repository for each provider in{" "}
                  <strong className="text-foreground">
                    Settings &gt; Repositories
                  </strong>
                  . This is the repo workers will target when no specific repo is
                  specified on a task.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Add Additional Repositories
                </h3>
                <p className="text-muted-foreground">
                  Add more repositories from the same page. Workers can target
                  any repository in your list — you can specify the target repo
                  when creating tasks from the dashboard.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How Repo Selection Works */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <FolderGit2 className="w-5 h-5 text-primary" />
          How Repository Selection Works
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Workers determine which repository to clone based on these rules, in
            order:
          </p>
          <div className="space-y-3">
            {[
              {
                priority: "1",
                rule: "Task-level repo override",
                desc: "If a specific repo is set on the task (via dashboard or API), that repo is used.",
              },
              {
                priority: "2",
                rule: "Issue tracker repo mapping",
                desc: "If the task came from Jira/Linear/GitHub Issues and the project has a mapped repo, that repo is used.",
              },
              {
                priority: "3",
                rule: "Organization default repo",
                desc: "Falls back to the default repository for the SCM provider configured on the organization.",
              },
            ].map((item) => (
              <div
                key={item.priority}
                className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border"
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {item.priority}
                </div>
                <div>
                  <div className="font-medium text-foreground text-sm">
                    {item.rule}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cross-Repo Tasks */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-primary" />
          Cross-Repository Tasks
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            When a task requires changes across multiple repositories (e.g., a
            backend API change that requires a frontend update), WorkerMill
            creates{" "}
            <strong className="text-foreground">
              separate pull requests per repository
            </strong>
            . Each story in the plan can target a different repo.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                How It Works
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Planning Agent identifies affected repos</li>
                <li>Stories are assigned to their target repo</li>
                <li>Each repo gets its own feature branch</li>
                <li>Separate PRs are created per repo</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                Requirements
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>All target repos must be in your repo list</li>
                <li>SCM credentials must have access to all repos</li>
                <li>Each repo must be on the same SCM provider</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Bitbucket Note */}
      <section className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Bitbucket Authentication
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Bitbucket uses{" "}
            <strong className="text-foreground">
              Repository Access Tokens
            </strong>
            , not app passwords (which are deprecated).
          </p>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="bg-background rounded-lg p-3 border border-green-500/30">
              <div className="font-medium text-green-500 mb-1">Correct</div>
              <div className="text-muted-foreground">
                REST API:{" "}
                <code className="px-1 bg-muted rounded">
                  Authorization: Bearer &lt;token&gt;
                </code>
              </div>
              <div className="text-muted-foreground mt-1">
                Git:{" "}
                <code className="px-1 bg-muted rounded">
                  https://x-bitbucket-api-token-auth:&lt;token&gt;@bitbucket.org/...
                </code>
              </div>
            </div>
            <div className="bg-background rounded-lg p-3 border border-red-500/30">
              <div className="font-medium text-red-500 mb-1">Deprecated</div>
              <div className="text-muted-foreground">
                Basic auth with{" "}
                <code className="px-1 bg-muted rounded">
                  username:app_password
                </code>{" "}
                — do not use
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
