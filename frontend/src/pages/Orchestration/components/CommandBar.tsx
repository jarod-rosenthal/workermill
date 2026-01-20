import { useState, useCallback } from "react";
import {
  Search,
  Filter,
  LayoutGrid,
  List,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  X,
} from "lucide-react";
import type { ChildTask } from "../orchestration-store";

export type ViewMode = "cards" | "list";
export type StatusFilter = "all" | "attention" | "running" | "completed" | "failed";

interface CommandBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  stories: ChildTask[];
}

/**
 * CommandBar - Search, filter, and view controls
 * Implements progressive disclosure for filtering workflows
 */
export function CommandBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
  stories,
}: CommandBarProps) {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Calculate filter counts
  const counts = {
    all: stories.length,
    attention: stories.filter(
      (s) => s.status === "blocked" || s.status === "failed"
    ).length,
    running: stories.filter((s) =>
      ["executing", "environment_setup", "claimed"].includes(s.status)
    ).length,
    completed: stories.filter((s) =>
      ["completed", "deployed", "pr_created", "review_requested"].includes(s.status)
    ).length,
    failed: stories.filter((s) =>
      ["failed", "cancelled"].includes(s.status)
    ).length,
  };

  const filterOptions: { value: StatusFilter; label: string; icon: React.ReactNode; color: string }[] = [
    { value: "all", label: "All", icon: <Filter className="w-3 h-3" />, color: "text-[var(--mc-text-secondary)]" },
    { value: "attention", label: "Needs Attention", icon: <AlertTriangle className="w-3 h-3" />, color: "text-[var(--mc-status-warning)]" },
    { value: "running", label: "Running", icon: <Clock className="w-3 h-3" />, color: "text-[var(--mc-status-active)]" },
    { value: "completed", label: "Completed", icon: <CheckCircle className="w-3 h-3" />, color: "text-[var(--mc-status-live)]" },
    { value: "failed", label: "Failed", icon: <XCircle className="w-3 h-3" />, color: "text-[var(--mc-status-danger)]" },
  ];

  const currentFilter = filterOptions.find((f) => f.value === statusFilter) || filterOptions[0];

  const handleFilterSelect = useCallback((filter: StatusFilter) => {
    onStatusFilterChange(filter);
    setShowFilterDropdown(false);
  }, [onStatusFilterChange]);

  return (
    <div className="mc-command-bar">
      {/* Search Input */}
      <div className="mc-command-bar-search">
        <Search className="w-4 h-4 text-[var(--mc-text-muted)]" />
        <input
          type="text"
          placeholder="Search stories, tasks, or files..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="mc-command-bar-input"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="mc-command-bar-clear"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Filter Dropdown */}
      <div className="mc-command-bar-filter">
        <button
          onClick={() => setShowFilterDropdown(!showFilterDropdown)}
          className={`mc-command-bar-filter-btn ${statusFilter !== "all" ? "active" : ""}`}
        >
          <span className={currentFilter.color}>{currentFilter.icon}</span>
          <span>{currentFilter.label}</span>
          {statusFilter !== "all" && counts[statusFilter] > 0 && (
            <span className="mc-command-bar-filter-count">{counts[statusFilter]}</span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${showFilterDropdown ? "rotate-180" : ""}`} />
        </button>

        {showFilterDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowFilterDropdown(false)}
            />
            <div className="mc-command-bar-dropdown">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleFilterSelect(option.value)}
                  className={`mc-command-bar-dropdown-item ${statusFilter === option.value ? "active" : ""}`}
                >
                  <span className={option.color}>{option.icon}</span>
                  <span className="flex-1">{option.label}</span>
                  <span className="mc-command-bar-dropdown-count">
                    {counts[option.value]}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Quick Filter Pills */}
      <div className="mc-command-bar-pills">
        {counts.attention > 0 && (
          <button
            onClick={() => onStatusFilterChange(statusFilter === "attention" ? "all" : "attention")}
            className={`mc-command-bar-pill warning ${statusFilter === "attention" ? "active" : ""}`}
          >
            <AlertTriangle className="w-3 h-3" />
            <span>{counts.attention}</span>
          </button>
        )}
        {counts.running > 0 && (
          <button
            onClick={() => onStatusFilterChange(statusFilter === "running" ? "all" : "running")}
            className={`mc-command-bar-pill active ${statusFilter === "running" ? "active" : ""}`}
          >
            <Clock className="w-3 h-3" />
            <span>{counts.running}</span>
          </button>
        )}
        {counts.completed > 0 && (
          <button
            onClick={() => onStatusFilterChange(statusFilter === "completed" ? "all" : "completed")}
            className={`mc-command-bar-pill live ${statusFilter === "completed" ? "active" : ""}`}
          >
            <CheckCircle className="w-3 h-3" />
            <span>{counts.completed}</span>
          </button>
        )}
        {counts.failed > 0 && (
          <button
            onClick={() => onStatusFilterChange(statusFilter === "failed" ? "all" : "failed")}
            className={`mc-command-bar-pill danger ${statusFilter === "failed" ? "active" : ""}`}
          >
            <XCircle className="w-3 h-3" />
            <span>{counts.failed}</span>
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* View Toggle */}
      <div className="mc-command-bar-view-toggle">
        <button
          onClick={() => onViewModeChange("cards")}
          className={`mc-command-bar-view-btn ${viewMode === "cards" ? "active" : ""}`}
          title="Card View"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewModeChange("list")}
          className={`mc-command-bar-view-btn ${viewMode === "list" ? "active" : ""}`}
          title="List View"
        >
          <List className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
