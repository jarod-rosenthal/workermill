import {
  Layers,
  Plus,
  Play,
  GitBranch,
  CheckCircle2,
  Clock,
  Settings,
  FileText,
  User,
  Zap,
  ArrowRight,
  List,
} from "lucide-react";

const epicStatuses = [
  { status: "draft", label: "Draft", color: "gray", description: "Story being defined, not ready for execution" },
  { status: "ready", label: "Ready", color: "blue", description: "Story is fully defined and ready to run" },
  { status: "queued", label: "Queued", color: "yellow", description: "Story queued for worker execution" },
  { status: "executing", label: "Executing", color: "blue", description: "Worker actively working on story" },
  { status: "review", label: "Review", color: "purple", description: "PR created, waiting for review" },
  { status: "completed", label: "Completed", color: "green", description: "Story done, PR merged" },
  { status: "failed", label: "Failed", color: "red", description: "Execution failed, needs attention" },
];

const storyFields = [
  { name: "Title", description: "Brief description of the story", required: true },
  { name: "User Story", description: "As a [role], I want [feature], so that [benefit]", required: false },
  { name: "Acceptance Criteria", description: "Gherkin format: Given/When/Then conditions", required: false },
  { name: "Definition of Done", description: "Checklist items that must be completed", required: false },
  { name: "Technical Notes", description: "Implementation hints for the worker", required: false },
  { name: "Persona", description: "Which worker type should handle this (backend, frontend, etc.)", required: false },
  { name: "Model", description: "AI model to use (default from settings)", required: false },
  { name: "Labels", description: "Additional configuration labels", required: false },
];

