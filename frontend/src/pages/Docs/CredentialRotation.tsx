import {
  RefreshCw,
  Key,
  CheckCircle,
  Copy,
  ArrowRight,
  AlertTriangle,
  FolderOpen,
  Users,
  Zap,
  Terminal,
  Shield,
  FileText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const setupSteps = [
  {
    number: 1,
    title: "Authenticate your first account",
    description:
      "Log in with your primary Claude Max account. This creates the credentials file that the agent uses by default.",
    command: "claude auth login",
  },
  {
    number: 2,
    title: "Create the pool directory",
    description:
      "Create the credentials pool directory where account files are stored.",
    command: "mkdir -p ~/.claude/.credentials-pool",
  },
  {
    number: 3,
    title: "Copy the first account to the pool",
    description:
      "Save your primary account credentials as the first pool entry.",
    command:
      "cp ~/.claude/.credentials.json ~/.claude/.credentials-pool/account-0.json",
  },
  {
    number: 4,
    title: "Authenticate a second account",
    description:
      "Log in with a different Claude Max account. This overwrites the active credentials file.",
    command: "claude auth login",
    note: "Use a different email/account than step 1.",
  },
  {
    number: 5,
    title: "Copy the second account to the pool",
    description: "Save the second account credentials as the next pool entry.",
    command:
      "cp ~/.claude/.credentials.json ~/.claude/.credentials-pool/account-1.json",
  },
  {
    number: 6,
    title: "Restore your primary account",
    description:
      "Copy your primary account back to the active credentials file so it's used first.",
    command:
      "cp ~/.claude/.credentials-pool/account-0.json ~/.claude/.credentials.json",
  },
];

export default function CredentialRotation() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 text-amber-500 text-sm font-medium mb-4">
          <RefreshCw className="w-4 h-4" />
          Credential Rotation
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          Multi-Account Credential Rotation
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Pool multiple Claude Max subscriptions and automatically rotate
          between them when rate limits are hit, maximizing throughput for
          parallel workers.
        </p>
      </div>

      {/* Value Props */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-500" />
          </div>
          <h3 className="font-semibold text-foreground">Higher Throughput</h3>
          <p className="text-sm text-muted-foreground">
            Each Claude Max plan has usage caps. Multiple accounts multiply your
            available capacity for parallel task execution.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-blue-500" />
          </div>
          <h3 className="font-semibold text-foreground">Automatic Rotation</h3>
          <p className="text-sm text-muted-foreground">
            When a rate limit is hit, the system automatically switches to the
            next account in the pool. No manual intervention needed.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-green-500" />
          </div>
          <h3 className="font-semibold text-foreground">Zero Config</h3>
          <p className="text-sm text-muted-foreground">
            Works out of the box with the remote agent. Just create the pool
            directory and add account files -- the agent handles the rest.
          </p>
        </div>
      </div>

      {/* How It Works */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-muted-foreground" />
          How It Works
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  1. Pool discovery
                </h4>
                <p className="text-sm text-muted-foreground">
                  On startup, the coordinator scans{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    ~/.claude/.credentials-pool/
                  </code>{" "}
                  for files matching{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    account-N.json
                  </code>
                  . If found, credential rotation is enabled automatically.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Terminal className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  2. Normal execution
                </h4>
                <p className="text-sm text-muted-foreground">
                  Workers use the active credentials at{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    ~/.claude/.credentials.json
                  </code>
                  . As long as the account is within its rate limits, everything
                  runs normally.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  3. Rate limit detected
                </h4>
                <p className="text-sm text-muted-foreground">
                  When a worker hits a rate limit, the coordinator escalates it
                  as a blocker. On the retry attempt, the next account in the
                  pool is activated.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">
                  4. Credential swap
                </h4>
                <p className="text-sm text-muted-foreground">
                  The rotator copies the next{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    account-N.json
                  </code>{" "}
                  to{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    .credentials.json
                  </code>
                  , updates{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    pool-state.json
                  </code>
                  , and the worker retries with fresh credentials.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Directory Structure */}
        <div className="bg-muted/30 border border-border rounded-xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Pool Directory Structure
          </h3>
          <div className="font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre">
            {`  ~/.claude/
  ├── .credentials.json          ← active credentials (used by Claude CLI)
  └── .credentials-pool/
      ├── account-0.json         ← first Claude Max account
      ├── account-1.json         ← second Claude Max account
      ├── account-2.json         ← third account (optional)
      └── pool-state.json        ← auto-managed rotation state`}
          </div>
        </div>
      </section>

      {/* Setup Steps */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Key className="w-6 h-6 text-muted-foreground" />
          Setup
        </h2>

        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5 mb-4">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-foreground mb-1">
                Prerequisites
              </h4>
              <p className="text-sm text-muted-foreground">
                Each account in the pool needs its own Claude Max subscription.
                You'll need to log in to each account separately using{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                  claude auth login
                </code>
                .
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {setupSteps.map((step) => (
            <div
              key={step.number}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                  {step.number}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground text-lg mb-1">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {step.description}
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
                    <code className="text-foreground">{step.command}</code>
                    <button
                      onClick={() =>
                        copyToClipboard(step.command, `step-${step.number}`)
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-4"
                    >
                      {copied === `step-${step.number}` ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {step.note && (
                    <p className="text-xs text-amber-500/80 mt-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      {step.note}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Adding more accounts */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            Adding More Accounts
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Repeat the authenticate-and-copy cycle for each additional account.
            Name them sequentially:
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs text-muted-foreground space-y-1">
            <div>
              # Authenticate third account, then:
            </div>
            <div className="text-foreground">
              cp ~/.claude/.credentials.json
              ~/.claude/.credentials-pool/account-2.json
            </div>
            <div className="mt-2">
              # Authenticate fourth account, then:
            </div>
            <div className="text-foreground">
              cp ~/.claude/.credentials.json
              ~/.claude/.credentials-pool/account-3.json
            </div>
            <div className="mt-2">
              # Always restore your primary when done:
            </div>
            <div className="text-foreground">
              cp ~/.claude/.credentials-pool/account-0.json
              ~/.claude/.credentials.json
            </div>
          </div>
        </div>
      </section>

      {/* Verification */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <CheckCircle className="w-6 h-6 text-muted-foreground" />
          Verification
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Verify your pool is set up correctly:
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
            <code className="text-foreground">
              ls ~/.claude/.credentials-pool/
            </code>
            <button
              onClick={() =>
                copyToClipboard(
                  "ls ~/.claude/.credentials-pool/",
                  "verify",
                )
              }
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied === "verify" ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 font-mono text-xs">
            <div className="text-green-500">
              account-0.json &nbsp;account-1.json &nbsp;pool-state.json
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            You should see one{" "}
            <code className="bg-muted px-1 py-0.5 rounded">
              account-N.json
            </code>{" "}
            file per Claude Max account. The{" "}
            <code className="bg-muted px-1 py-0.5 rounded">
              pool-state.json
            </code>{" "}
            file is created automatically after the first rotation.
          </p>
        </div>
      </section>

      {/* Pool State */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-6 h-6 text-muted-foreground" />
          Pool State
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            The rotation state is tracked automatically in{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              pool-state.json
            </code>
            . You don't need to manage this file -- it's updated on every
            rotation.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs">
            <pre className="text-muted-foreground">{`{
  "activeIndex": 1,
  "lastRotatedAt": "2026-02-19T14:30:00.000Z",
  "rotationCount": 7
}`}</pre>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-foreground">
                    Field
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-foreground">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">activeIndex</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    Index of the currently active account in the pool
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">lastRotatedAt</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    ISO timestamp of the last rotation event
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5">
                    <code className="text-xs">rotationCount</code>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    Total number of rotations since the pool was created
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground" />
          Important Notes
        </h2>
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Each account needs a Claude Max subscription
            </h4>
            <p className="text-sm text-muted-foreground">
              Free-tier accounts won't work for worker execution. Each{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                account-N.json
              </code>{" "}
              must be authenticated against a paid Claude Max plan.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Works with the remote agent out of the box
            </h4>
            <p className="text-sm text-muted-foreground">
              The agent passes{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                HOME
              </code>{" "}
              to spawned workers, so they inherit the{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                ~/.claude/.credentials-pool/
              </code>{" "}
              directory automatically. No agent configuration changes needed.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Single-account fallback
            </h4>
            <p className="text-sm text-muted-foreground">
              If no pool directory exists or only one account is found, the
              system operates normally with no rotation. You can add accounts at
              any time without restarting the agent.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="font-medium text-foreground mb-1">
              Account file naming
            </h4>
            <p className="text-sm text-muted-foreground">
              Files must be named{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                account-0.json
              </code>
              ,{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                account-1.json
              </code>
              ,{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                account-2.json
              </code>
              , etc. The rotator discovers them by matching the{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                account-N.json
              </code>{" "}
              pattern and sorts numerically.
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/docs/agent"
            className="bg-primary/10 border border-primary/30 rounded-xl p-5 hover:bg-primary/20 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary">Agent Setup</h3>
                <p className="text-sm text-primary/70">
                  Install and configure the WorkerMill agent
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-primary" />
            </div>
          </Link>
          <Link
            to="/docs/epics"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Epics & Stories
                </h3>
                <p className="text-sm text-muted-foreground">
                  How tasks decompose into parallel expert work
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
