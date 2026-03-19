import {
  ArrowRight,
  GitPullRequest,
  ListTodo,
  Bot,
  GitBranch,
  Brain,
  Building2,
} from "lucide-react";

// Issue Trackers
const issueTrackers = [
  {
    name: "Jira",
    description: "Atlassian's enterprise project management",
    icon: (
      <svg className="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.005 1.005 0 0 0 23.013 0z" />
      </svg>
    ),
    color: "border-blue-500/30",
    bgColor: "bg-blue-500/10",
  },
  {
    name: "Linear",
    description: "Modern issue tracking for fast teams",
    icon: (
      <svg className="w-6 h-6 text-purple-500" viewBox="0 0 100 100" fill="currentColor">
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5765C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.29613465.7672l52.047167 52.0471c.2073.2073.4839.3138.7672.2962 1.3107-.0814 2.6111-.2086 3.8975-.3822.8425-.1136 1.1211-1.1603.4789-1.8024L3.18153 42.9106c-.6422-.6422-1.6889-.3637-1.80243.4789-.17358 1.2863-.30074 2.5868-.38221 3.8975ZM4.6526 32.9905c-.35423.4141-.36198 1.0229-.01652 1.4464l60.9273 60.9272c.4234.3455 1.0323.3377 1.4464-.0165 1.0646-.9096 2.0936-1.8589 3.0851-2.8461.6417-.6394.5765-1.6977-.1396-2.2618L8.83772 29.1218c-.71636-.5765-1.62241-.5765-2.26184.1396-.98723.9915-1.93654 2.0205-2.84618 3.0851ZM12.6036 21.5964c-.56552.5735-.60127 1.4939-.08152 2.1058l64.776 64.7759c.6119.5198 1.5323.4838 2.1058-.0815 1.3346-1.3148 2.6132-2.6806 3.8331-4.0948.5765-.6686.5765-1.6468-.0814-2.2247L17.7802 16.6009c-.5765-.6582-1.5561-.5765-2.2247-.0815-1.4142 1.22-2.78 2.4986-4.0949 3.8331ZM22.8153 12.5819c-.5965.5637-.6462 1.4898-.1111 2.1111l62.5849 62.5848c.6213.5351 1.5474.4854 2.1111-.1111 1.5438-1.6339 3.0132-3.3364 4.4027-5.1003.4636-.5881.4117-1.4415-.1361-1.9893L29.0519 7.4629c-.5478-.54785-1.4012-.59973-1.9893-.13607-1.7639 1.38947-3.4664 2.85887-5.1003 4.40267ZM36.3133 4.80309c-.5706.52171-.6595 1.40133-.2046 2.01637l57.0952 57.09524c.615.4549 1.4947.3659 2.0163-.2046 2.0356-2.2275 3.9352-4.5738 5.6862-7.0218.3617-.5057.3006-1.2018-.1508-1.6479L40.6863.57018c-.4462-.45136-1.1422-.51247-1.6479-.15077-2.4481 1.75093-4.7943 3.65063-7.0218 5.68615ZM58.8005.573891c-.5231.491927-.5904 1.313337-.1554 1.88139C67.9084 14.8771 74.9026 31.9731 75.484 50.8418c.0138.4515.2224.8752.5778 1.1532l3.3792 2.6431c.5734.4484 1.4052.3523 1.8536-.2211.1549-.198.2552-.4271.2921-.6695C80.8696 30.1372 72.3672 9.97482 58.8005.573891Z" />
      </svg>
    ),
    color: "border-purple-500/30",
    bgColor: "bg-purple-500/10",
  },
  {
    name: "GitHub Issues",
    description: "Native GitHub issue tracking",
    icon: (
      <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
    color: "border-gray-500/30",
    bgColor: "bg-gray-500/10",
  },
];

// SCM Providers
const scmProviders = [
  {
    name: "GitHub",
    description: "Pull requests & CI integration",
    icon: (
      <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
    color: "border-gray-500/30",
    bgColor: "bg-gray-500/10",
    selfHosted: "Enterprise",
  },
  {
    name: "GitLab",
    description: "Merge requests & pipelines",
    icon: <GitBranch className="w-6 h-6 text-orange-500" />,
    color: "border-orange-500/30",
    bgColor: "bg-orange-500/10",
    selfHosted: "Yes",
  },
  {
    name: "BitBucket",
    description: "Atlassian ecosystem integration",
    icon: (
      <svg className="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
        <path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
      </svg>
    ),
    color: "border-blue-600/30",
    bgColor: "bg-blue-600/10",
    selfHosted: "Yes",
  },
];

// AI Providers
const aiProviders = [
  { name: "Anthropic Claude", models: "Opus 4.6, Sonnet 4.6, Haiku 4.5", color: "text-orange-400" },
  { name: "OpenAI", models: "GPT-4o, o3-mini, o1", color: "text-green-400" },
  { name: "Google", models: "Gemini 2.0 Flash, Gemini Pro", color: "text-blue-400" },
  { name: "Ollama", models: "Self-hosted (Llama, Qwen, etc.)", color: "text-purple-400" },
];

export function Integrations() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Seamless Integrations
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            WorkerMill connects your issue trackers, code repositories, and AI providers
            for end-to-end automation.
          </p>
        </div>

        {/* Integration Flow */}
        <div className="flex flex-col lg:flex-row items-center justify-center gap-6 mb-12">
          {/* Issue Trackers */}
          <div className="w-full lg:w-72 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <ListTodo className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-foreground">Issue Trackers</h3>
            </div>
            <div className="space-y-3">
              {issueTrackers.map((tracker) => (
                <div key={tracker.name} className={`flex items-center gap-3 p-2 rounded-lg ${tracker.bgColor} border ${tracker.color}`}>
                  {tracker.icon}
                  <div>
                    <div className="text-sm font-medium text-foreground">{tracker.name}</div>
                    <div className="text-xs text-muted-foreground">{tracker.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-2">
            <ArrowRight className="w-6 h-6 text-primary hidden lg:block" />
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
              <Bot className="w-7 h-7 text-primary-foreground" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">WorkerMill</span>
            <ArrowRight className="w-6 h-6 text-primary hidden lg:block" />
          </div>

          {/* SCM Providers */}
          <div className="w-full lg:w-72 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <GitPullRequest className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-foreground">Code Repositories</h3>
            </div>
            <div className="space-y-3">
              {scmProviders.map((provider) => (
                <div key={provider.name} className={`flex items-center gap-3 p-2 rounded-lg ${provider.bgColor} border ${provider.color}`}>
                  {provider.icon}
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">{provider.name}</div>
                    <div className="text-xs text-muted-foreground">{provider.description}</div>
                  </div>
                  {provider.selfHosted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Self-hosted: {provider.selfHosted}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Providers */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-purple-500" />
            <h3 className="font-semibold text-foreground">AI Providers (BYOK)</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {aiProviders.map((provider) => (
              <div key={provider.name} className="bg-card border border-border rounded-lg p-3 text-center">
                <div className={`font-medium ${provider.color} mb-1 text-sm`}>{provider.name}</div>
                <div className="text-xs text-muted-foreground">{provider.models}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Code Quality Tools */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-lg">🔍</span>
            <h3 className="font-semibold text-foreground">Code Quality Tools (BYOT)</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-xl mx-auto">
            {[
              { name: "SonarQube", desc: "Quality & coverage" },
              { name: "Snyk", desc: "Security scanning" },
              { name: "CodeQL", desc: "Semantic analysis" },
            ].map((tool) => (
              <div key={tool.name} className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="font-medium text-foreground text-sm">{tool.name}</div>
                <div className="text-xs text-muted-foreground">{tool.desc}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Bring your own tools - connect existing instances for quality metrics in your pipeline
          </p>
        </div>

        {/* Coming Soon */}
        <div className="text-center mb-8">
          <p className="text-sm text-muted-foreground mb-3">Coming soon:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {["Asana", "ClickUp", "Azure DevOps", "Slack Notifications"].map((name) => (
              <span key={name} className="px-3 py-1 bg-muted/50 border border-border rounded-full text-xs text-muted-foreground">
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* Enterprise Callout */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Enterprise</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Enterprise customers get all integrations including self-hosted SCM (GitLab, BitBucket),
            AWS Bedrock, Azure AI Foundry, and custom integration development.
          </p>
          <a href="mailto:sales@workermill.com" className="text-sm text-primary hover:underline">
            Contact Sales →
          </a>
        </div>
      </div>
    </section>
  );
}