export default function Epics() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Epics & Stories</h1>
        <p className="text-muted-foreground">
          Break down large features into manageable stories with the Board system.
          Access at <code className="bg-muted px-1.5 py-0.5 rounded">/boards</code>.
        </p>
      </div>

      {/* Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          What are Epics?
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Epics are containers for related stories that together deliver a larger feature.
            Instead of creating one massive task, break it into smaller stories that workers
            can execute independently.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <Layers className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">Epic</h4>
              <p className="text-sm text-muted-foreground">The overall feature or initiative</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <FileText className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">Stories</h4>
              <p className="text-sm text-muted-foreground">Individual units of work within the epic</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <GitBranch className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">Execution</h4>
              <p className="text-sm text-muted-foreground">Stories run in order, building on each other</p>
            </div>
          </div>
        </div>
      </section>

      {/* Creating Epics */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Plus className="w-5 h-5 text-green-500" />
          Creating an Epic
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <ol className="space-y-4">
            <li className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">1</div>
              <div>
                <h4 className="font-medium text-foreground">Navigate to Epics</h4>
                <p className="text-sm text-muted-foreground">Go to <code className="bg-muted px-1.5 py-0.5 rounded">/boards</code> from the sidebar</p>
              </div>
            </li>
            <li className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">2</div>
              <div>
                <h4 className="font-medium text-foreground">Click "New Epic"</h4>
                <p className="text-sm text-muted-foreground">Fill in the epic name, key (e.g., AUTH), description, and target repository</p>
              </div>
            </li>
            <li className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">3</div>
              <div>
                <h4 className="font-medium text-foreground">Add Stories</h4>
                <p className="text-sm text-muted-foreground">Click into the epic to open the board and add stories</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* Board View */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <List className="w-5 h-5 text-blue-500" />
          The Epic Board
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Each epic has a Kanban-style board with customizable columns:
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            <div className="flex-shrink-0 w-40 p-3 bg-gray-500/10 rounded-lg border border-gray-500/30">
              <div className="text-xs font-medium text-gray-500 mb-2">BACKLOG</div>
              <div className="text-xs text-muted-foreground">Stories to do</div>
            </div>
            <div className="flex items-center text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="flex-shrink-0 w-40 p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <div className="text-xs font-medium text-blue-500 mb-2">READY</div>
              <div className="text-xs text-muted-foreground">Ready to run</div>
            </div>
            <div className="flex items-center text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="flex-shrink-0 w-40 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <div className="text-xs font-medium text-yellow-500 mb-2">IN PROGRESS</div>
              <div className="text-xs text-muted-foreground">Being worked</div>
            </div>
            <div className="flex items-center text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="flex-shrink-0 w-40 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <div className="text-xs font-medium text-purple-500 mb-2">REVIEW</div>
              <div className="text-xs text-muted-foreground">PR created</div>
            </div>
            <div className="flex items-center text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="flex-shrink-0 w-40 p-3 bg-green-500/10 rounded-lg border border-green-500/30">
              <div className="text-xs font-medium text-green-500 mb-2">DONE</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Drag stories between columns to change their status. The board auto-updates as workers progress.
          </p>
        </div>
      </section>

      {/* Story Definition */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-500" />
          Defining Stories
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Well-defined stories lead to better worker output. Include as much context as helpful:
          </p>
          <div className="space-y-3">
            {storyFields.map((field) => (
              <div key={field.name} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{field.name}</span>
                    {field.required && <span className="text-xs text-red-500">Required</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{field.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* User Story Format */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <User className="w-5 h-5 text-primary" />
          User Story Format
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Use the standard user story format to clearly communicate the requirement:
          </p>
          <div className="bg-muted/50 p-4 rounded-lg border border-border mb-4">
            <p className="text-sm font-mono">
              <span className="text-blue-500">As a</span> [user role],<br/>
              <span className="text-green-500">I want</span> [feature/capability],<br/>
              <span className="text-purple-500">So that</span> [benefit/value].
            </p>
          </div>
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="font-medium text-foreground mb-2">Example</h4>
            <p className="text-sm text-muted-foreground">
              <span className="text-blue-500">As a</span> logged-in user,<br/>
              <span className="text-green-500">I want</span> to reset my password from settings,<br/>
              <span className="text-purple-500">So that</span> I can regain access if I forget it.
            </p>
          </div>
        </div>
      </section>

      {/* Story Statuses */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-yellow-500" />
          Story Statuses
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="grid md:grid-cols-2 gap-3">
            {epicStatuses.map((item) => (
              <div key={item.status} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className={`w-3 h-3 rounded-full bg-${item.color}-500`}></div>
                <div>
                  <span className="font-medium text-foreground">{item.label}</span>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Running an Epic */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Play className="w-5 h-5 text-green-500" />
          Running an Epic
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Once stories are defined and marked as "Ready", run the epic:
          </p>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Click "Run Epic"</strong> - Workers start executing stories in order</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Monitor Progress</strong> - Watch stories move through the board</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Review PRs</strong> - Approve or request changes on generated PRs</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Handle Failures</strong> - Edit and retry any failed stories</span>
            </li>
          </ol>
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-sm text-yellow-500">
              <strong>Tip:</strong> Stories execute sequentially by default. Each story can build on the previous one's changes.
            </p>
          </div>
        </div>
      </section>

      {/* Epic Settings */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Epic Settings
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Configure epic-wide settings at <code className="bg-muted px-1.5 py-0.5 rounded">/boards/:id/settings</code>:
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Target Repository</strong> - Which GitHub/GitLab repo to work on</li>
            <li><strong className="text-foreground">Default Persona</strong> - Default worker type for stories</li>
            <li><strong className="text-foreground">Default Model</strong> - Default AI model for stories</li>
            <li><strong className="text-foreground">Board Columns</strong> - Customize the Kanban columns</li>
            <li><strong className="text-foreground">WIP Limits</strong> - Set work-in-progress limits per column</li>
          </ul>
        </div>
      </section>

      {/* Best Practices */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          Best Practices
        </h2>
        <div className="bg-card border border-green-500/30 rounded-xl p-6">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Keep stories small</strong> - Each story should be completable in one worker session</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Order stories logically</strong> - Foundation first, features second</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Include acceptance criteria</strong> - Clear pass/fail conditions help workers</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Add technical notes</strong> - Point workers to relevant files or patterns</span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span><strong className="text-foreground">Review before running</strong> - Ensure all stories are well-defined</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
