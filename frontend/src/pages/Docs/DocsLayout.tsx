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
} from "lucide-react";

const navItems = [
  { to: "/docs", label: "Overview", icon: BookOpen, end: true },
  { to: "/docs/task-lifecycle", label: "Task Lifecycle", icon: Workflow },
  { to: "/docs/personas", label: "Worker Personas", icon: Users },
  { to: "/docs/integrations", label: "Integrations", icon: Link2 },
  { to: "/docs/severity", label: "Severity Levels", icon: AlertTriangle },
  { to: "/docs/metrics", label: "Metrics", icon: BarChart3 },
];

export default function DocsLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <Link to="/">
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
            <span>v1.0.0</span>
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
