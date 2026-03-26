import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  RotateCcw,
  Settings,
  CheckCircle,
  XCircle,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import apiClient from "../lib/api-client";

// -- Types --

interface TestResult {
  status: string;
  duration: number;
  error?: { message: string; snippet?: string };
}

interface TestEntry {
  results: TestResult[];
}

interface Spec {
  title: string;
  tests: TestEntry[];
}

interface Suite {
  title: string;
  file: string;
  specs: Spec[];
  suites?: Suite[];
}

interface PlaywrightReport {
  suites: Suite[];
  stats?: {
    startTime?: string;
    duration?: number;
    expected?: number;
    unexpected?: number;
    skipped?: number;
  };
}

interface IntegrationConfig {
  testRepo: string;
  baselineTag: string;
  resetOnRun: boolean;
  ollamaHost: string;
  workerModel: string;
  suites: string[];
}

// -- Helpers --

interface FlatTest {
  name: string;
  suite: string;
  status: string;
  duration: number;
  error?: string;
}

function flattenSuites(suites: Suite[]): FlatTest[] {
  const results: FlatTest[] = [];

  function walk(suite: Suite) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const result = test.results[0];
        if (result) {
          results.push({
            name: spec.title,
            suite: suite.file || suite.title,
            status: result.status,
            duration: result.duration,
            error: result.error?.message,
          });
        }
      }
    }
    if (suite.suites) {
      for (const child of suite.suites) {
        walk(child);
      }
    }
  }

  for (const suite of suites) {
    walk(suite);
  }
  return results;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "passed" || status === "expected") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
        <CheckCircle className="w-3 h-3" />
        Pass
      </span>
    );
  }
  if (status === "failed" || status === "unexpected") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
        <XCircle className="w-3 h-3" />
        Fail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-500">
      <MinusCircle className="w-3 h-3" />
      Skip
    </span>
  );
}

// -- Component --

