import React from "react"
import { useEffect, useState } from "react"
import { Cpu, GitPullRequest, CheckCircle2 } from "lucide-react"

const tasks = [
  { id: "PROJ-142", progress: 45, color: "bg-violet-500", status: "Planning" },
  { id: "PROJ-138", progress: 72, color: "bg-blue-500", status: "Executing" },
  { id: "PROJ-145", progress: 88, color: "bg-emerald-500", status: "Review" },
]

const logLines = [
  { time: "14:23:14", text: "Ready for tasks...", color: "text-emerald-400" },
  { time: "14:23:15", text: "Claiming task PROJ-142...", color: "text-slate-300" },
  { time: "14:23:16", text: "Reading ticket context...", color: "text-amber-400" },
  { time: "14:23:18", text: "Planning implementation...", color: "text-blue-400" },
]

export function ControlCenter() {
  const [visibleLogs, setVisibleLogs] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleLogs((prev) => (prev < logLines.length ? prev + 1 : prev))
    }, 800)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative w-full max-w-[440px]">
      {/* Glow effect */}
      <div className="absolute -inset-6 bg-gradient-to-br from-teal-500/20 via-transparent to-blue-500/10 rounded-3xl blur-3xl opacity-70" />

      {/* Window */}
      <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/30 border border-white/10 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-medium text-slate-400">
            WorkerMill Control Center
          </span>
          <div className="w-16" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1 p-4 bg-white/[0.02]">
          <StatCard icon={Cpu} value="4" label="Active Workers" />
          <StatCard icon={CheckCircle2} value="47" label="Tasks Today" />
          <StatCard icon={GitPullRequest} value="12" label="PRs Merged" highlight />
        </div>

        {/* Task list */}
        <div className="px-4 py-4 space-y-3 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Tasks</span>
            <span className="text-xs text-slate-500">3 running</span>
          </div>
          {tasks.map((task) => (
            <TaskRow key={task.id} {...task} />
          ))}
        </div>

        {/* Terminal */}
        <div className="m-4 mt-0 bg-slate-900 rounded-lg p-4 font-mono text-xs border border-slate-800">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-400 text-[10px] uppercase tracking-wider">Worker Output</span>
          </div>
          <div className="space-y-1">
            {logLines.slice(0, visibleLogs).map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-600 select-none">[{log.time}]</span>
                <span className={log.color}>
                  {log.text}
                  {i === visibleLogs - 1 && (
                    <span className="inline-block w-2 h-3.5 bg-slate-400 ml-0.5 animate-pulse" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  value,
  label,
  highlight = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className={`text-center py-3 px-2 rounded-lg transition-colors ${
        highlight
          ? "bg-emerald-500/10 ring-1 ring-emerald-500/20"
          : "hover:bg-white/5"
      }`}
    >
      <Icon className={`w-4 h-4 mx-auto mb-1.5 ${highlight ? "text-emerald-400" : "text-slate-500"}`} />
      <div
        className={`text-xl font-semibold tracking-tight ${
          highlight ? "text-emerald-400" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{label}</div>
    </div>
  )
}

function TaskRow({
  id,
  progress,
  color,
  status,
}: {
  id: string
  progress: number
  color: string
  status: string
}) {
  return (
    <div className="flex items-center gap-3 group">
      <span className="text-xs font-mono font-medium text-slate-300 w-20">{id}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-slate-400 bg-slate-800 px-2 py-1 rounded min-w-[70px] text-center">
        {status}
      </span>
    </div>
  )
}
