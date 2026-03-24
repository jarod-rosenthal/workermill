import {
  FileText,
  Save,
  Users,
  Bot,
  ArrowDown,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Database,
  Lock,
  Cloud,
  Settings,
  Terminal,
  GitBranch,
  Play,
  Pause,
  Zap,
  Server,
  DollarSign,
  Tag,
  Clock,
  Shield,
  HardDrive,
  Activity,
  Layers,
  BookOpen,
  MessageSquare,
  Sparkles,
  AlertCircle,
  ThumbsUp,
  BarChart3,
  Bug,
  Search,
  Key,
  Plug,
  Brain,
  Target,
  Route,
  Cpu,
  Box,
  Gauge,
} from "lucide-react";
import { PROVIDER_MODELS, formatTokenPrice } from "../../lib/model-pricing";

// Task Planning stages
const teamPlanningStages = [
  {
    phase: "1",
    title: "Planning Phase",
    icon: FileText,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Planning Agent analyzes your ticket and creates an execution plan",
    details: [
      "Parse ticket summary, description, and acceptance criteria",
      "Analyze codebase structure and requirements",
      "Decompose into discrete, implementable stories",
      "Determine dependencies between stories",
    ],
    output: ".workermill/plan.json",
  },
  {
    phase: "2",
    title: "Dependency Resolution",
    icon: Layers,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description: "Determine execution order based on story dependencies",
    details: [
      "Build dependency graph between stories",
      "Identify stories that can run in parallel",
      "Queue stories respecting dependency order",
      "Track ready/blocked/running states",
    ],
    output: "Execution queue",
  },
  {
    phase: "3",
    title: "Parallel Execution",
    icon: Play,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "Execute stories in parallel (respecting dependencies)",
    details: [
      "Spawn worker for each ready story",
      "Coordinate via coordination system",
      "Stream progress to dashboard in real-time",
      "Mark dependencies as satisfied on completion",
    ],
    output: "Code changes + commits",
  },
  {
    phase: "4",
    title: "Result Aggregation",
    icon: CheckCircle,
    color: "text-accent",
    bgColor: "bg-accent/10",
    borderColor: "border-accent/30",
    description: "Aggregate story outcomes to WorkerMill task status",
    details: [
      "All stories complete → deployed",
      "Some stories complete → escalated",
      "No stories complete → failed",
      "Create PR with all changes",
    ],
    output: "Final task status",
  },
];

// Checkpoint lifecycle stages
const checkpointStages = [
  {
    stage: "initialized",
    icon: Play,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    description: "Checkpoint created, worker starting",
  },
  {
    stage: "cloning",
    icon: GitBranch,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description: "Repository clone in progress",
  },
  {
    stage: "analyzing",
    icon: BookOpen,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    description: "Analyzing codebase structure",
  },
  {
    stage: "implementing",
    icon: Terminal,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    description: "Making code changes",
  },
  {
    stage: "testing",
    icon: CheckCircle,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    description: "Running tests and type checks",
  },
  {
    stage: "completing",
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    description: "Finalizing changes and creating PR",
  },
];

// Coordination API endpoints
const coordinationEndpoints = [
  {
    method: "POST",
    endpoint: "/api/coordination/check-in",
    description: "Register worker presence when starting",
    color: "text-green-500",
  },
  {
    method: "POST",
    endpoint: "/api/coordination/heartbeat",
    description: "Update worker liveness (every 30s)",
    color: "text-green-500",
  },
  {
    method: "DELETE",
    endpoint: "/api/coordination/check-out",
    description: "Deregister worker and release locks",
    color: "text-red-500",
  },
  {
    method: "POST",
    endpoint: "/api/coordination/manifest/declare",
    description: "Declare intent to modify files",
    color: "text-green-500",
  },
  {
    method: "POST",
    endpoint: "/api/coordination/locks/acquire",
    description: "Acquire exclusive file locks",
    color: "text-green-500",
  },
  {
    method: "POST",
    endpoint: "/api/coordination/locks/release",
    description: "Release held file locks",
    color: "text-green-500",
  },
];

// AI Provider models - sourced from shared pricing config
const providerModels = Object.fromEntries(
  Object.entries(PROVIDER_MODELS).map(([key, provider]) => [
    key,
    {
      name: provider.name,
      icon: provider.icon,
      models: provider.models.map((m) => ({
        id: m.id,
        name: m.name,
        tier: m.tier,
        input: formatTokenPrice(m.inputPricePerMillion),
        output: formatTokenPrice(m.outputPricePerMillion),
        context: m.context,
      })),
    },
  ])
);

// Provider label reference
const providerLabels = [
  { label: "anthropic", provider: "Anthropic", effect: "Use Claude models (default)" },
  { label: "openai", provider: "OpenAI", effect: "Use GPT models" },
  { label: "gemini", provider: "Google", effect: "Use Gemini models" },
  { label: "google", provider: "Google", effect: "Use Gemini models (alias)" },
  { label: "ollama", provider: "Ollama", effect: "Use local models" },
  { label: "haiku", provider: "-", effect: "Use efficient model (optimized for speed)" },
  { label: "sonnet", provider: "-", effect: "Use balanced model (speed + capability)" },
  { label: "opus", provider: "-", effect: "Use flagship model (most capable)" },
  { label: "openrouter", provider: "OpenRouter", effect: "Use models via OpenRouter API" },
];

