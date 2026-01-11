import { useState } from "react";
import { Bug, Sparkles, RefreshCw, FileText, TestTube } from "lucide-react";

interface UseCase {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  example: {
    input: string;
    output: string;
  };
}

const useCases: UseCase[] = [
  {
    id: "bug-fixes",
    title: "Bug Fixes",
    icon: <Bug className="w-5 h-5" />,
    description:
      "AI workers analyze stack traces, reproduce issues, and implement fixes with proper test coverage.",
    example: {
      input: "TypeError: Cannot read property 'map' of undefined in UserList.tsx:42",
      output:
        "Added null check, created defensive guard, updated 3 files with fix + tests",
    },
  },
  {
    id: "new-features",
    title: "New Features",
    icon: <Sparkles className="w-5 h-5" />,
    description:
      "From Jira ticket to pull request. Workers understand requirements and implement end-to-end features.",
    example: {
      input: "Add dark mode toggle to user settings page",
      output:
        "Implemented theme context, settings toggle, localStorage persistence, PR ready",
    },
  },
  {
    id: "refactoring",
    title: "Refactoring",
    icon: <RefreshCw className="w-5 h-5" />,
    description:
      "Modernize legacy code, extract components, improve type safety, and optimize performance.",
    example: {
      input: "Convert class component UserDashboard to functional with hooks",
      output:
        "Migrated to React hooks, extracted custom hooks, improved bundle size by 15%",
    },
  },
  {
    id: "documentation",
    title: "Documentation",
    icon: <FileText className="w-5 h-5" />,
    description:
      "Generate API docs, README files, inline comments, and architectural decision records.",
    example: {
      input: "Document all public API endpoints in /api/v1/*",
      output:
        "Generated OpenAPI spec, Markdown docs, usage examples for 24 endpoints",
    },
  },
  {
    id: "tests",
    title: "Tests",
    icon: <TestTube className="w-5 h-5" />,
    description:
      "Write unit tests, integration tests, and E2E tests with proper mocking and edge case coverage.",
    example: {
      input: "Add test coverage for authentication flow",
      output:
        "Created 18 test cases covering login, logout, token refresh, error states",
    },
  },
];

export function UseCases() {
  const [activeTab, setActiveTab] = useState("bug-fixes");
  const activeCase = useCases.find((uc) => uc.id === activeTab) || useCases[0];

  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            What Can Workers Do?
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            From simple bug fixes to complex feature implementations, AI workers
            handle the full development lifecycle.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {useCases.map((useCase) => (
            <button
              key={useCase.id}
              onClick={() => setActiveTab(useCase.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === useCase.id
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
              }`}
            >
              {useCase.icon}
              {useCase.title}
            </button>
          ))}
        </div>

        {/* Content Panel */}
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-3 rounded-lg bg-primary/10 text-primary">
              {activeCase.icon}
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {activeCase.title}
              </h3>
              <p className="text-muted-foreground">{activeCase.description}</p>
            </div>
          </div>

          {/* Example */}
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Example
              </span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 font-medium">
                    Input
                  </span>
                </div>
                <p className="text-sm text-muted-foreground font-mono bg-muted/30 px-3 py-2 rounded">
                  {activeCase.example.input}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">
                    Output
                  </span>
                </div>
                <p className="text-sm text-muted-foreground font-mono bg-muted/30 px-3 py-2 rounded">
                  {activeCase.example.output}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
