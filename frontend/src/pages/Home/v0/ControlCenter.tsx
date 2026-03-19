import React from "react"
import { useEffect, useState, useCallback, useRef } from "react"
import { Cpu, GitPullRequest, CheckCircle2 } from "lucide-react"

// Task status progression
type TaskStatus = "Queued" | "Claiming" | "Executing" | "Testing" | "PR Created" | "Merged"

interface AnimatedTask {
  id: number
  taskKey: string
  status: TaskStatus
  progress: number
  color: string
}

// Terminal log entries for the simulation
const terminalScripts = [
  [
    { time: "14:23:15", text: "Claiming task PROJ-142...", color: "text-slate-300" },
    { time: "14:23:16", text: "Reading ticket context...", color: "text-amber-400" },
    { time: "14:23:18", text: "Analyzing codebase structure...", color: "text-blue-400" },
    { time: "14:23:22", text: "Implementing UserProfile component...", color: "text-emerald-400" },
  ],
  [
    { time: "14:23:25", text: "Writing unit tests...", color: "text-slate-300" },
    { time: "14:23:28", text: "Running test suite...", color: "text-amber-400" },
    { time: "14:23:31", text: "✓ 42 tests passed", color: "text-emerald-400" },
    { time: "14:23:32", text: "Creating pull request...", color: "text-blue-400" },
  ],
  [
    { time: "14:23:35", text: "PR #247 created successfully", color: "text-emerald-400" },
    { time: "14:23:36", text: "Requesting review from @team...", color: "text-slate-300" },
    { time: "14:23:38", text: "Starting next task PROJ-138...", color: "text-amber-400" },
    { time: "14:23:40", text: "Analyzing API requirements...", color: "text-blue-400" },
  ],
]

const taskColors = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-orange-500", "bg-pink-500", "bg-cyan-500"]

