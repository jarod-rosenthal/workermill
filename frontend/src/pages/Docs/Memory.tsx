import {
  Brain,
  Database,
  History,
  Lightbulb,
  Search,
  Sparkles,
  CheckCircle,
  TrendingUp,
  RefreshCw,
  Zap,
} from "lucide-react";

const memoryTypes = [
  {
    type: "Semantic",
    icon: Lightbulb,
    color: "purple",
    description: "Conceptual knowledge about code patterns, best practices, and domain expertise",
    examples: [
      "React component patterns for this codebase",
      "API authentication flow used in the project",
      "Database schema relationships",
      "Team coding conventions and preferences",
    ],
    fields: [
      { name: "Category", description: "Type of knowledge (pattern, convention, architecture)" },
      { name: "Subject", description: "What the knowledge is about" },
      { name: "Knowledge", description: "The actual learned information" },
      { name: "Confidence", description: "How certain the system is (0-100%)" },
      { name: "Repository", description: "Which codebase this applies to" },
    ],
  },
  {
    type: "Episodic",
    icon: History,
    color: "blue",
    description: "Historical records of task executions, decisions made, and their outcomes",
    examples: [
      "Task PROJ-123 completed successfully with 2 retries",
      "PR #456 was rejected due to missing tests",
      "Deployment to staging failed - rollback executed",
      "Code review requested changes to error handling",
    ],
    fields: [
      { name: "Event Type", description: "task_completed, pr_merged, error_occurred, etc." },
      { name: "Summary", description: "Brief description of what happened" },
      { name: "Outcome", description: "success, failure, partial, escalated" },
      { name: "Details", description: "Additional context and metadata" },
    ],
  },
  {
    type: "Procedural",
    icon: Database,
    color: "green",
    description: "Step-by-step workflows and procedures learned from successful task completions",
    examples: [
      "How to add a new API endpoint in this codebase",
      "Steps to deploy to production environment",
      "Process for database migration",
      "Workflow for creating React components",
    ],
    fields: [
      { name: "Name", description: "Procedure identifier" },
      { name: "Steps", description: "Ordered list of actions" },
      { name: "Persona", description: "Which worker role uses this" },
      { name: "Usage Count", description: "Times this procedure was applied" },
      { name: "Success Rate", description: "How often it leads to success" },
      { name: "Verified", description: "Manually reviewed and approved" },
    ],
  },
];

export default function Memory() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Memory System</h1>
        <p className="text-muted-foreground">
          WorkerMill's AI memory system enables workers to learn from past experiences and apply
          knowledge to future tasks. Access at <code className="bg-muted px-1.5 py-0.5 rounded">/memory</code>.
        </p>
      </div>

      {/* Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          How Memory Works
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            The memory system uses vector embeddings to store and retrieve relevant information.
            When a worker starts a task, it queries the memory system for relevant knowledge,
            past experiences, and proven procedures.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-purple-500" />
                <span className="font-medium text-foreground">Semantic</span>
              </div>
              <p className="text-sm text-muted-foreground">"What do I know about this?"</p>
            </div>
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-foreground">Episodic</span>
              </div>
              <p className="text-sm text-muted-foreground">"What happened before?"</p>
            </div>
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-green-500" />
                <span className="font-medium text-foreground">Procedural</span>
              </div>
              <p className="text-sm text-muted-foreground">"How do I do this?"</p>
            </div>
          </div>
        </div>
      </section>

      {/* Memory Types Detail */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Memory Types</h2>
        <div className="space-y-6">
          {memoryTypes.map((memory) => (
            <div key={memory.type} className={`bg-card border border-${memory.color}-500/30 rounded-xl p-6`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-3 rounded-lg bg-${memory.color}-500/10`}>
                  <memory.icon className={`w-6 h-6 text-${memory.color}-500`} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{memory.type} Memory</h3>
                  <p className="text-sm text-muted-foreground">{memory.description}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-foreground mb-2">Examples</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {memory.examples.map((example, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground">•</span>
                        {example}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-2">Stored Fields</h4>
                  <ul className="space-y-1 text-sm">
                    {memory.fields.map((field) => (
                      <li key={field.name}>
                        <span className="font-medium text-foreground">{field.name}</span>
                        <span className="text-muted-foreground"> - {field.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Memory Retrieval */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          Memory Retrieval
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            When workers execute tasks, they automatically query relevant memories:
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">1</div>
              <div>
                <h4 className="font-medium text-foreground">Task Analysis</h4>
                <p className="text-sm text-muted-foreground">Worker analyzes the task requirements and extracts key concepts</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">2</div>
              <div>
                <h4 className="font-medium text-foreground">Semantic Search</h4>
                <p className="text-sm text-muted-foreground">Vector similarity search finds relevant memories (top-k results)</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">3</div>
              <div>
                <h4 className="font-medium text-foreground">Context Injection</h4>
                <p className="text-sm text-muted-foreground">Retrieved memories are added to the worker's context window</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">4</div>
              <div>
                <h4 className="font-medium text-foreground">Execution with Knowledge</h4>
                <p className="text-sm text-muted-foreground">Worker uses retrieved knowledge to inform decisions</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Memory Learning */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-yellow-500" />
          How Workers Learn
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            New memories are created automatically during task execution:
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-foreground mb-3">Automatic Learning</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Code patterns discovered during implementation</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Successful procedures from completed tasks</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Errors and how they were resolved</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Review feedback and corrections</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-3">Confidence Scoring</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><strong className="text-foreground">High (80-100%)</strong> - Verified multiple times</li>
                <li><strong className="text-foreground">Medium (50-79%)</strong> - Used successfully once or twice</li>
                <li><strong className="text-foreground">Low (0-49%)</strong> - New or uncertain knowledge</li>
              </ul>
              <p className="text-xs text-muted-foreground mt-3">
                Confidence increases when knowledge leads to successful outcomes
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Management Features */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-primary" />
          Memory Management
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            The Memory Management page allows you to view, search, edit, and delete memories:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium text-foreground mb-2">Search & Filter</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Full-text search across all memories</li>
                <li>- Filter by memory type</li>
                <li>- Filter by repository</li>
                <li>- Filter by confidence level</li>
              </ul>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium text-foreground mb-2">Edit & Delete</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Edit memory content directly</li>
                <li>- Adjust confidence scores</li>
                <li>- Delete outdated memories</li>
                <li>- Verify procedural memories</li>
              </ul>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium text-foreground mb-2">Analytics</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Total memories by type</li>
                <li>- Memory creation trends</li>
                <li>- Usage and retrieval stats</li>
                <li>- Average confidence over time</li>
              </ul>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium text-foreground mb-2">Best Practices</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Review low-confidence memories</li>
                <li>- Verify important procedures</li>
                <li>- Remove stale or incorrect data</li>
                <li>- Monitor learning trends</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Performance Impact */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-500" />
          Performance Impact
        </h2>
        <div className="bg-card border border-green-500/30 rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Workers with relevant memories typically show:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-500/10 rounded-lg">
              <Zap className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-green-500">Faster Execution</div>
              <p className="text-xs text-muted-foreground">Less exploration, more direct action</p>
            </div>
            <div className="text-center p-4 bg-green-500/10 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-green-500">Higher Success</div>
              <p className="text-xs text-muted-foreground">Learn from past mistakes</p>
            </div>
            <div className="text-center p-4 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-lg font-bold text-green-500">Better Quality</div>
              <p className="text-xs text-muted-foreground">Apply proven patterns</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
