import { Link } from "react-router-dom";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  DollarSign,
  Activity,
  Play,
  Power,
  Zap,
  Users,
  ChevronDown,
  Wrench,
  BarChart3,
  Brain,
  BookOpen,
  Target,
  LayoutGrid,
  FileText,
} from "lucide-react";
import { ProfileDropdown } from "../../../components/ProfileDropdown";
import { OrgSwitcher } from "../../../components/OrgSwitcher";
import type { ControlCenterData } from "../types";
import { formatCost } from "../helpers";

interface DashboardHeaderProps {
  data: ControlCenterData | null;
  isProPlan: boolean;
  systemEnabled: boolean;
  systemToggleLoading: boolean;
  toggleSystem: () => void;
  setShowCreateTaskModal: (show: boolean) => void;
  isEfficiencyDropdownOpen: boolean;
  setIsEfficiencyDropdownOpen: (open: boolean) => void;
  efficiencyDropdownRef: React.RefObject<HTMLDivElement | null>;
}

export function DashboardHeader({
  data,
  isProPlan,
  systemEnabled,
  systemToggleLoading,
  toggleSystem,
  setShowCreateTaskModal,
  isEfficiencyDropdownOpen,
  setIsEfficiencyDropdownOpen,
  efficiencyDropdownRef,
}: DashboardHeaderProps) {
  return (
    <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
      <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link to="/" className="group flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-foreground group-hover:opacity-80 transition-opacity">
              WorkerMill
            </span>
          </Link>

          <OrgSwitcher />

          <div className="w-px h-6 bg-border/50" />

          <button
            onClick={toggleSystem}
            disabled={systemToggleLoading}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              systemEnabled
                ? "bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20"
                : "bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 hover:bg-yellow-500/20"
            } ${systemToggleLoading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {systemToggleLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : systemEnabled ? (
              <Power className="w-4 h-4" />
            ) : (
              <Wrench className="w-4 h-4" />
            )}
            {systemEnabled ? "System ON" : "Maintenance Mode"}
          </button>

          <button
            onClick={() => setShowCreateTaskModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 transition-all"
            data-testid="create-task-btn"
          >
            <Play className="w-4 h-4" />
            Run Task
          </button>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-2 flex-1 justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <Activity className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-semibold text-yellow-500">{data?.stats.queueDepth || 0}</span>
            <span className="text-xs text-muted-foreground">Queued</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Zap className="w-4 h-4 text-cyan-500" />
            <span className="text-sm font-semibold text-cyan-500">{data?.stats.activeWorkers || 0}</span>
            <span className="text-xs text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm font-semibold text-green-500">{data?.stats.periodCompleted || 0}</span>
            <span className="text-xs text-muted-foreground">Done</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-500">{data?.stats.periodFailed || 0}</span>
            <span className="text-xs text-muted-foreground">Failed</span>
          </div>
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20"
            title="Estimated API token cost based on provider rates"
          >
            <DollarSign className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-accent">~${formatCost(data?.stats.cumulativeCost)}</span>
            <span className="text-xs text-muted-foreground">Est.</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Link to="/personas" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <Users className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium">Personas</span>
          </Link>
          <Link to="/boards" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <LayoutGrid className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-medium">Boards</span>
          </Link>
          <Link to="/specs" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <FileText className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium">Specs</span>
          </Link>

          {/* Insights Dropdown */}
          <div ref={efficiencyDropdownRef} className="relative">
            <button
              onClick={() => setIsEfficiencyDropdownOpen(!isEfficiencyDropdownOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ${isEfficiencyDropdownOpen ? 'bg-muted text-foreground' : ''}`}
            >
              <Zap className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">Insights</span>
              {isProPlan && <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">MAX</span>}
              <ChevronDown className={`w-3 h-3 transition-transform ${isEfficiencyDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {isEfficiencyDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-card border border-border shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="py-1">
                  {isProPlan ? (
                    <>
                      <Link to="/pricing" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <BarChart3 className="w-4 h-4 text-green-500/50" />
                        Analytics
                        <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">MAX</span>
                      </Link>
                      <Link to="/pricing" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <DollarSign className="w-4 h-4 text-emerald-500/50" />
                        Cost Intelligence
                        <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">MAX</span>
                      </Link>
                      <Link to="/pricing" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <Brain className="w-4 h-4 text-purple-500/50" />
                        Memory Management
                        <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">MAX</span>
                      </Link>
                      <Link to="/pricing" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <BookOpen className="w-4 h-4 text-blue-500/50" />
                        Skill Library
                        <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">MAX</span>
                      </Link>
                      <Link to="/pricing" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <Target className="w-4 h-4 text-rose-500/50" />
                        Directive Analytics
                        <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full ml-auto">MAX</span>
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link to="/analytics" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                        <BarChart3 className="w-4 h-4 text-green-500" />
                        Analytics
                      </Link>
                      <Link to="/cost-intelligence" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                        <DollarSign className="w-4 h-4 text-emerald-500" />
                        Cost Intelligence
                        <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                      </Link>
                      <Link to="/memory" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                        <Brain className="w-4 h-4 text-purple-500" />
                        Memory Management
                        <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                      </Link>
                      <Link to="/skills" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                        <BookOpen className="w-4 h-4 text-blue-500" />
                        Skill Library
                        <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                      </Link>
                      <Link to="/directive-effectiveness" onClick={() => setIsEfficiencyDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors">
                        <Target className="w-4 h-4 text-rose-500" />
                        Directive Analytics
                        <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-border/50" />
          <ProfileDropdown />
        </div>
      </div>
    </header>
  );
}
