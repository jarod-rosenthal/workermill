import { ArrowRight, Terminal } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";

// Task status progression
type TaskStatus = "Queued" | "Claiming" | "Executing" | "Testing" | "PR Created" | "Merged";

interface AnimatedTask {
  id: number;
  emoji: string;
  key: string;
  status: TaskStatus;
  progress: number;
  color: string;
}

// Terminal log entries for the simulation
const terminalScripts = [
  [
    { time: "14:23:15", text: "Claiming task PROJ-142..." },
    { time: "14:23:16", text: "Reading ticket requirements..." },
    { time: "14:23:18", text: "Analyzing codebase structure..." },
    { time: "14:23:22", text: "Implementing UserProfile component..." },
  ],
  [
    { time: "14:23:25", text: "Writing unit tests..." },
    { time: "14:23:28", text: "Running test suite..." },
    { time: "14:23:31", text: "✓ 42 tests passed" },
    { time: "14:23:32", text: "Creating pull request..." },
  ],
  [
    { time: "14:23:35", text: "PR #247 created successfully" },
    { time: "14:23:36", text: "Requesting review from @team..." },
    { time: "14:23:38", text: "Starting next task PROJ-138..." },
    { time: "14:23:40", text: "Analyzing API requirements..." },
  ],
  [
    { time: "14:23:42", text: "Implementing REST endpoint..." },
    { time: "14:23:45", text: "Adding input validation..." },
    { time: "14:23:48", text: "Writing integration tests..." },
    { time: "14:23:51", text: "Running linter... ✓ No issues" },
  ],
];

const taskEmojis = ["🎨", "💻", "🔧", "🛡️", "🧪", "📊"];
const taskColors = [
  "from-purple-500",
  "from-blue-500",
  "from-green-500",
  "from-orange-500",
  "from-pink-500",
  "from-cyan-500",
];