// Environment variables
const envVars = {
  core: [
    { name: "TASK_ID", required: true, description: "WorkerMill task UUID" },
    { name: "JIRA_ISSUE_KEY", required: true, description: "Jira ticket key (e.g., PROJ-123)" },
    { name: "GITHUB_REPO", required: true, description: "Target repository (owner/repo)" },
    { name: "WORKER_PERSONA", required: true, description: "Worker role (backend_developer, etc.)" },
    { name: "CLAUDE_MODEL", required: true, description: "Model identifier" },
  ],
  provider: [
    { name: "WORKER_PROVIDER", required: false, description: "Provider ID (anthropic, openai, etc.)" },
    { name: "ANTHROPIC_API_KEY", required: false, description: "Anthropic API key" },
    { name: "OPENAI_API_KEY", required: false, description: "OpenAI API key" },
    { name: "GOOGLE_API_KEY", required: false, description: "Google API key" },
    { name: "OLLAMA_HOST", required: false, description: "Ollama server URL" },
  ],
  features: [
    { name: "USE_PRD_ORCHESTRATION", required: false, description: "Enable Task Planning mode" },
    { name: "PRD_ORCHESTRATION_MAX_STORIES", required: false, description: "Maximum stories per plan (1-50)" },
    { name: "CHECKPOINT_ENABLED", required: false, description: "Enable state persistence" },
    { name: "CHECKPOINT_INTERVAL", required: false, description: "Sync interval in seconds (default: 60)" },
  ],
};

// Output markers
const outputMarkers = [
  { marker: "::result::", format: "::result::<status>", description: "Final task result (deployed/escalated/failed)" },
  { marker: "::pr_url::", format: "::pr_url::<url>", description: "GitHub PR URL" },
  { marker: "::pr_number::", format: "::pr_number::<number>", description: "PR number" },
  { marker: "::prd_progress::", format: "::prd_progress::<current>/<total>::<desc>", description: "Story progress update" },
  { marker: "::prd_status::", format: "::prd_status::<status>", description: "Overall planning status" },
];

