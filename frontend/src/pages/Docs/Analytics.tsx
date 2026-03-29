import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  Code,
  Shield,
  FileText,
  Users,
  Cpu,
  Activity,
} from "lucide-react";

const metricCategories = [
  {
    title: "Effectiveness Metrics",
    icon: TrendingUp,
    color: "green",
    metrics: [
      { name: "Success Rate", description: "Percentage of tasks completed successfully" },
      { name: "Deployment Rate", description: "Tasks that were deployed to production" },
      { name: "First Attempt Rate", description: "Tasks completed without retries" },
      { name: "PR Acceptance Rate", description: "Pull requests accepted by reviewers" },
      { name: "Escalation Rate", description: "Tasks escalated to human intervention" },
    ],
  },
  {
    title: "Code Quality",
    icon: Code,
    color: "blue",
    metrics: [
      { name: "Quality Score", description: "Overall code quality rating (0-100)" },
      { name: "Lint Score", description: "Code style and formatting compliance" },
      { name: "Typecheck Score", description: "TypeScript type safety" },
      { name: "Test Score", description: "Test pass rate" },
      { name: "Coverage Score", description: "Code coverage percentage" },
      { name: "Security Score", description: "Security vulnerability assessment" },
    ],
  },
  {
    title: "Token & Cost",
    icon: DollarSign,
    color: "yellow",
    metrics: [
      { name: "Total Tokens", description: "Input + output tokens consumed" },
      { name: "Cache Efficiency", description: "Percentage of tokens served from cache" },
      { name: "Cost per Task", description: "Average AI cost per completed task" },
      { name: "Cost by Phase", description: "Token spend by execution phase" },
      { name: "Cost by Persona", description: "Token spend by worker persona" },
      { name: "Cost by Model", description: "Token spend by AI model" },
    ],
  },
  {
    title: "Planning Metrics",
    icon: FileText,
    color: "purple",
    metrics: [
      { name: "Plan Accuracy", description: "Planned vs actual stories executed" },
      { name: "Cost Variance", description: "Planned vs actual cost difference" },
      { name: "Time to Completion", description: "Duration by complexity level" },
      { name: "Story Decomposition", description: "How well tasks are broken down" },
    ],
  },
  {
    title: "Failure Analysis",
    icon: AlertTriangle,
    color: "red",
    metrics: [
      { name: "Failure Rate", description: "Percentage of tasks that failed" },
      { name: "Failure Categories", description: "Breakdown by failure type" },
      { name: "Retry Success", description: "Tasks recovered after retry" },
      { name: "Weekly Trend", description: "Failure trend over time" },
    ],
  },
  {
    title: "Review Metrics",
    icon: Users,
    color: "orange",
    metrics: [
      { name: "First-Pass Approval", description: "PRs approved without revisions" },
      { name: "Revision Distribution", description: "Number of revisions per task" },
      { name: "Review Adoption", description: "Tasks using Tech Lead Reviewer" },
      { name: "Quality Impact", description: "Review effect on outcomes" },
    ],
  },
];

const qualityScoreRanges = [
  { range: "90-100", label: "Excellent", color: "green", description: "Production-ready code" },
  { range: "70-89", label: "Good", color: "blue", description: "Minor improvements needed" },
  { range: "50-69", label: "Fair", color: "yellow", description: "Requires attention" },
  { range: "0-49", label: "Poor", color: "red", description: "Significant issues" },
];

