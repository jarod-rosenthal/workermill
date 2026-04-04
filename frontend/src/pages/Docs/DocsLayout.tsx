import { NavLink, Outlet, Link } from "react-router-dom";
import {
  BookOpen,
  GitBranch,
  Users,
  Link2,
  AlertTriangle,
  BarChart3,
  ArrowLeft,
  Workflow,
  Zap,
  Rocket,
  Shield,
  TrendingUp,
  Brain,
  Router,
  Layers,
  Palette,
  Library,
  Target,
  Monitor,
  Search,
  FolderGit2,
  Radio,
  FileText,
  TerminalSquare,
} from "lucide-react";
import { useAuthStore } from "../../store/auth-store";

const navItems = [
  { to: "/docs", label: "Overview", icon: BookOpen, end: true },
  { to: "/docs/quick-start", label: "Quick Start", icon: Rocket },
  { to: "/docs/cli", label: "WorkerMill CLI", icon: TerminalSquare },
  { to: "/docs/cli/reference", label: "  ↳ CLI Reference", icon: BookOpen },
  { to: "/docs/vscode-extension", label: "VS Code Extension", icon: Radio },
  { to: "/docs/agent", label: "Agent Setup", icon: Monitor },
  { to: "/docs/repositories", label: "Repositories", icon: FolderGit2 },
  { to: "/docs/codebase-indexing", label: "Codebase Indexing", icon: Search },
  { to: "/docs/task-lifecycle", label: "Task Lifecycle", icon: Workflow },
  { to: "/docs/epics", label: "Epics & Stories", icon: Layers },
  { to: "/docs/specifications", label: "Specifications", icon: FileText },
  { to: "/docs/advanced-features", label: "Advanced Features", icon: Zap },
  { to: "/docs/analytics", label: "Analytics", icon: TrendingUp },
  { to: "/docs/memory", label: "Memory System", icon: Brain },
  { to: "/docs/personas", label: "Worker Personas", icon: Users },
  { to: "/docs/persona-studio", label: "Persona Studio", icon: Palette },
  { to: "/docs/skill-library", label: "Skill Library", icon: Library },
  { to: "/docs/directive-effectiveness", label: "Directive Effectiveness", icon: Target },
  { to: "/docs/integrations", label: "Integrations", icon: Link2 },
  { to: "/docs/mcp", label: "MCP Integration", icon: Router },
  { to: "/docs/severity", label: "Severity Levels", icon: AlertTriangle },
  { to: "/docs/metrics", label: "Metrics", icon: BarChart3 },
  { to: "/docs/compliance", label: "Compliance", icon: Shield },
];

export default function DocsLayout() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const backLink = isAuthenticated ? "/dashboard" : "/";
  const backLabel = isAuthenticated ? "Back to Dashboard" : "Back to Home";

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Link
            to={backLink}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
          </Link>
          <Link to={backLink}>
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent hover:opacity-80 transition-opacity">
              WorkerMill Docs
            </h1>
          </Link>
          <p className="text-xs text-muted-foreground mt-1">
            AI-Powered Task Automation
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitBranch className="w-3 h-3" />
            <span>Docs</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