export default function IntegrationTests() {
  const [report, setReport] = useState<PlaywrightReport | null>(null);
  const [_config, setConfig] = useState<IntegrationConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<IntegrationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [filterSuite, setFilterSuite] = useState<string>("all");
  const [noResults, setNoResults] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // Fetch results
  const fetchResults = useCallback(async () => {
    try {
      const res = await apiClient.get("/integration-tests/results");
      setReport(res.data);
      setNoResults(false);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) {
          setNoResults(true);
        }
      }
    }
  }, []);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiClient.get("/integration-tests/config");
      setConfig(res.data);
      setConfigDraft(res.data);
    } catch {
      // defaults will be shown
    }
  }, []);

  useEffect(() => {
    fetchResults();
    fetchConfig();
  }, [fetchResults, fetchConfig]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Run tests
  const handleRun = async (suite?: string) => {
    setRunning(true);
    setLogs([]);
    try {
      const params = suite ? `?suite=${encodeURIComponent(suite)}` : "";
      await apiClient.post(`/integration-tests/run${params}`);

      // Connect SSE
      const token = localStorage.getItem("accessToken");
      const evtSource = new EventSource(
        `/api/integration-tests/run/status${token ? `?token=${encodeURIComponent(token)}` : ""}`
      );

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            setLogs((prev) => [...prev, data.line]);
          } else if (data.type === "done") {
            evtSource.close();
            setRunning(false);
            fetchResults();
          }
        } catch {
          // ignore parse errors
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        setRunning(false);
        fetchResults();
      };
    } catch {
      setRunning(false);
    }
  };

  // Reset repo
  const handleReset = async () => {
    setResetting(true);
    try {
      await apiClient.post("/integration-tests/reset-repo");
    } finally {
      setResetting(false);
    }
  };

  // Save config
  const handleSaveConfig = async () => {
    if (!configDraft) return;
    setSaving(true);
    try {
      await apiClient.put("/integration-tests/config", configDraft);
      setConfig(configDraft);
    } finally {
      setSaving(false);
    }
  };

  // Flatten tests for table
  const allTests = report ? flattenSuites(report.suites) : [];
  const suiteNames = [...new Set(allTests.map((t) => t.suite))];
  const filteredTests =
    filterSuite === "all" ? allTests : allTests.filter((t) => t.suite === filterSuite);

  const passCount = allTests.filter(
    (t) => t.status === "passed" || t.status === "expected"
  ).length;
  const failCount = allTests.filter(
    (t) => t.status === "failed" || t.status === "unexpected"
  ).length;
  const skipCount = allTests.filter(
    (t) => t.status !== "passed" && t.status !== "expected" && t.status !== "failed" && t.status !== "unexpected"
  ).length;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="p-2 rounded-lg hover:bg-[var(--card)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Integration Tests</h1>
              <p className="text-sm text-[var(--foreground)]/60 mt-1">
                Run and monitor end-to-end integration test suites
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={running || resetting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {resetting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Reset Repo
            </button>
            <button
              onClick={() => handleRun()}
              disabled={running}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {running ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {running ? "Running..." : "Run All Tests"}
            </button>
          </div>
        </div>

        {/* Live Log Output */}
        {running && logs.length > 0 && (
          <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">Test Output</span>
            </div>
            <pre
              ref={logRef}
              className="p-4 text-xs font-mono max-h-80 overflow-auto bg-black/20 text-[var(--foreground)]/80 whitespace-pre-wrap"
            >
              {logs.join("\n")}
            </pre>
          </div>
        )}

        {/* Results Panel */}
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">Test Results</span>
              {report && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-500">{passCount} passed</span>
                  <span className="text-red-500">{failCount} failed</span>
                  <span className="text-yellow-500">{skipCount} skipped</span>
                </div>
              )}
            </div>
            {suiteNames.length > 0 && (
              <select
                value={filterSuite}
                onChange={(e) => setFilterSuite(e.target.value)}
                className="text-xs rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] px-2 py-1"
              >
                <option value="all">All suites</option>
                {suiteNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {noResults && !report ? (
            <div className="p-8 text-center text-[var(--foreground)]/50 text-sm">
              No results yet — run the test suite
            </div>
          ) : !report ? (
            <div className="p-8 text-center text-[var(--foreground)]/50 text-sm">
              Loading...
            </div>
          ) : filteredTests.length === 0 ? (
            <div className="p-8 text-center text-[var(--foreground)]/50 text-sm">
              No tests match the current filter
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--foreground)]/60">
                    <th className="px-4 py-2 font-medium">Test Name</th>
                    <th className="px-4 py-2 font-medium">Suite</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTests.map((test, i) => (
                    <tr
                      key={`${test.suite}-${test.name}-${i}`}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--background)]/50"
                    >
                      <td className="px-4 py-2 font-medium">{test.name}</td>
                      <td className="px-4 py-2 text-[var(--foreground)]/60 text-xs">
                        {test.suite}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={test.status} />
                      </td>
                      <td className="px-4 py-2 text-[var(--foreground)]/60 tabular-nums">
                        {(test.duration / 1000).toFixed(1)}s
                      </td>
                      <td className="px-4 py-2 text-xs text-red-400 max-w-xs truncate">
                        {test.error || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Config Panel */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <button
            onClick={() => setConfigOpen(!configOpen)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--background)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="text-sm font-medium">Configuration</span>
            </div>
            {configOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {configOpen && configDraft && (
            <div className="px-4 pb-4 border-t border-[var(--border)] pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)]/60 mb-1">
                    Test Repository
                  </label>
                  <input
                    type="text"
                    value={configDraft.testRepo}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, testRepo: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)]/60 mb-1">
                    Baseline Tag
                  </label>
                  <input
                    type="text"
                    value={configDraft.baselineTag}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, baselineTag: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)]/60 mb-1">
                    Ollama Host
                  </label>
                  <input
                    type="text"
                    value={configDraft.ollamaHost}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, ollamaHost: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)]/60 mb-1">
                    Worker Model
                  </label>
                  <input
                    type="text"
                    value={configDraft.workerModel}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, workerModel: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm"
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="resetOnRun"
                    checked={configDraft.resetOnRun}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, resetOnRun: e.target.checked })
                    }
                    className="rounded border-[var(--border)]"
                  />
                  <label
                    htmlFor="resetOnRun"
                    className="text-sm text-[var(--foreground)]/80"
                  >
                    Reset repository before each run
                  </label>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
