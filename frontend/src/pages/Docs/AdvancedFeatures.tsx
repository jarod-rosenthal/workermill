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
} from "lucide-react";

// PRD Orchestration stages
const prdOrchestrationStages = [
  {
    phase: "1",
    title: "Planning Phase",
    icon: FileText,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Virtual PM analyzes ticket and decomposes into stories",
    details: [
      "Parse ticket summary, description, and acceptance criteria",
      "Extract requirements and acceptance criteria",
      "Decompose into discrete, implementable stories",
      "Establish dependency graph between stories",
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
      "Build directed acyclic graph (DAG) of dependencies",
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
      "Coordinate via file locking system",
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
    output: "::result:: marker",
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
    stage: "interrupted",
    icon: AlertTriangle,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    description: "Spot reclaim detected, saving state",
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

// AI Provider models
const providerModels = {
  anthropic: {
    name: "Anthropic",
    icon: "🤖",
    models: [
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", tier: "Powerful", input: "$5.00/M", output: "$25.00/M", context: "200K" },
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", tier: "Balanced", input: "$3.00/M", output: "$15.00/M", context: "200K" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "Fast", input: "$0.80/M", output: "$4.00/M", context: "200K" },
    ],
  },
  openai: {
    name: "OpenAI",
    icon: "🔷",
    models: [
      { id: "gpt-4o", name: "GPT-4o", tier: "Powerful", input: "$2.50/M", output: "$10.00/M", context: "128K" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", tier: "Fast", input: "$0.15/M", output: "$0.60/M", context: "128K" },
      { id: "o1", name: "o1 (Reasoning)", tier: "Powerful", input: "$15.00/M", output: "$60.00/M", context: "200K" },
      { id: "o1-mini", name: "o1 Mini", tier: "Balanced", input: "$3.00/M", output: "$12.00/M", context: "128K" },
    ],
  },
  google: {
    name: "Google",
    icon: "🔵",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "Balanced", input: "$0.075/M", output: "$0.30/M", context: "1M" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", tier: "Powerful", input: "$1.25/M", output: "$5.00/M", context: "2M" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", tier: "Fast", input: "$0.075/M", output: "$0.30/M", context: "1M" },
    ],
  },
  ollama: {
    name: "Ollama (Local)",
    icon: "🏠",
    models: [
      { id: "llama3.1:8b", name: "Llama 3.1 8B", tier: "Fast", input: "Free", output: "Free", context: "128K" },
      { id: "llama3.1:70b", name: "Llama 3.1 70B", tier: "Balanced", input: "Free", output: "Free", context: "128K" },
      { id: "codellama:34b", name: "Code Llama 34B", tier: "Balanced", input: "Free", output: "Free", context: "16K" },
    ],
  },
};

// Provider label reference
const providerLabels = [
  { label: "anthropic", provider: "Anthropic", effect: "Use Claude models (default)" },
  { label: "openai", provider: "OpenAI", effect: "Use GPT models" },
  { label: "gemini", provider: "Google", effect: "Use Gemini models" },
  { label: "google", provider: "Google", effect: "Use Gemini models (alias)" },
  { label: "ollama", provider: "Ollama", effect: "Use local models" },
  { label: "haiku", provider: "-", effect: "Use fastest/cheapest Claude" },
  { label: "sonnet", provider: "-", effect: "Use balanced Claude" },
  { label: "opus", provider: "-", effect: "Use most capable Claude" },
];

// Environment variables
const envVars = {
  core: [
    { name: "TASK_ID", required: true, description: "WorkerMill task UUID" },
    { name: "JIRA_ISSUE_KEY", required: true, description: "Jira ticket key (e.g., OCS-123)" },
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
    { name: "USE_PRD_ORCHESTRATION", required: false, description: "Enable PRD Orchestration mode" },
    { name: "PRD_ORCHESTRATION_MAX_STORIES", required: false, description: "Maximum stories per PRD (1-50)" },
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
  { marker: "::prd_status::", format: "::prd_status::<status>", description: "Overall PRD Orchestration status" },
];

export default function AdvancedFeatures() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Advanced Features</h1>
        <p className="text-muted-foreground">
          Comprehensive documentation for WorkerMill's advanced orchestration capabilities:
          PRD Orchestration, Worker Checkpointing, Multi-Worker Coordination, and Multi-Provider AI Support.
        </p>
      </div>

      {/* Quick Navigation */}
      <nav className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">On This Page</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <a href="#prd-orchestration" className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors">
            <FileText className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-foreground">PRD Orchestration</span>
          </a>
          <a href="#checkpointing" className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 transition-colors">
            <Save className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-foreground">Checkpointing</span>
          </a>
          <a href="#coordination" className="flex items-center gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 transition-colors">
            <Users className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-foreground">Coordination</span>
          </a>
          <a href="#multi-provider" className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors">
            <Bot className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-foreground">Multi-Provider AI</span>
          </a>
        </div>
      </nav>

      {/* ==================== PRD ORCHESTRATION SECTION ==================== */}
      <section id="prd-orchestration" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-green-500/10">
            <FileText className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">PRD Orchestration</h2>
            <p className="text-sm text-muted-foreground">Multi-story execution engine for complex tasks</p>
          </div>
        </div>

        {/* PRD Orchestration Overview */}
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">What is PRD Orchestration?</h3>
          <p className="text-muted-foreground mb-4">
            PRD Orchestration transforms complex Jira tickets into coordinated, parallel implementation workflows.
            A virtual PM decomposes requirements into discrete "stories" with dependencies, then orchestrates their
            parallel execution with real-time progress tracking across multiple workers.
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

        {/* PRD Orchestration Workflow Phases */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Workflow Phases</h3>
          <div className="space-y-0">
            {prdOrchestrationStages.map((stage, idx) => (
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
                {idx < prdOrchestrationStages.length - 1 && (
                  <div className="flex justify-center py-2">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* PRD Orchestration Configuration */}
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
                      <td className="py-2 text-foreground">Enable PRD Orchestration</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-muted-foreground">prdMaxStories</td>
                      <td className="py-2 text-foreground">Max stories per PRD (1-50)</td>
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

        {/* PRD Orchestration Result Mapping */}
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
            Worker Checkpointing enables task resumption after interruptions by persisting execution state to S3.
            This is critical for AWS Fargate Spot instances, which can be reclaimed with 2-minute notice.
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <Clock className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">60s</div>
              <div className="text-xs text-muted-foreground">Auto-save interval</div>
            </div>
            <div className="text-center p-4 bg-background rounded-lg border border-border">
              <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-foreground">SIGTERM</div>
              <div className="text-xs text-muted-foreground">Graceful shutdown</div>
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
  "branch": "ai/OCS-123",
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
              <div key={stage.stage} className={`p-4 rounded-lg border ${stage.stage === "interrupted" ? "border-amber-500/30" : "border-border"} bg-card text-center`}>
                <div className={`p-2 rounded-lg ${stage.bgColor} inline-flex mb-2`}>
                  <stage.icon className={`w-4 h-4 ${stage.color}`} />
                </div>
                <div className={`text-xs font-medium ${stage.color} mb-1`}>{stage.stage}</div>
                <div className="text-[10px] text-muted-foreground">{stage.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Spot Interruption Handling */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Spot Interruption Handling
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Detection Methods</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold">1.</span>
                  <span><strong className="text-foreground">ECS Native:</strong> stopCode="SpotInterruption"</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold">2.</span>
                  <span><strong className="text-foreground">Exit Code:</strong> Exit 137 with FARGATE_SPOT</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold">3.</span>
                  <span><strong className="text-foreground">Checkpoint:</strong> stage="interrupted"</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Re-queue Logic</h4>
              <div className="bg-background rounded-lg p-4 border border-border text-sm">
                <code className="text-muted-foreground">
                  <span className="text-purple-500">IF</span> Spot Interruption:<br />
                  &nbsp;&nbsp;<span className="text-purple-500">IF</span> retryCount &lt; maxRetries:<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;status = <span className="text-green-500">"queued"</span><br />
                  &nbsp;&nbsp;&nbsp;&nbsp;retryCount += 1<br />
                  &nbsp;&nbsp;<span className="text-purple-500">ELSE</span>:<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;status = <span className="text-red-500">"failed"</span>
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

      {/* ==================== MULTI-PROVIDER SECTION ==================== */}
      <section id="multi-provider" className="space-y-6 scroll-mt-8">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Bot className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Multi-Provider AI Support</h2>
            <p className="text-sm text-muted-foreground">Use different AI providers based on task requirements</p>
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
              Model Catalog & Pricing
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
                {Object.entries(providerModels).flatMap(([_key, provider]) =>
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
              <span>Each provider's cost is tracked separately with provider-specific pricing.</span>
            </li>
          </ul>
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
