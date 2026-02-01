import {
  BookOpen,
  Zap,
  CheckCircle,
  TrendingUp,
  Clock,
  Tag,
  Code2,
  FileCode,
  GitBranch,
  Sparkles,
  Search,
  BarChart3,
} from "lucide-react";

export default function SkillLibrary() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1 className="flex items-center gap-3">
        <BookOpen className="w-8 h-8 text-primary" />
        Skill Library
      </h1>

      <p className="lead text-muted-foreground">
        The Skill Library stores reusable procedures learned from successful task completions.
        When workers encounter similar problems, they can retrieve proven solutions instead of
        starting from scratch.
      </p>

      {/* Overview */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          How Skills Work
        </h2>
        <p>
          Skills are procedural memories - step-by-step instructions extracted from successfully
          completed tasks. When a worker finishes a task, the system analyzes the execution and
          captures the procedure as a reusable skill.
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">Skill Lifecycle</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium">1</div>
              <div>
                <div className="font-medium text-foreground">Task Completes Successfully</div>
                <div className="text-sm text-muted-foreground">Worker finishes a task with all tests passing</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium">2</div>
              <div>
                <div className="font-medium text-foreground">Procedure Extracted</div>
                <div className="text-sm text-muted-foreground">System analyzes execution and extracts key steps</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium">3</div>
              <div>
                <div className="font-medium text-foreground">Skill Created</div>
                <div className="text-sm text-muted-foreground">Steps, prerequisites, and metadata stored in library</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium">4</div>
              <div>
                <div className="font-medium text-foreground">Future Retrieval</div>
                <div className="text-sm text-muted-foreground">Workers query library for similar tasks, apply proven procedures</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Analytics */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          Skill Analytics
        </h2>
        <p>
          The Skill Library dashboard provides analytics to track skill usage and effectiveness:
        </p>

        <div className="not-prose grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <BookOpen className="w-4 h-4" />
              Total Skills
            </div>
            <div className="text-2xl font-bold text-foreground">42</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Zap className="w-4 h-4" />
              Total Retrievals
            </div>
            <div className="text-2xl font-bold text-foreground">156</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <TrendingUp className="w-4 h-4" />
              Avg Success Rate
            </div>
            <div className="text-2xl font-bold text-green-400">87%</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Sparkles className="w-4 h-4" />
              Created (24h)
            </div>
            <div className="text-2xl font-bold text-foreground">3</div>
          </div>
        </div>

        <h3 className="flex items-center gap-2 mt-6">
          <Zap className="w-4 h-4 text-primary" />
          Most Used Skills
        </h3>
        <p>
          Skills ranked by retrieval count. Frequently used skills are proven solutions that
          workers rely on repeatedly.
        </p>

        <h3 className="flex items-center gap-2 mt-6">
          <CheckCircle className="w-4 h-4 text-green-500" />
          Most Effective Skills
        </h3>
        <p>
          Skills ranked by success rate. These procedures have the highest likelihood of leading
          to successful task completion.
        </p>
      </section>

      {/* Skill Properties */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-primary" />
          Skill Properties
        </h2>
        <p>
          Each skill contains detailed information about the procedure:
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-foreground mb-2">Basic Info</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">name</span>
                  <span className="text-muted-foreground">Descriptive name for the skill</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">description</span>
                  <span className="text-muted-foreground">What this procedure accomplishes</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">persona</span>
                  <span className="text-muted-foreground">Which worker persona created/uses this skill</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">taskType</span>
                  <span className="text-muted-foreground">Category of task (feature, bugfix, refactor, etc.)</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-foreground mb-2">Steps</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Ordered sequence of actions to complete the procedure. Each step includes:
              </p>
              <div className="space-y-2 text-sm pl-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">action</span>
                  <span className="text-muted-foreground">What to do in this step</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">details</span>
                  <span className="text-muted-foreground">Additional context or explanation</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">example</span>
                  <span className="text-muted-foreground">Code snippet or command example</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-foreground mb-2">Prerequisites</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Conditions that must be met before this skill applies:
              </p>
              <div className="space-y-2 text-sm pl-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">technologies</span>
                  <span className="text-muted-foreground">Required tech stack (React, Python, etc.)</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">dependencies</span>
                  <span className="text-muted-foreground">Required packages or libraries</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">filesMustExist</span>
                  <span className="text-muted-foreground">Required files in the codebase</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-foreground mb-2">Metrics</h4>
              <div className="space-y-2 text-sm pl-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">usageCount</span>
                  <span className="text-muted-foreground">How many times this skill has been retrieved</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">successRate</span>
                  <span className="text-muted-foreground">Percentage of successful outcomes when used</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">isVerified</span>
                  <span className="text-muted-foreground">Whether the skill has been validated</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Searching & Filtering */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          Searching & Filtering
        </h2>
        <p>
          The Skill Library provides several ways to find relevant skills:
        </p>

        <div className="not-prose grid gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-foreground">Text Search</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Search by skill name, description, or persona. Matches partial strings for flexible queries.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-foreground">Filter by Persona</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Show only skills from a specific persona (e.g., backend_developer, frontend_developer).
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <FileCode className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-foreground">Filter by Task Type</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Show only skills for a specific task type (feature, bugfix, refactor, test, etc.).
            </p>
          </div>
        </div>
      </section>

      {/* Example Skill */}
      <section className="mt-8">
        <h2>Example Skill</h2>
        <p>
          Here's what a typical skill looks like in the library:
        </p>

        <div className="not-prose bg-card border border-border rounded-xl p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-400">Verified</span>
            <span className="px-2 py-0.5 bg-primary/20 text-primary rounded text-xs font-medium">
              backend_developer
            </span>
            <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs">
              feature
            </span>
          </div>

          <h3 className="font-semibold text-foreground text-lg">Add REST API Endpoint</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Standard procedure for adding a new REST API endpoint with validation and tests.
          </p>

          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Dec 15, 2024
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              23 uses
            </span>
            <span className="flex items-center gap-1 text-green-400">
              <TrendingUp className="w-3 h-3" />
              91% success
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <h4 className="font-medium text-foreground text-sm mb-3 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              Steps
            </h4>
            <ol className="space-y-3">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">1</span>
                <div>
                  <p className="text-sm text-foreground">Create route file</p>
                  <code className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded mt-1 block">
                    api/src/routes/my-resource.ts
                  </code>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">2</span>
                <div>
                  <p className="text-sm text-foreground">Define request validation schema</p>
                  <p className="text-xs text-muted-foreground mt-1">Use Zod for type-safe validation</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">3</span>
                <div>
                  <p className="text-sm text-foreground">Implement handler with try/catch</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">4</span>
                <div>
                  <p className="text-sm text-foreground">Register route in app.ts</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">5</span>
                <div>
                  <p className="text-sm text-foreground">Write integration tests</p>
                </div>
              </li>
            </ol>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="w-4 h-4" />
              <span>Repository:</span>
              <code className="bg-muted/50 px-2 py-0.5 rounded text-xs">oncallshift-api</code>
            </div>
          </div>
        </div>
      </section>

      {/* Best Practices */}
      <section className="mt-8">
        <h2>Best Practices</h2>

        <div className="not-prose grid gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Review Low-Success Skills</h3>
            <p className="text-sm text-muted-foreground">
              Skills with low success rates may have outdated steps or incorrect prerequisites.
              Consider deleting or updating them.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Check Prerequisites Match Your Stack</h3>
            <p className="text-sm text-muted-foreground">
              Skills learned from one repository may not apply to others. Check that the
              technologies and file requirements match your project.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Keep Skills Verified</h3>
            <p className="text-sm text-muted-foreground">
              Verified skills have been confirmed to produce correct results. Prioritize
              using verified skills over unverified ones.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Delete Obsolete Skills</h3>
            <p className="text-sm text-muted-foreground">
              If your codebase changes significantly (new framework, restructure), old skills
              may become harmful. Clean up the library periodically.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