export default function AdvancedFeatures() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Advanced Features</h1>
        <p className="text-muted-foreground">
          Comprehensive documentation for WorkerMill's advanced orchestration capabilities:
          Task Planning, Worker Checkpointing, Multi-Worker Coordination, and AI Provider Support.
        </p>
      </div>

      {/* Quick Navigation */}
      <nav className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">On This Page</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <a href="#team-planning" className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors">
            <FileText className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-foreground">Task Planning</span>
          </a>
          <a href="#checkpointing" className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 transition-colors">
            <Save className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-foreground">Checkpointing</span>
          </a>
          <a href="#coordination" className="flex items-center gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 transition-colors">
            <Users className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-foreground">Coordination</span>
          </a>
          <a href="#ai-providers" className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors">
            <Bot className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-foreground">AI Providers</span>
          </a>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <a href="#memory-system" className="flex items-center gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 transition-colors">
            <Brain className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-foreground">Memory System</span>
          </a>
          <a href="#codebase-intelligence" className="flex items-center gap-2 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/20 transition-colors">
            <Search className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-medium text-foreground">Codebase Intelligence</span>
          </a>
          <a href="#warm-pool" className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors">
            <Box className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium text-foreground">Warm Container Pool</span>
          </a>
          <a href="#code-quality" className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition-colors">
            <BarChart3 className="w-4 h-4 text-rose-500" />
            <span className="text-sm font-medium text-foreground">Code Quality</span>
          </a>
        </div>
      </nav>

      {/* ==================== TEAM PLANNING SECTION ==================== */}
      <section id="team-planning" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-green-500/10">
            <FileText className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Task Planning</h2>
            <p className="text-sm text-muted-foreground">Multi-task execution engine for complex work</p>
          </div>
        </div>

        {/* Task Planning Overview */}
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is Task Planning?</h3>
          <p className="text-muted-foreground mb-4">
            When a task is created, WorkerMill analyzes your ticket and creates an execution plan — transforming
            complex requirements into coordinated, parallel implementation workflows. It decomposes requirements into
            discrete sub-tasks with dependencies, then orchestrates their parallel execution with real-time progress tracking.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Use Cases</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />Large features spanning multiple files</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />Tasks requiring careful planning</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />Complex refactoring with interdependencies</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />Features with detailed acceptance criteria</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Benefits</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Parallel execution for faster completion</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Dependency-aware story coordination</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Real-time visibility per story</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Partial completion handling</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Task Planning Workflow Phases */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Workflow Phases</h3>
          <div className="space-y-0">
            {teamPlanningStages.map((stage, idx) => (
              <div key={stage.phase}>
                <div className={`bg-card border ${stage.borderColor} rounded-lg p-5`}>
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`p-3 rounded-lg ${stage.bgColor} flex-shrink-0`}>
                        <stage.icon className={`w-5 h-5 ${stage.color}`} />
                      </div>
                      <span className={`text-xs font-bold ${stage.color} mt-1`}>Phase {stage.phase}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-foreground mb-1">{stage.title}</h4>
                      <p className="text-sm text-muted-foreground mb-3">{stage.description}</p>
                      <div className="grid md:grid-cols-2 gap-4">
                        <ul className="space-y-1">
                          {stage.details.map((detail, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                              <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                              <span>{detail}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Output:</span>
                          <code className="px-2 py-1 bg-muted rounded text-foreground">{stage.output}</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {idx < teamPlanningStages.length - 1 && (
                  <div className="flex justify-center py-2">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Task Planning Configuration */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configuration
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2">Organization Settings</h4>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 text-muted-foreground">usePrdOrchestration</td>
                      <td className="py-2 text-foreground">Enable Task Planning</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">prdMaxStories</td>
                      <td className="py-2 text-foreground">Max stories per plan (1-50)</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">defaultExecutionMode</td>
                      <td className="py-2 text-foreground">Autonomous or Supervised</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2">Environment Variables</h4>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2"><code className="text-green-500">USE_PRD_ORCHESTRATION</code></td>
                      <td className="py-2 text-muted-foreground">true/false</td>
                    </tr>
                    <tr>
                      <td className="py-2"><code className="text-green-500">PRD_ORCHESTRATION_MAX_STORIES</code></td>
                      <td className="py-2 text-muted-foreground">Default: 10</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Task Planning Result Mapping */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground">Result Mapping</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Orchestration Status</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">WorkerMill Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="hover:bg-muted/30">
                  <td className="p-3 font-medium text-green-500">completed</td>
                  <td className="p-3 text-muted-foreground">N</td>
                  <td className="p-3 text-muted-foreground">N</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500 text-xs">deployed</span></td>
                </tr>
                <tr className="hover:bg-muted/30">
                  <td className="p-3 font-medium text-amber-500">partial</td>
                  <td className="p-3 text-muted-foreground">X</td>
                  <td className="p-3 text-muted-foreground">N (X &lt; N)</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-xs">escalated</span></td>
                </tr>
                <tr className="hover:bg-muted/30">
                  <td className="p-3 font-medium text-red-500">failed</td>
                  <td className="p-3 text-muted-foreground">0</td>
                  <td className="p-3 text-muted-foreground">N</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-red-500/10 text-red-500 text-xs">failed</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ==================== CHECKPOINTING SECTION ==================== */}
      <section id="checkpointing" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Save className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Worker Checkpointing</h2>
            <p className="text-sm text-muted-foreground">State persistence for resilient task execution</p>
          </div>
        </div>

        {/* Checkpointing Overview */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">Why Checkpointing?</h3>
          <p className="text-muted-foreground mb-4">
            Worker Checkpointing enables task resumption after unexpected interruptions by persisting execution state to S3.
            If a worker encounters any issue, it can resume from the last checkpoint rather than starting over.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Clock className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">60s</div>
              <div className="text-xs text-muted-foreground">Auto-save interval</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Shield className="w-6 h-6 text-amber-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Auto</div>
              <div className="text-xs text-muted-foreground">Graceful recovery</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Cloud className="w-6 h-6 text-purple-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">S3</div>
              <div className="text-xs text-muted-foreground">State storage</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <RefreshCw className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Resume</div>
              <div className="text-xs text-muted-foreground">Skip completed work</div>
            </div>
          </div>
        </div>

        {/* Checkpoint State Schema */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              State Schema
            </h3>
          </div>
          <div className="p-5">
            <pre className="text-sm text-muted-foreground bg-background rounded-lg p-4 overflow-x-auto border border-border">
{`{
  "taskId": "uuid",
  "version": 1,
  "stage": "implementing",

  "repoCloned": true,
  "branch": "ai/PROJ-123",
  "commits": ["abc123", "def456"],

  "filesAnalyzed": ["src/api.ts", "src/main.ts"],
  "filesModified": ["src/api.ts"],

  "testsRun": true,
  "testsPassed": true,

  "lastAction": "Tests passed, creating PR",
  "resumeCount": 0
}`}
            </pre>
          </div>
        </div>

        {/* Checkpoint Stages */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Execution Stages</h3>
          <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
            {checkpointStages.map((stage) => (
              <div key={stage.stage} className="p-4 rounded-lg border border-border bg-card text-center">
                <div className={`p-2 rounded-lg ${stage.bgColor} inline-flex mb-2`}>
                  <stage.icon className={`w-4 h-4 ${stage.color}`} />
                </div>
                <div className={`text-xs font-medium ${stage.color} mb-1`}>{stage.stage}</div>
                <div className="text-[10px] text-muted-foreground">{stage.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Automatic Recovery */}
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-green-500" />
            Automatic Recovery
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">When Recovery Triggers</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">•</span>
                  <span>Unexpected container termination</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">•</span>
                  <span>Network connectivity issues</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">•</span>
                  <span>Transient infrastructure failures</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Recovery Process</h4>
              <div className="bg-background rounded-lg p-4 border border-border text-sm">
                <code className="text-muted-foreground">
                  <span className="text-purple-500">IF</span> Unexpected Interruption:<br />
                  &nbsp;&nbsp;<span className="text-purple-500">IF</span> retryCount &lt; maxRetries:<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;Load checkpoint from S3<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;Resume from last stage<br />
                  &nbsp;&nbsp;<span className="text-purple-500">ELSE</span>:<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;Mark task for review
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* S3 Storage */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            S3 Storage Structure
          </h3>
          <div className="space-y-3">
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="text-sm">
                <span className="text-muted-foreground">Bucket: </span>
                <code className="text-foreground">workermill-&#123;env&#125;-worker-state-&#123;account_id&#125;</code>
              </div>
              <div className="text-sm mt-1">
                <span className="text-muted-foreground">Path: </span>
                <code className="text-foreground">s3://&#123;bucket&#125;/&#123;taskId&#125;/checkpoint.json</code>
              </div>
            </div>
            <div className="grid md:grid-cols-4 gap-3 text-sm">
              <div className="p-3 bg-background rounded-lg border border-border">
                <Shield className="w-4 h-4 text-green-500 mb-1" />
                <div className="font-medium text-foreground">Encryption</div>
                <div className="text-xs text-muted-foreground">AES256 server-side</div>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <RefreshCw className="w-4 h-4 text-blue-500 mb-1" />
                <div className="font-medium text-foreground">Versioning</div>
                <div className="text-xs text-muted-foreground">Enabled</div>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <Clock className="w-4 h-4 text-amber-500 mb-1" />
                <div className="font-medium text-foreground">Lifecycle</div>
                <div className="text-xs text-muted-foreground">7-day auto-delete</div>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <Lock className="w-4 h-4 text-red-500 mb-1" />
                <div className="font-medium text-foreground">Access</div>
                <div className="text-xs text-muted-foreground">Public blocked</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== COORDINATION SECTION ==================== */}
      <section id="coordination" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Users className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Multi-Worker Coordination</h2>
            <p className="text-sm text-muted-foreground">Prevent conflicts when multiple workers operate on the same repository</p>
          </div>
        </div>

        {/* Coordination Overview */}
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">Problem Solved</h3>
          <p className="text-muted-foreground mb-4">
            Multi-Worker Coordination enables parallel AI worker execution on the same repository without conflicts.
            It implements optimistic locking, heartbeat monitoring, and resource reservation to prevent concurrent edits.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="p-3 bg-background rounded-lg border border-border text-center">
              <Lock className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-foreground">File Locking</div>
              <div className="text-xs text-muted-foreground">Prevent same-file edits</div>
            </div>
            <div className="p-3 bg-background rounded-lg border border-border text-center">
              <Activity className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-foreground">Heartbeats</div>
              <div className="text-xs text-muted-foreground">30-second liveness</div>
            </div>
            <div className="p-3 bg-background rounded-lg border border-border text-center">
              <GitBranch className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-foreground">Branch Awareness</div>
              <div className="text-xs text-muted-foreground">Track active branches</div>
            </div>
            <div className="p-3 bg-background rounded-lg border border-border text-center">
              <Server className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-foreground">Resource Reserve</div>
              <div className="text-xs text-muted-foreground">DB, deploy slots</div>
            </div>
          </div>
        </div>

        {/* Coordination Flow Diagram */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Check-In / Heartbeat / Check-Out Flow</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4 border border-green-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Play className="w-4 h-4 text-green-500" />
                <h4 className="font-medium text-foreground">Check-In</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Worker registers when starting:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Task ID and Worker ID</li>
                <li>• Repository and branch</li>
                <li>• Persona and model</li>
                <li>• Returns active workers list</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-blue-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-blue-500" />
                <h4 className="font-medium text-foreground">Heartbeat</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Every 30 seconds:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Update status</li>
                <li>• Report current file</li>
                <li>• Refresh lock TTLs</li>
                <li>• 5+ min stale = cleanup</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-red-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Pause className="w-4 h-4 text-red-500" />
                <h4 className="font-medium text-foreground">Check-Out</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Worker deregisters on completion:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Release all file locks</li>
                <li>• Free resource reservations</li>
                <li>• Remove from active list</li>
                <li>• Update final status</li>
              </ul>
            </div>
          </div>
        </div>

        {/* API Endpoints */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              API Endpoints
            </h3>
          </div>
          <div className="divide-y divide-border">
            {coordinationEndpoints.map((endpoint) => (
              <div key={endpoint.endpoint} className="p-3 flex items-center gap-3 hover:bg-muted/30">
                <span className={`text-xs font-mono font-bold ${endpoint.color} w-16`}>{endpoint.method}</span>
                <code className="text-sm text-foreground flex-1">{endpoint.endpoint}</code>
                <span className="text-xs text-muted-foreground hidden md:block">{endpoint.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* File Locking */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-500" />
              File Locking
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Workers acquire exclusive locks before modifying files. Conflicts are returned with holder info.
            </p>
            <div className="bg-background rounded-lg p-3 border border-border">
              <div className="text-xs font-mono">
                <span className="text-green-500">POST</span> /locks/acquire<br />
                <span className="text-muted-foreground">filePaths:</span> ["src/api.ts"]<br />
                <span className="text-muted-foreground">ttlSeconds:</span> 300
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-500" />
              Manifest Declaration
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Declare all files you intend to modify upfront. Auto-acquires locks with 30-minute TTL.
            </p>
            <div className="bg-background rounded-lg p-3 border border-border">
              <div className="text-xs font-mono">
                <span className="text-green-500">POST</span> /manifest/declare<br />
                <span className="text-muted-foreground">filesToModify:</span> ["src/*.ts"]<br />
                <span className="text-muted-foreground">ttlSeconds:</span> 1800
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== AI PROVIDERS SECTION ==================== */}
      <section id="ai-providers" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Bot className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">AI Provider Support</h2>
            <p className="text-sm text-muted-foreground">Choose the AI provider and model that fits your needs</p>
          </div>
        </div>

        {/* Provider Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(providerModels).map(([key, provider]) => (
            <div key={key} className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{provider.icon}</span>
                <div>
                  <h3 className="font-semibold text-foreground">{provider.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{key}</span>
                </div>
              </div>
              <div className="space-y-2">
                {provider.models.slice(0, 3).map((model) => (
                  <div key={model.id} className="text-xs p-2 bg-background rounded border border-border">
                    <div className="font-medium text-foreground">{model.name}</div>
                    <div className="text-muted-foreground flex justify-between mt-1">
                      <span className={`px-1.5 py-0.5 rounded ${model.tier === "Powerful" ? "bg-purple-500/10 text-purple-500" : model.tier === "Balanced" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"}`}>
                        {model.tier}
                      </span>
                      <span>{model.input}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Full Model Catalog */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Model Catalog
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Provider</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Input</th>
                  <th className="p-3">Output</th>
                  <th className="p-3">Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(providerModels).flatMap(([, provider]) =>
                  provider.models.map((model) => (
                    <tr key={model.id} className="hover:bg-muted/30">
                      <td className="p-3">
                        <span className="text-lg mr-2">{provider.icon}</span>
                        <span className="text-muted-foreground text-xs">{provider.name}</span>
                      </td>
                      <td className="p-3 font-medium text-foreground">{model.name}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded ${model.tier === "Powerful" ? "bg-purple-500/10 text-purple-500" : model.tier === "Balanced" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-500"}`}>
                          {model.tier}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">{model.input}</td>
                      <td className="p-3 text-muted-foreground">{model.output}</td>
                      <td className="p-3 text-muted-foreground">{model.context}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Label Reference */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Jira Label Reference
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Label</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Effect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providerLabels.map((item) => (
                  <tr key={item.label} className="hover:bg-muted/30">
                    <td className="p-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{item.label}</span>
                    </td>
                    <td className="p-3 text-foreground">{item.provider}</td>
                    <td className="p-3 text-muted-foreground">{item.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Provider Selection Notes */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Provider Selection
          </h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>If no provider label is specified, the organization's <strong className="text-foreground">default provider</strong> is used (configurable in Settings).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>Model labels (<code className="px-1 bg-muted rounded">haiku</code>, <code className="px-1 bg-muted rounded">sonnet</code>, <code className="px-1 bg-muted rounded">opus</code>) only apply to Anthropic. Other providers use their default models.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>Each provider's usage is tracked separately in the analytics dashboard.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ==================== AI SUPPORT AGENT SECTION ==================== */}
      <section id="ai-support-agent" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <MessageSquare className="w-6 h-6 text-cyan-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">AI Support Agent</h2>
            <p className="text-sm text-muted-foreground">Automated intelligent responses to support tickets</p>
          </div>
        </div>

        {/* AI Support Agent Overview */}
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is the AI Support Agent?</h3>
          <p className="text-muted-foreground mb-4">
            The AI Support Agent automatically analyzes incoming support tickets and provides intelligent responses.
            When a customer submits a ticket, the agent evaluates the question, assesses its confidence level, and
            either responds automatically or escalates to human support based on configurable thresholds.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Key Features</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-cyan-500 mt-1 flex-shrink-0" />Automatic ticket analysis and response</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-cyan-500 mt-1 flex-shrink-0" />Confidence-based response or escalation</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-cyan-500 mt-1 flex-shrink-0" />Configurable category eligibility</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-cyan-500 mt-1 flex-shrink-0" />Human-in-the-loop approval option</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Benefits</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Faster response times for common questions</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Reduced support team workload</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />24/7 availability for instant responses</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Consistent, accurate answers</li>
              </ul>
            </div>
          </div>
        </div>

        {/* How It Works Flow */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">How It Works</h3>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="p-3 rounded-lg bg-cyan-500/10 inline-flex mb-3">
                <MessageSquare className="w-5 h-5 text-cyan-500" />
              </div>
              <h4 className="font-medium text-foreground text-sm mb-1">1. Ticket Received</h4>
              <p className="text-xs text-muted-foreground">Customer submits a support ticket via email or portal</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="p-3 rounded-lg bg-purple-500/10 inline-flex mb-3">
                <Sparkles className="w-5 h-5 text-purple-500" />
              </div>
              <h4 className="font-medium text-foreground text-sm mb-1">2. AI Analysis</h4>
              <p className="text-xs text-muted-foreground">AI analyzes the question and generates a response with confidence score</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="p-3 rounded-lg bg-amber-500/10 inline-flex mb-3">
                <AlertCircle className="w-5 h-5 text-amber-500" />
              </div>
              <h4 className="font-medium text-foreground text-sm mb-1">3. Confidence Check</h4>
              <p className="text-xs text-muted-foreground">Compare confidence score against threshold (default: 80%)</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="p-3 rounded-lg bg-green-500/10 inline-flex mb-3">
                <ThumbsUp className="w-5 h-5 text-green-500" />
              </div>
              <h4 className="font-medium text-foreground text-sm mb-1">4. Response/Escalate</h4>
              <p className="text-xs text-muted-foreground">Auto-respond if confident, or escalate to human support</p>
            </div>
          </div>
        </div>

        {/* Configuration */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configuration
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2">Settings</h4>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 text-muted-foreground">Confidence Threshold</td>
                      <td className="py-2 text-foreground">80% (adjustable)</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">Auto-Response</td>
                      <td className="py-2 text-foreground">Enable/Disable per category</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">Human Review</td>
                      <td className="py-2 text-foreground">Optional approval before sending</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2">Eligible Categories</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />General questions</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Documentation inquiries</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />How-to guides</li>
                  <li className="flex items-center gap-2"><AlertTriangle className="w-3 h-3 text-amber-500" />Billing (requires human review)</li>
                  <li className="flex items-center gap-2"><AlertTriangle className="w-3 h-3 text-amber-500" />Account changes (escalate only)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Availability Note */}
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-cyan-500 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Available on All Plans
          </h4>
          <p className="text-sm text-muted-foreground">
            The AI Support Agent is included in all WorkerMill plans at no additional cost. Configure it in
            <span className="text-foreground font-medium"> Settings → Support → AI Agent</span> to enable
            automated responses for your support tickets.
          </p>
        </div>
      </section>

      {/* ==================== CODE QUALITY SECTION ==================== */}
      <section id="code-quality" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-rose-500/10">
            <BarChart3 className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Code Quality & BYOT</h2>
            <p className="text-sm text-muted-foreground">Bring Your Own Tools - integrate external quality scanners</p>
          </div>
        </div>

        {/* Code Quality Overview */}
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is BYOT (Bring Your Own Tools)?</h3>
          <p className="text-muted-foreground mb-4">
            WorkerMill supports BYOK (Bring Your Own Keys) for AI providers, and extends this philosophy to
            code quality tools with BYOT. Connect your existing SonarQube, Snyk, or CodeQL instances to
            get quality metrics directly in your worker execution pipeline. Workers can gate PR creation
            on quality thresholds you define.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">How It Works</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-rose-500 mt-1 flex-shrink-0" />Configure tool credentials in Settings</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-rose-500 mt-1 flex-shrink-0" />Workers trigger scans after code changes</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-rose-500 mt-1 flex-shrink-0" />Quality metrics recorded per task</li>
                <li className="flex items-start gap-2"><CheckCircle className="w-3 h-3 text-rose-500 mt-1 flex-shrink-0" />Optional quality gates block failing PRs</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Benefits</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Use existing tool investments</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Consistent quality across human & AI code</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Track quality trends over time</li>
                <li className="flex items-start gap-2"><Zap className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />Enforce org-wide quality standards</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Supported Tools */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Supported External Tools</h3>
          <div className="grid md:grid-cols-3 gap-4">
            {/* SonarQube */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Search className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">SonarQube</h4>
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">Available</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Comprehensive code quality and security scanning with quality gates.
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Code smells & bugs</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Security hotspots</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Coverage tracking</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Quality gate status</li>
              </ul>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Setup:</span> Settings → Integrations → SonarQube
                </p>
              </div>
            </div>

            {/* Snyk */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Bug className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">Snyk</h4>
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">Available</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Advanced security scanning for dependencies, containers, and IaC.
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Dependency vulnerabilities</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />License compliance</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Container image scanning</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Fix recommendations</li>
              </ul>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Setup:</span> Settings → Integrations → Snyk
                </p>
              </div>
            </div>

            {/* CodeQL */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Shield className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">CodeQL</h4>
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">Available</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                GitHub Advanced Security semantic code analysis engine.
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Semantic vulnerability detection</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Custom query support</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Data flow analysis</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />SARIF report integration</li>
              </ul>
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Setup:</span> GitHub Advanced Security enabled
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quality Metrics */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Quality Metrics Tracked
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              WorkerMill captures and stores quality metrics for every task, enabling trend analysis
              and comparison between AI-generated and human-written code.
            </p>
            <div className="grid md:grid-cols-4 gap-4">
              <div className="bg-background rounded-lg p-4 border border-border text-center">
                <div className="text-2xl font-bold text-foreground mb-1">Coverage</div>
                <div className="text-xs text-muted-foreground">Test coverage %</div>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border text-center">
                <div className="text-2xl font-bold text-foreground mb-1">Issues</div>
                <div className="text-xs text-muted-foreground">Bugs, smells, vulns</div>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border text-center">
                <div className="text-2xl font-bold text-foreground mb-1">Debt</div>
                <div className="text-xs text-muted-foreground">Technical debt hours</div>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border text-center">
                <div className="text-2xl font-bold text-foreground mb-1">Rating</div>
                <div className="text-xs text-muted-foreground">A-E quality grade</div>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configuration
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2 flex items-center gap-2">
                  <Key className="w-4 h-4 text-rose-500" />
                  Credentials Setup
                </h4>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 text-muted-foreground">SonarQube</td>
                      <td className="py-2 text-foreground">Server URL + Token</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">Snyk</td>
                      <td className="py-2 text-foreground">API Token + Org ID</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">CodeQL</td>
                      <td className="py-2 text-foreground">GitHub token (auto)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="bg-background rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground text-sm mb-2 flex items-center gap-2">
                  <Plug className="w-4 h-4 text-rose-500" />
                  Quality Gates
                </h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Block PR if coverage drops</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Require 0 critical vulnerabilities</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Enforce maximum tech debt</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-green-500" />Custom pass/fail thresholds</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* BYOK/BYOT Note */}
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-rose-500 mb-2 flex items-center gap-2">
            <Key className="w-4 h-4" />
            BYOK + BYOT Philosophy
          </h4>
          <p className="text-sm text-muted-foreground">
            WorkerMill follows a <span className="text-foreground font-medium">Bring Your Own</span> philosophy.
            Use your own AI provider API keys (BYOK) and your own code quality tools (BYOT). You maintain
            full control over your tooling, costs, and data. Configure in
            <span className="text-foreground font-medium"> Settings → Integrations</span>.
          </p>
        </div>
      </section>

      {/* ==================== MEMORY SYSTEM SECTION ==================== */}
      <section id="memory-system" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <Brain className="w-6 h-6 text-violet-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Memory System</h2>
            <p className="text-sm text-muted-foreground">AI memory for learning and knowledge sharing between workers</p>
          </div>
        </div>

        {/* Memory System Overview */}
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is the Memory System?</h3>
          <p className="text-muted-foreground mb-4">
            WorkerMill includes an AI memory system that enables workers to learn from past tasks and share knowledge.
            This improves performance over time as workers build understanding of your codebase, patterns, and preferences.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-violet-500" />
                <h4 className="font-medium text-foreground">Semantic Memory</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Conceptual knowledge about your codebase, architecture patterns, and domain concepts.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-violet-500" />
                <h4 className="font-medium text-foreground">Episodic Memory</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Historical task execution records including successes, failures, and approaches taken.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-violet-500" />
                <h4 className="font-medium text-foreground">Procedural Memory</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Step-by-step workflows and procedures learned from successful task completions.
              </p>
            </div>
          </div>
        </div>

        {/* Memory Features */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-500" />
              Key Features
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Vector embeddings for semantic similarity search</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Knowledge sharing between workers on same codebase</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Automatic learning from successful task completions</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Memory management UI for review and curation</span>
              </li>
            </ul>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Settings className="w-4 h-4 text-violet-500" />
              Configuration
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Access memory settings in <span className="text-foreground font-medium">Settings → Memory</span>.
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>- Enable/disable memory collection</li>
              <li>- Set retention policies</li>
              <li>- Review and delete memories</li>
              <li>- Export memory for backup</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ==================== CODEBASE INTELLIGENCE SECTION ==================== */}
      <section id="codebase-intelligence" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <Search className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Codebase Intelligence (RAG)</h2>
            <p className="text-sm text-muted-foreground">Semantic code search and retrieval for context-aware development</p>
          </div>
        </div>

        {/* RAG Overview */}
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is Codebase Intelligence?</h3>
          <p className="text-muted-foreground mb-4">
            Codebase Intelligence uses Retrieval-Augmented Generation (RAG) to index your repository and provide
            semantic search capabilities. Workers can find relevant code snippets, understand patterns, and
            maintain consistency across your codebase.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Database className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Index</div>
              <div className="text-xs text-muted-foreground">Automatic codebase indexing</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Search className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Search</div>
              <div className="text-xs text-muted-foreground">Semantic code search</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Target className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Retrieve</div>
              <div className="text-xs text-muted-foreground">Relevant snippet retrieval</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Update</div>
              <div className="text-xs text-muted-foreground">Incremental re-indexing</div>
            </div>
          </div>
        </div>

        {/* RAG Features */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3">How It Works</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Indexing</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Parses and indexes all code files on first task</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Creates vector embeddings for semantic search</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Incrementally updates on subsequent tasks</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Retrieval</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Workers query for relevant code context</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Returns top-k most relevant code snippets</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Includes file path and context for each snippet</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== PROVIDER ROUTING SECTION ==================== */}
      <section id="provider-routing" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-teal-500/10">
            <Route className="w-6 h-6 text-teal-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Provider Routing</h2>
            <p className="text-sm text-muted-foreground">Route different personas to different AI providers</p>
          </div>
        </div>

        {/* Provider Routing Overview */}
        <div className="bg-teal-500/5 border border-teal-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">Per-Persona Provider Configuration</h3>
          <p className="text-muted-foreground mb-4">
            Provider Routing enables you to configure which AI provider handles each worker persona.
            This allows you to optimize for cost, capability, or specific model strengths.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Example Configuration</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frontend Developer</span>
                  <span className="text-foreground">OpenAI GPT-4o</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Backend Developer</span>
                  <span className="text-foreground">Anthropic Claude</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">QA Engineer</span>
                  <span className="text-foreground">Google Gemini</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DevOps Engineer</span>
                  <span className="text-foreground">Ollama (self-hosted)</span>
                </div>
              </div>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Benefits</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Optimize costs by using efficient models for simple tasks</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Use flagship models for complex security/architecture work</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Keep sensitive code on self-hosted models</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-teal-500" />
            Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure provider routing in <span className="text-foreground font-medium">Settings → AI Providers → Routing</span>.
            You can set a default provider and override for specific personas.
          </p>
        </div>
      </section>

      {/* ==================== WARM CONTAINER POOL SECTION ==================== */}
      <section id="warm-pool" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-orange-500/10">
            <Box className="w-6 h-6 text-orange-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Warm Container Pool</h2>
            <p className="text-sm text-muted-foreground">Pre-warmed containers for faster task execution</p>
          </div>
        </div>

        {/* Warm Pool Overview */}
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is the Warm Container Pool?</h3>
          <p className="text-muted-foreground mb-4">
            The Warm Container Pool maintains pre-warmed containers ready to execute tasks immediately.
            This eliminates cold start latency, reducing MTTA (Mean Time to Acknowledge) significantly.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Clock className="w-6 h-6 text-orange-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">{"<"}10s</div>
              <div className="text-xs text-muted-foreground">Task pickup time</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Cpu className="w-6 h-6 text-orange-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Pool</div>
              <div className="text-xs text-muted-foreground">Configurable size</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Activity className="w-6 h-6 text-orange-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Heartbeat</div>
              <div className="text-xs text-muted-foreground">Health monitoring</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Clock className="w-6 h-6 text-orange-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">Schedule</div>
              <div className="text-xs text-muted-foreground">Timezone-aware windows</div>
            </div>
          </div>
        </div>

        {/* Configuration */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-orange-500" />
            Configuration Options
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Pool Settings</h4>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="py-2 text-muted-foreground">warmPoolSize</td>
                    <td className="py-2 text-foreground">Number of warm containers (1-10)</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">warmPoolSchedule</td>
                    <td className="py-2 text-foreground">Active hours (e.g., 9am-6pm)</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">warmPoolTimezone</td>
                    <td className="py-2 text-foreground">Schedule timezone</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">How It Works</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Containers start and wait for tasks</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Heartbeats track container availability</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>Task assigned to first available container</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                  <span>New container spawned to maintain pool size</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== COMPLEXITY CLASSIFICATION SECTION ==================== */}
      <section id="complexity" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-pink-500/10">
            <Gauge className="w-6 h-6 text-pink-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Complexity Classification</h2>
            <p className="text-sm text-muted-foreground">Automatic task complexity analysis for optimal resource allocation</p>
          </div>
        </div>

        {/* Complexity Overview */}
        <div className="bg-pink-500/5 border border-pink-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">Automatic Complexity Analysis</h3>
          <p className="text-muted-foreground mb-4">
            WorkerMill automatically analyzes incoming tasks to classify their complexity.
            This enables intelligent model selection, resource allocation, and accurate time estimates.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="p-4 bg-background rounded-lg border border-green-500/30 text-center">
              <div className="text-lg font-bold text-green-500">Simple</div>
              <div className="text-xs text-muted-foreground">Config changes, typos, small fixes</div>
            </div>
            <div className="p-4 bg-background rounded-lg border border-blue-500/30 text-center">
              <div className="text-lg font-bold text-blue-500">Medium</div>
              <div className="text-xs text-muted-foreground">New components, API endpoints</div>
            </div>
            <div className="p-4 bg-background rounded-lg border border-amber-500/30 text-center">
              <div className="text-lg font-bold text-amber-500">Complex</div>
              <div className="text-xs text-muted-foreground">Multi-file features, refactoring</div>
            </div>
            <div className="p-4 bg-background rounded-lg border border-red-500/30 text-center">
              <div className="text-lg font-bold text-red-500">Large</div>
              <div className="text-xs text-muted-foreground">Large features, architecture changes</div>
            </div>
          </div>
        </div>

        {/* How It's Used */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3">How Complexity Affects Execution</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Model Selection</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Simple tasks use efficient models</li>
                <li>- Complex tasks use flagship models</li>
                <li>- Large tasks trigger planning with multiple stories</li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Resource Allocation</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Higher complexity = more container resources</li>
                <li>- Longer timeout windows for complex tasks</li>
                <li>- More retries allowed for challenging work</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== APPENDIX SECTION ==================== */}
      <section id="appendix" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-muted">
            <BookOpen className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Appendix</h2>
            <p className="text-sm text-muted-foreground">Reference documentation for environment variables and output markers</p>
          </div>
        </div>

        {/* Environment Variables */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Environment Variables Reference
            </h3>
          </div>
          <div className="p-5 space-y-6">
            {/* Core Variables */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Core Variables</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="p-2">Variable</th>
                      <th className="p-2">Required</th>
                      <th className="p-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {envVars.core.map((v) => (
                      <tr key={v.name} className="hover:bg-muted/30">
                        <td className="p-2"><code className="text-green-500">{v.name}</code></td>
                        <td className="p-2">{v.required ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="p-2 text-muted-foreground">{v.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Provider Variables */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Provider Variables</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="p-2">Variable</th>
                      <th className="p-2">Required</th>
                      <th className="p-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {envVars.provider.map((v) => (
                      <tr key={v.name} className="hover:bg-muted/30">
                        <td className="p-2"><code className="text-amber-500">{v.name}</code></td>
                        <td className="p-2">{v.required ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="p-2 text-muted-foreground">{v.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Feature Variables */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Feature Variables</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="p-2">Variable</th>
                      <th className="p-2">Required</th>
                      <th className="p-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {envVars.features.map((v) => (
                      <tr key={v.name} className="hover:bg-muted/30">
                        <td className="p-2"><code className="text-purple-500">{v.name}</code></td>
                        <td className="p-2">{v.required ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-muted-foreground">-</span>}</td>
                        <td className="p-2 text-muted-foreground">{v.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Output Markers */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Output Markers Reference
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-3">Marker</th>
                  <th className="p-3">Format</th>
                  <th className="p-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {outputMarkers.map((m) => (
                  <tr key={m.marker} className="hover:bg-muted/30">
                    <td className="p-3"><code className="text-primary">{m.marker}</code></td>
                    <td className="p-3"><code className="text-muted-foreground text-xs">{m.format}</code></td>
                    <td className="p-3 text-muted-foreground">{m.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