export default function Hero() {
  // Stats animation
  const [stats, setStats] = useState({ workers: 0, tasks: 0, prs: 0 });

  // Tasks animation
  const [tasks, setTasks] = useState<AnimatedTask[]>([
    { id: 142, emoji: "🎨", key: "PROJ-142", status: "Queued", progress: 0, color: "from-purple-500" },
    { id: 138, emoji: "💻", key: "PROJ-138", status: "Queued", progress: 0, color: "from-blue-500" },
    { id: 145, emoji: "🔧", key: "PROJ-145", status: "Queued", progress: 0, color: "from-green-500" },
  ]);

  // Terminal animation - always exactly 3 lines
  const [terminalLines, setTerminalLines] = useState<Array<{ time: string; text: string; typed: string }>>([
    { time: "14:23:12", text: "Worker initialized", typed: "Worker initialized" },
    { time: "14:23:13", text: "Connected to repository", typed: "Connected to repository" },
    { time: "14:23:14", text: "Ready for tasks...", typed: "Ready for tasks..." },
  ]);
  const [scriptIndex, setScriptIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  // Track when initial animation is complete
  const [initialAnimationDone, setInitialAnimationDone] = useState(false);

  // Initial stats count-up animation
  useEffect(() => {
    const targetStats = { workers: 4, tasks: 12, prs: 8 };
    const duration = 2000;
    const steps = 30;
    const interval = duration / steps;

    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      setStats({
        workers: Math.round(targetStats.workers * progress),
        tasks: Math.round(targetStats.tasks * progress),
        prs: Math.round(targetStats.prs * progress),
      });
      if (step >= steps) {
        clearInterval(timer);
        // Mark initial animation as complete after page settles (1.5s delay)
        setTimeout(() => setInitialAnimationDone(true), 1500);
      }
    }, interval);

    return () => clearInterval(timer);
  }, []);

  // Track animation states for visual feedback
  const [animatingWorkers, setAnimatingWorkers] = useState(false);
  const [animatingTasks, setAnimatingTasks] = useState(false);
  const [animatingPrs, setAnimatingPrs] = useState(false);

  // Track previously seen task IDs to detect new tasks
  const seenTaskIdsRef = useRef<Set<number>>(new Set([142, 138, 145]));

  // Continuous animation for Active Workers (fluctuates 3-5 realistically)
  useEffect(() => {
    let workerInterval: ReturnType<typeof setTimeout>;
    let isActive = true;

    const initialDelay = setTimeout(() => {
      const scheduleNext = () => {
        if (!isActive) return;
        // Variable timing: 4-8 seconds between changes
        const nextDelay = 4000 + Math.random() * 4000;
        workerInterval = setTimeout(() => {
          if (!isActive) return;
          setStats((prev) => {
            // Bias toward staying at 4 (most common), occasionally 3 or 5
            const rand = Math.random();
            let newWorkers = prev.workers;
            if (prev.workers === 4) {
              // At 4: 30% chance to go to 3, 30% to go to 5, 40% stay
              if (rand < 0.3) newWorkers = 3;
              else if (rand < 0.6) newWorkers = 5;
            } else if (prev.workers === 3) {
              // At 3: 70% chance to go back to 4
              if (rand < 0.7) newWorkers = 4;
            } else if (prev.workers === 5) {
              // At 5: 70% chance to go back to 4
              if (rand < 0.7) newWorkers = 4;
            }
            if (newWorkers !== prev.workers) {
              setAnimatingWorkers(true);
              setTimeout(() => setAnimatingWorkers(false), 300);
            }
            return { ...prev, workers: newWorkers };
          });
          scheduleNext();
        }, nextDelay);
      };
      scheduleNext();
    }, 2500);

    return () => {
      isActive = false;
      clearTimeout(initialDelay);
      clearTimeout(workerInterval);
    };
  }, []);

  // Track if we've synced the seen IDs after initial animation
  const hasSyncedIdsRef = useRef(false);

  // Increment Tasks Today when a new task appears (after task resets with new ID)
  useEffect(() => {
    // Skip during initial animation to avoid jumpy numbers
    if (!initialAnimationDone) return;

    const currentIds = tasks.map((t) => t.id);

    // First time after animation completes: sync all current IDs without incrementing
    if (!hasSyncedIdsRef.current) {
      currentIds.forEach((id) => seenTaskIdsRef.current.add(id));
      hasSyncedIdsRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seenTaskIdsRef.current.has(id));

    if (newIds.length > 0) {
      // Add new IDs to seen set
      newIds.forEach((id) => seenTaskIdsRef.current.add(id));

      // Increment tasks count with animation
      setStats((prev) => ({ ...prev, tasks: prev.tasks + newIds.length }));
      setAnimatingTasks(true);
      setTimeout(() => setAnimatingTasks(false), 300);
    }
  }, [tasks, initialAnimationDone]);

  // Typewriter effect for terminal - maintains exactly 3 lines
  useEffect(() => {
    const currentScript = terminalScripts[scriptIndex];
    if (!currentScript) {
      setScriptIndex(0);
      return;
    }

    const currentLine = currentScript[lineIndex];
    if (!currentLine) {
      // Move to next script after a pause
      const timeout = setTimeout(() => {
        setLineIndex(0);
        setCharIndex(0);
        setScriptIndex((prev) => (prev + 1) % terminalScripts.length);
      }, 1500);
      return () => clearTimeout(timeout);
    }

    if (charIndex === 0) {
      // Start typing into the current slot (shift existing lines up)
      setTerminalLines((prev) => {
        const newLines = [...prev];
        // Shift lines up: slot 0 gets slot 1's content, slot 1 gets slot 2's content
        newLines[0] = { ...newLines[1] };
        newLines[1] = { ...newLines[2] };
        // Slot 2 (bottom) gets the new line being typed
        newLines[2] = { time: currentLine.time, text: currentLine.text, typed: "" };
        return newLines;
      });
    }

    if (charIndex < currentLine.text.length) {
      // Type next character into the bottom slot
      const timeout = setTimeout(() => {
        setTerminalLines((prev) => {
          const updated = [...prev];
          updated[2] = {
            ...updated[2],
            typed: currentLine.text.slice(0, charIndex + 1),
          };
          return updated;
        });
        setCharIndex((prev) => prev + 1);
      }, 25 + Math.random() * 25); // Variable typing speed
      return () => clearTimeout(timeout);
    } else {
      // Line complete, move to next line
      const timeout = setTimeout(() => {
        setLineIndex((prev) => prev + 1);
        setCharIndex(0);
      }, 400);
      return () => clearTimeout(timeout);
    }
  }, [scriptIndex, lineIndex, charIndex]);

  // Progress bar and status animation
  const updateTaskProgress = useCallback(() => {
    setTasks((prevTasks) => {
      return prevTasks.map((task) => {
        let newProgress = task.progress;
        let newStatus = task.status;

        // Progress based on current status
        switch (task.status) {
          case "Queued":
            newProgress = Math.min(task.progress + 2, 10);
            if (newProgress >= 10) newStatus = "Claiming";
            break;
          case "Claiming":
            newProgress = Math.min(task.progress + 3, 20);
            if (newProgress >= 20) newStatus = "Executing";
            break;
          case "Executing":
            newProgress = Math.min(task.progress + 1.5, 70);
            if (newProgress >= 70) newStatus = "Testing";
            break;
          case "Testing":
            newProgress = Math.min(task.progress + 2, 90);
            if (newProgress >= 90) newStatus = "PR Created";
            break;
          case "PR Created":
            newProgress = Math.min(task.progress + 1, 100);
            if (newProgress >= 100) newStatus = "Merged";
            break;
          case "Merged":
            // Reset task with new ID after brief pause
            return {
              ...task,
              id: task.id + 10,
              key: `PROJ-${task.id + 10}`,
              status: "Queued" as TaskStatus,
              progress: 0,
              emoji: taskEmojis[Math.floor(Math.random() * taskEmojis.length)],
              color: taskColors[Math.floor(Math.random() * taskColors.length)],
            };
        }

        return { ...task, progress: newProgress, status: newStatus };
      });
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(updateTaskProgress, 150);
    return () => clearInterval(interval);
  }, [updateTaskProgress]);

  // Track merged tasks to increment PR count only on new merges
  const mergedTaskIdsRef = useRef<Set<number>>(new Set());
  const hasSyncedMergedIdsRef = useRef(false);

  // Increment PR count when tasks complete (with animation)
  useEffect(() => {
    // Skip during initial animation to avoid jumpy numbers
    if (!initialAnimationDone) return;

    const mergedTasks = tasks.filter((t) => t.status === "Merged");

    // First time after animation completes: sync all merged IDs without incrementing
    if (!hasSyncedMergedIdsRef.current) {
      mergedTasks.forEach((t) => mergedTaskIdsRef.current.add(t.id));
      hasSyncedMergedIdsRef.current = true;
      return;
    }

    const newMerges = mergedTasks.filter((t) => !mergedTaskIdsRef.current.has(t.id));

    if (newMerges.length > 0) {
      newMerges.forEach((t) => mergedTaskIdsRef.current.add(t.id));
      setStats((prev) => ({ ...prev, prs: prev.prs + newMerges.length }));
      setAnimatingPrs(true);
      setTimeout(() => setAnimatingPrs(false), 300);
    }
  }, [tasks, initialAnimationDone]);

  // Get status color
  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case "Queued": return "bg-gray-500/50";
      case "Claiming": return "bg-yellow-500/50";
      case "Executing": return "bg-blue-500/50";
      case "Testing": return "bg-purple-500/50";
      case "PR Created": return "bg-green-500/50";
      case "Merged": return "bg-emerald-500/50";
      default: return "bg-muted/50";
    }
  };

  return (
    <section className="min-h-screen flex flex-col justify-center relative overflow-hidden">
      {/* Animated orbs */}
      <div className="orb orb-primary w-[500px] h-[500px] top-20 left-[10%] animate-float" />
      <div className="orb orb-accent w-[400px] h-[400px] bottom-32 right-[15%] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="orb orb-primary w-[300px] h-[300px] top-1/2 right-[5%] animate-float" style={{ animationDelay: '-5s' }} />

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/50 via-transparent to-background/50 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left side - Copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full gradient-border-subtle text-sm font-medium">
              <span className="text-primary">Opus-quality output at Haiku prices</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
              <span className="text-foreground">Premium AI coding.</span>
              <br />
              <span className="text-gradient-animated">
                Budget prices.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl text-muted-foreground leading-relaxed max-w-xl">
              WorkerMill's tight feedback loops make cheap models smart. Planning Agent validates before execution. Tech Lead reviews after. You get 90% of expensive model quality at 10% of the cost.
            </p>

            {/* CLI Install */}
            <div className="space-y-4">
              <div className="relative group">
                <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/50 rounded-xl border border-border font-mono text-sm">
                  <span className="text-muted-foreground select-none">$</span>
                  <span className="text-foreground flex-1">npx workermill</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText("npx workermill");
                      const btn = document.getElementById("copy-btn");
                      if (btn) { btn.textContent = "Copied!"; setTimeout(() => btn.textContent = "Copy", 2000); }
                    }}
                    id="copy-btn"
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/50 hover:border-border transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Works with Ollama, Anthropic, OpenAI, and Google. No account needed.
              </p>
            </div>

            {/* Secondary CTAs — CLI + VS Code only */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/docs/cli"
                className="group inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                CLI Documentation
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-foreground font-medium rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-300"
              >
                VS Code Extension
              </a>
            </div>

          </div>

          {/* Right side - Dashboard Preview */}
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/30 to-accent/30 rounded-2xl blur-2xl transform scale-105 animate-glow" />

            {/* Dashboard mockup */}
            <div className="relative card-elevated rounded-2xl overflow-hidden glow-mixed">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-gradient-to-r from-muted/30 to-muted/10">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <div className="flex-1 text-center text-xs text-muted-foreground font-medium">
                  WorkerMill Control Center
                </div>
              </div>

              {/* Dashboard content */}
              <div className="p-6 space-y-4">
                {/* Stats row - animated */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl p-3 text-center border border-white/5">
                    <div
                      className={`text-2xl font-bold text-primary tabular-nums transition-transform duration-300 ${animatingWorkers ? "scale-110" : "scale-100"}`}
                    >
                      {stats.workers}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Active Workers
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-accent/20 to-accent/5 rounded-xl p-3 text-center border border-white/5">
                    <div
                      className={`text-2xl font-bold text-accent tabular-nums transition-transform duration-300 ${animatingTasks ? "scale-110" : "scale-100"}`}
                    >
                      {stats.tasks}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Tasks Today
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 rounded-xl p-3 text-center border border-white/5">
                    <div
                      className={`text-2xl font-bold text-green-500 tabular-nums transition-transform duration-300 ${animatingPrs ? "scale-110" : "scale-100"}`}
                    >
                      {stats.prs}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      PRs Merged
                    </div>
                  </div>
                </div>

                {/* Active task cards - animated */}
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 bg-gradient-to-r from-muted/30 to-transparent rounded-xl p-3 border border-white/5"
                    >
                      <span className="text-lg">{task.emoji}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{task.key}</span>
                          <span className={`text-muted-foreground text-xs px-2 py-0.5 ${getStatusColor(task.status)} rounded-full transition-colors duration-300`}>
                            {task.status}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${task.color} to-accent rounded-full transition-all duration-150 ease-out`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Terminal preview - animated typewriter with fixed 3 lines */}
                <div className="terminal-preview rounded-xl p-4 font-mono text-xs border h-[100px] overflow-hidden">
                  <div className="space-y-1.5">
                    {terminalLines.map((line, idx) => (
                      <div key={idx} className="terminal-text flex items-center gap-2 h-5">
                        <span className="text-gray-400 shrink-0">[{line.time}]</span>
                        <span className="truncate">{line.typed}</span>
                        {idx === 2 && line.typed !== line.text && (
                          <span className="inline-block w-2 h-4 bg-green-400 animate-pulse shrink-0" />
                        )}
                        {idx === 2 && line.typed === line.text && (
                          <span className="inline-block w-2 h-4 bg-green-400 animate-pulse shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