export default function Analytics() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Analytics</h1>
        <p className="text-muted-foreground">
          Comprehensive metrics for tracking worker performance, code quality, costs, and effectiveness.
          Access analytics at <code className="bg-muted px-1.5 py-0.5 rounded">/analytics</code>.
        </p>
      </div>

      {/* Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          Overview
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            The Analytics dashboard provides real-time insights into your AI workers' performance.
            All metrics are calculated over configurable time periods (7, 30, 90 days).
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="font-medium text-foreground">Real-time Updates</span>
              </div>
              <p className="text-sm text-muted-foreground">Metrics refresh automatically as tasks complete</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="font-medium text-foreground">Breakdown by Persona</span>
              </div>
              <p className="text-sm text-muted-foreground">See performance by worker role</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-primary" />
                <span className="font-medium text-foreground">Breakdown by Model</span>
              </div>
              <p className="text-sm text-muted-foreground">Compare AI model effectiveness</p>
            </div>
          </div>
        </div>
      </section>

      {/* Metric Categories */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Available Metrics</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {metricCategories.map((category) => (
            <div key={category.title} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg bg-${category.color}-500/10`}>
                  <category.icon className={`w-5 h-5 text-${category.color}-500`} />
                </div>
                <h3 className="font-semibold text-foreground">{category.title}</h3>
              </div>
              <ul className="space-y-2">
                {category.metrics.map((metric) => (
                  <li key={metric.name} className="text-sm">
                    <span className="font-medium text-foreground">{metric.name}</span>
                    <span className="text-muted-foreground"> - {metric.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Code Quality Scoring */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-500" />
          Code Quality Scoring
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Every completed task receives a quality score based on multiple factors:
          </p>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className="font-medium text-foreground mb-3">Score Components</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span><strong>Lint Score</strong> - ESLint/Prettier compliance</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-500" />
                  <span><strong>Typecheck Score</strong> - TypeScript errors</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-purple-500" />
                  <span><strong>Test Score</strong> - Test pass rate</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-3">Score Ranges</h4>
              <div className="space-y-2">
                {qualityScoreRanges.map((range) => (
                  <div key={range.range} className="flex items-center gap-3 text-sm">
                    <span className={`w-20 px-2 py-0.5 rounded text-center text-xs font-medium bg-${range.color}-500/10 text-${range.color}-500`}>
                      {range.range}
                    </span>
                    <span className="font-medium text-foreground w-20">{range.label}</span>
                    <span className="text-muted-foreground">{range.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-sm text-blue-500">
              <strong>Tip:</strong> Use the "Low Quality Tasks" table to identify tasks that need attention.
              Click through to review the specific issues and improve future task definitions.
            </p>
          </div>
        </div>
      </section>

      {/* Token Usage */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          Token & Cost Tracking
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Detailed breakdown of AI token consumption and costs:
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-foreground mb-3">Token Types</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><strong className="text-foreground">Input Tokens</strong> - Prompts sent to the model</li>
                <li><strong className="text-foreground">Output Tokens</strong> - Model responses</li>
                <li><strong className="text-foreground">Cache Creation</strong> - Tokens cached for reuse</li>
                <li><strong className="text-foreground">Cache Read</strong> - Tokens served from cache (cheaper)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-3">Cost Breakdown By</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><strong className="text-foreground">Phase</strong> - Planning, execution, review, etc.</li>
                <li><strong className="text-foreground">Persona</strong> - Backend, frontend, DevOps workers</li>
                <li><strong className="text-foreground">Model</strong> - Claude, GPT-5.4, Gemini, etc.</li>
                <li><strong className="text-foreground">Operation Type</strong> - Code generation, analysis, etc.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Effectiveness */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-500" />
          Worker Effectiveness
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-green-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-500">Success Rate</div>
              <p className="text-xs text-muted-foreground mt-1">Tasks completed without failure</p>
            </div>
            <div className="p-4 bg-blue-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-500">Deployment Rate</div>
              <p className="text-xs text-muted-foreground mt-1">Tasks that reached production</p>
            </div>
            <div className="p-4 bg-purple-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-purple-500">First Attempt</div>
              <p className="text-xs text-muted-foreground mt-1">Completed without retries</p>
            </div>
            <div className="p-4 bg-yellow-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-500">PR Acceptance</div>
              <p className="text-xs text-muted-foreground mt-1">PRs approved by reviewers</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Track trends over time to identify improvements or regressions in worker performance.
            Compare effectiveness across different AI models and personas to optimize your configuration.
          </p>
        </div>
      </section>

      {/* Failure Analysis */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-500" />
          Failure Analysis
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            When tasks fail, Analytics categorizes the failure to help identify patterns:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Failure Categories</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Build/Compilation errors</li>
                <li>- Test failures</li>
                <li>- Lint/Type errors</li>
                <li>- Timeout (task took too long)</li>
                <li>- API rate limits</li>
                <li>- Infrastructure issues</li>
                <li>- Unclear requirements (escalated)</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Analysis Views</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- By Persona (which workers fail most)</li>
                <li>- By Model (which models are less reliable)</li>
                <li>- Weekly Trend (is failure rate improving)</li>
                <li>- Example failures (learn from specific cases)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Usage & Billing */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Usage & Billing
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Track your plan usage and billing information:
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Plan Limits</strong> - Concurrent workers, expert personas, and log retention for your plan</li>
            <li><strong className="text-foreground">Current Usage</strong> - Active workers and tasks in progress</li>
            <li><strong className="text-foreground">Days Until Reset</strong> - When your billing period refreshes</li>
            <li><strong className="text-foreground">Daily Usage Chart</strong> - Tasks and costs per day</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