export function ControlCenter() {
  // Stats animation
  const [stats, setStats] = useState({ workers: 0, tasks: 0, prs: 0 })
  const [animatingWorkers, setAnimatingWorkers] = useState(false)
  const [animatingTasks, setAnimatingTasks] = useState(false)
  const [animatingPrs, setAnimatingPrs] = useState(false)

  // Tasks animation
  const [tasks, setTasks] = useState<AnimatedTask[]>([
    { id: 142, taskKey: "PROJ-142", status: "Queued", progress: 0, color: "bg-violet-500" },
    { id: 138, taskKey: "PROJ-138", status: "Queued", progress: 0, color: "bg-blue-500" },
    { id: 145, taskKey: "PROJ-145", status: "Queued", progress: 0, color: "bg-emerald-500" },
  ])

  // Terminal animation - always exactly 4 lines
  const [terminalLines, setTerminalLines] = useState<Array<{ time: string; text: string; typed: string; color: string }>>([
    { time: "14:23:11", text: "Worker initialized", typed: "Worker initialized", color: "text-slate-300" },
    { time: "14:23:12", text: "Connected to repository", typed: "Connected to repository", color: "text-slate-300" },
    { time: "14:23:13", text: "Authenticating...", typed: "Authenticating...", color: "text-amber-400" },
    { time: "14:23:14", text: "Ready for tasks...", typed: "Ready for tasks...", color: "text-emerald-400" },
  ])
  const [scriptIndex, setScriptIndex] = useState(0)
  const [lineIndex, setLineIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)

  const [initialAnimationDone, setInitialAnimationDone] = useState(false)
  const seenTaskIdsRef = useRef<Set<number>>(new Set([142, 138, 145]))
  const hasSyncedIdsRef = useRef(false)
  const mergedTaskIdsRef = useRef<Set<number>>(new Set())
  const hasSyncedMergedIdsRef = useRef(false)

  // Initial stats count-up animation - increment by 1 at a time
  useEffect(() => {
    const targetStats = { workers: 4, tasks: 15, prs: 12 }
    const current = { workers: 0, tasks: 0, prs: 0 }

    const timer = setInterval(() => {
      let changed = false

      if (current.workers < targetStats.workers) {
        current.workers++
        changed = true
      }
      if (current.tasks < targetStats.tasks) {
        current.tasks++
        changed = true
      }
      if (current.prs < targetStats.prs) {
        current.prs++
        changed = true
      }

      if (changed) {
        setStats({ ...current })
      } else {
        clearInterval(timer)
        setTimeout(() => setInitialAnimationDone(true), 1500)
      }
    }, 120) // Slower increment

    return () => clearInterval(timer)
  }, [])

  // Worker count fluctuation
  useEffect(() => {
    let workerInterval: ReturnType<typeof setTimeout>
    let isActive = true

    const initialDelay = setTimeout(() => {
      const scheduleNext = () => {
        if (!isActive) return
        const nextDelay = 4000 + Math.random() * 4000
        workerInterval = setTimeout(() => {
          if (!isActive) return
          setStats((prev) => {
            const rand = Math.random()
            let newWorkers = prev.workers
            if (prev.workers === 4) {
              if (rand < 0.3) newWorkers = 3
              else if (rand < 0.6) newWorkers = 5
            } else if (prev.workers === 3 || prev.workers === 5) {
              if (rand < 0.7) newWorkers = 4
            }
            if (newWorkers !== prev.workers) {
              setAnimatingWorkers(true)
              setTimeout(() => setAnimatingWorkers(false), 300)
            }
            return { ...prev, workers: newWorkers }
          })
          scheduleNext()
        }, nextDelay)
      }
      scheduleNext()
    }, 2500)

    return () => {
      isActive = false
      clearTimeout(initialDelay)
      clearTimeout(workerInterval)
    }
  }, [])

  // Increment Tasks Today when a new task appears
  useEffect(() => {
    if (!initialAnimationDone) return

    const currentIds = tasks.map((t) => t.id)

    if (!hasSyncedIdsRef.current) {
      currentIds.forEach((id) => seenTaskIdsRef.current.add(id))
      hasSyncedIdsRef.current = true
      return
    }

    const newIds = currentIds.filter((id) => !seenTaskIdsRef.current.has(id))

    if (newIds.length > 0) {
      newIds.forEach((id) => seenTaskIdsRef.current.add(id))
      setStats((prev) => ({ ...prev, tasks: prev.tasks + newIds.length }))
      setAnimatingTasks(true)
      setTimeout(() => setAnimatingTasks(false), 300)
    }
  }, [tasks, initialAnimationDone])

  // Typewriter effect for terminal
  useEffect(() => {
    const currentScript = terminalScripts[scriptIndex]
    if (!currentScript) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting index when scripts exhausted
      setScriptIndex(0)
      return
    }

    const currentLine = currentScript[lineIndex]
    if (!currentLine) {
      const timeout = setTimeout(() => {
        setLineIndex(0)
        setCharIndex(0)
        setScriptIndex((prev) => (prev + 1) % terminalScripts.length)
      }, 4500) // 3x slower pause between scripts
      return () => clearTimeout(timeout)
    }

    if (charIndex === 0) {
      setTerminalLines((prev) => {
        const newLines = [...prev]
        newLines[0] = { ...newLines[1] }
        newLines[1] = { ...newLines[2] }
        newLines[2] = { ...newLines[3] }
        newLines[3] = { time: currentLine.time, text: currentLine.text, typed: "", color: currentLine.color }
        return newLines
      })
    }

    if (charIndex < currentLine.text.length) {
      const timeout = setTimeout(() => {
        setTerminalLines((prev) => {
          const updated = [...prev]
          updated[3] = {
            ...updated[3],
            typed: currentLine.text.slice(0, charIndex + 1),
          }
          return updated
        })
        setCharIndex((prev) => prev + 1)
      }, 50 + Math.random() * 40) // Slower typing
      return () => clearTimeout(timeout)
    } else {
      const timeout = setTimeout(() => {
        setLineIndex((prev) => prev + 1)
        setCharIndex(0)
      }, 1200) // 3x slower pause between lines
      return () => clearTimeout(timeout)
    }
  }, [scriptIndex, lineIndex, charIndex])

  // Progress bar and status animation
  const updateTaskProgress = useCallback(() => {
    setTasks((prevTasks) => {
      return prevTasks.map((task) => {
        let newProgress = task.progress
        let newStatus = task.status

        switch (task.status) {
          case "Queued":
            newProgress = Math.min(task.progress + 0.7, 10)
            if (newProgress >= 10) newStatus = "Claiming"
            break
          case "Claiming":
            newProgress = Math.min(task.progress + 1, 20)
            if (newProgress >= 20) newStatus = "Executing"
            break
          case "Executing":
            newProgress = Math.min(task.progress + 0.5, 70)
            if (newProgress >= 70) newStatus = "Testing"
            break
          case "Testing":
            newProgress = Math.min(task.progress + 0.7, 90)
            if (newProgress >= 90) newStatus = "PR Created"
            break
          case "PR Created":
            newProgress = Math.min(task.progress + 0.4, 100)
            if (newProgress >= 100) newStatus = "Merged"
            break
          case "Merged":
            return {
              ...task,
              id: task.id + 10,
              taskKey: `PROJ-${task.id + 10}`,
              status: "Queued" as TaskStatus,
              progress: 0,
              color: taskColors[Math.floor(Math.random() * taskColors.length)],
            }
        }

        return { ...task, progress: newProgress, status: newStatus }
      })
    })
  }, [])

  useEffect(() => {
    const interval = setInterval(updateTaskProgress, 450) // 3x slower
    return () => clearInterval(interval)
  }, [updateTaskProgress])

  // Increment PR count when tasks complete
  useEffect(() => {
    if (!initialAnimationDone) return

    const mergedTasks = tasks.filter((t) => t.status === "Merged")

    if (!hasSyncedMergedIdsRef.current) {
      mergedTasks.forEach((t) => mergedTaskIdsRef.current.add(t.id))
      hasSyncedMergedIdsRef.current = true
      return
    }

    const newMerges = mergedTasks.filter((t) => !mergedTaskIdsRef.current.has(t.id))

    if (newMerges.length > 0) {
      newMerges.forEach((t) => mergedTaskIdsRef.current.add(t.id))
      setStats((prev) => ({ ...prev, prs: prev.prs + newMerges.length }))
      setAnimatingPrs(true)
      setTimeout(() => setAnimatingPrs(false), 300)
    }
  }, [tasks, initialAnimationDone])

  return (
    <div className="relative w-full max-w-[540px]">
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
          <StatCard
            icon={Cpu}
            value={stats.workers.toString()}
            label="Active Workers"
            animating={animatingWorkers}
          />
          <StatCard
            icon={CheckCircle2}
            value={stats.tasks.toString()}
            label="Tasks Today"
            animating={animatingTasks}
          />
          <StatCard
            icon={GitPullRequest}
            value={stats.prs.toString()}
            label="PRs Merged"
            highlight
            animating={animatingPrs}
          />
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

        {/* Terminal - fixed height */}
        <div className="m-4 mt-0 bg-slate-900 rounded-lg p-4 font-mono text-xs border border-slate-800 h-[140px]">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-400 text-[10px] uppercase tracking-wider">Worker Output</span>
          </div>
          <div className="space-y-1">
            {terminalLines.map((log, i) => (
              <div key={i} className="flex gap-2 h-5">
                <span className="text-slate-600 select-none shrink-0">[{log.time}]</span>
                <span className={`${log.color} truncate`}>
                  {log.typed}
                  {i === 3 && (
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
  animating = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  label: string
  highlight?: boolean
  animating?: boolean
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
        className={`text-xl font-semibold tracking-tight tabular-nums transition-transform duration-300 ${
          highlight ? "text-emerald-400" : "text-white"
        } ${animating ? "scale-110" : "scale-100"}`}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{label}</div>
    </div>
  )
}

function TaskRow({
  taskKey,
  status,
  progress,
  color,
}: {
  id: number
  taskKey: string
  status: TaskStatus
  progress: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3 group">
      <span className="text-xs font-mono font-medium text-slate-300 w-20">{taskKey}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-150 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-slate-400 bg-slate-800 px-2 py-1 rounded min-w-[70px] text-center">
        {status}
      </span>
    </div>
  )
}
