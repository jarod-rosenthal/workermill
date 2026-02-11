import {
  Search,
  Database,
  Settings,
  CheckCircle,
  ArrowDown,
  Server,
  FileText,
  Code,
  Zap,
  AlertCircle,
} from "lucide-react";

const indexingStages = [
  {
    phase: "1",
    title: "Chunking",
    icon: Code,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description:
      "Your codebase is split into meaningful chunks — functions, classes, modules — preserving structure and context.",
  },
  {
    phase: "2",
    title: "Embedding",
    icon: Database,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description:
      "Each chunk is converted to a vector embedding using Ollama (nomic-embed-text). Embeddings capture semantic meaning, not just keywords.",
  },
  {
    phase: "3",
    title: "Storage",
    icon: Server,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description:
      "Embeddings are stored in PostgreSQL using pgvector for fast cosine similarity search.",
  },
  {
    phase: "4",
    title: "Retrieval",
    icon: Search,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    description:
      "When a worker starts a task, relevant code is retrieved via similarity search and injected into the worker's context.",
  },
];

export default function CodebaseIndexing() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Codebase Indexing
        </h1>
        <p className="text-muted-foreground">
          Vector-based code search that gives workers deep understanding of your
          codebase before they start working. Workers receive relevant code
          snippets, patterns, and conventions automatically.
        </p>
      </div>

      {/* What It Does */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          How It Works
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Codebase Indexing uses{" "}
            <strong className="text-foreground">
              vector embeddings
            </strong>{" "}
            to give workers semantic understanding of your code. Instead of
            keyword search, workers can find code by{" "}
            <em>meaning</em> — "authentication middleware" finds your auth logic
            even if it's named <code className="px-1 bg-muted rounded">verifyToken</code>.
          </p>
          <div className="space-y-0">
            {indexingStages.map((stage, idx) => (
              <div key={stage.phase}>
                <div
                  className={`bg-card border ${stage.borderColor} rounded-lg p-4`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg ${stage.bgColor} flex-shrink-0`}
                    >
                      <stage.icon className={`w-5 h-5 ${stage.color}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-bold ${stage.color}`}
                        >
                          {stage.phase}
                        </span>
                        <h4 className="font-medium text-foreground text-sm">
                          {stage.title}
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {stage.description}
                      </p>
                    </div>
                  </div>
                </div>
                {idx < indexingStages.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Setup
        </h2>
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg">
                  Install Ollama
                </h3>
                <p className="text-muted-foreground mb-3">
                  Codebase Indexing uses Ollama to generate embeddings locally.
                  Install it from{" "}
                  <a
                    href="https://ollama.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    ollama.com
                  </a>{" "}
                  and pull the embedding model:
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm">
                  <code className="text-foreground">
                    ollama pull nomic-embed-text
                  </code>
                </div>
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
                  Enable in Settings
                </h3>
                <p className="text-muted-foreground mb-3">
                  Go to{" "}
                  <strong className="text-foreground">
                    Settings &gt; Advanced
                  </strong>{" "}
                  and enable{" "}
                  <strong className="text-foreground">
                    Codebase Indexing
                  </strong>
                  . If Ollama is running on a different machine, set the Ollama
                  URL.
                </p>
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                  Default Ollama URL:{" "}
                  <code className="text-foreground">
                    http://localhost:11434
                  </code>
                </div>
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
                  Index Your Repositories
                </h3>
                <p className="text-muted-foreground">
                  Once enabled, indexing runs automatically when a task starts
                  against a repository. You can also trigger a manual index from
                  the dashboard. Indexing is incremental — only changed files
                  are re-indexed.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What Workers Get */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          What Workers Get
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <FileText className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="font-semibold text-foreground">
                Relevant Code Context
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Workers receive code snippets that are semantically related to their
              task — similar patterns, related modules, and existing
              implementations they should follow.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">
                Proven Procedures
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Successful solutions from previous tasks are stored and retrieved,
              so workers learn from past work and apply proven approaches.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Code className="w-5 h-5 text-purple-500" />
              </div>
              <h3 className="font-semibold text-foreground">
                Codebase Conventions
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Workers understand your naming conventions, file structure, and
              architectural patterns before writing a single line of code.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Search className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="font-semibold text-foreground">
                Dependency Awareness
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Workers know which files depend on each other, reducing the risk of
              breaking changes and missed updates.
            </p>
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Requirements
          </h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                <strong className="text-foreground">Ollama</strong> must be
                running and accessible (local or remote)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                <strong className="text-foreground">
                  nomic-embed-text
                </strong>{" "}
                model must be pulled (768-dimensional embeddings)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                <strong className="text-foreground">
                  pgvector
                </strong>{" "}
                extension enabled in PostgreSQL (included by default in
                WorkerMill)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              <span>
                Feature must be{" "}
                <strong className="text-foreground">
                  enabled per organization
                </strong>{" "}
                in Settings &gt; Advanced
              </span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
