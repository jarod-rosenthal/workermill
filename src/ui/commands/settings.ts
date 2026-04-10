/**
 * /settings (and /config) command handler — extracted from slash-commands.ts
 */

import {
  loadConfig,
  saveConfig,
} from "../../config.js";
import { getApiKeyEnvVar } from "../../provider-capabilities.js";
import type { SlashCommandContext } from "../slash-commands.js";

export function handleSettingsCommand(arg: string, ctx: SlashCommandContext): void {
  const config = loadConfig();
  if (!config) {
    ctx.addSystemMessage("No config found. Run setup first.");
    return;
  }

  if (!arg || arg === "all") {
    const showAll = arg === "all";

    // Gather primary values
    const reviewEnabled = config.review?.enabled !== false;
    const maxRevisions = config.review?.maxRevisions ?? 3;
    const approvalThreshold = config.review?.approvalThreshold ?? 9;
    const qaParticipation = config.qa?.participation ?? "default";
    const liveViewEnabled = config.liveView === true;
    const liveViewUrl = ctx.getLiveViewUrl?.() || null;
    const liveViewValue = liveViewEnabled && liveViewUrl ? `${liveViewEnabled} (\`${liveViewUrl}\`)` : String(liveViewEnabled);
    const inlineEditPreview = config.inlineEditPreview ?? true;
    const bellEnabled = config.bell === true;

    // Primary settings — always shown
    let table =
      `\n**Settings** (\`~/.workermill/cli.json\`)\n\n` +
      `| Setting | Value | Command |\n` +
      `|---|---|---|\n` +
      `| Review enabled | ${reviewEnabled} | \`/settings review.enabled <true/false>\` |\n` +
      `| Max revisions | ${maxRevisions} | \`/settings review.maxRevisions <n>\` |\n` +
      `| Approval threshold | ${approvalThreshold} | \`/settings review.threshold <n>\` |\n` +
      `| QA participation | ${qaParticipation} | \`/settings qa.participation <default/always>\` |\n` +
      `| Issue tracker | ${config.ticketSystem || "github"} | \`/settings tickets <github\\|jira\\|linear>\` |\n` +
      `| Live code view | ${liveViewValue} | \`/settings liveView <true/false>\` |\n` +
      `| Inline edit preview | ${inlineEditPreview} | \`/settings ui.inlineEditPreview <true/false>\` |\n` +
      `| Beep when done | ${bellEnabled} | \`/settings bell <true/false>\` |\n` +
      `| Experimental (/orchestrate) | ${config.experimental ?? false} | \`/settings experimental <true/false>\` |\n` +
      `| API keys | — | \`/settings key <provider> <api-key>\` |`;

    if (showAll) {
      // Advanced settings
      const ollamaHost = config.providers?.ollama?.host || "http://localhost:11434";
      const ollamaCtx = config.providers?.ollama?.contextLength || 65536;
      const autoRevise = config.review?.autoRevise ?? false;
      const autoBranch = config.review?.autoBranch ?? false;
      const maxIssues = config.program?.maxIssues ?? config.program?.maxSubIssues ?? 25;
      const maxAutoRetries = config.program?.maxAutoRetries ?? 1;
      const gateMode = config.program?.gateMode ?? "advisory";
      const gateCount = config.program?.gates?.length ?? 0;
      const sandboxMode = config.sandbox !== false ? "true" : "false";
      const allowRules = config.permissions?.allow || [];
      const denyRules = config.permissions?.deny || [];

      table +=
        `\n\n**Advanced**\n\n` +
        `| Setting | Value | Command |\n` +
        `|---|---|---|\n` +
        `| Ollama host | \`${ollamaHost}\` | \`/settings ollama.host <url>\` |\n` +
        `| Ollama context | ${ollamaCtx} | \`/settings ollama.context <n>\` |\n` +
        `| Auto-revise | ${autoRevise} | \`/settings review.autoRevise <true/false>\` |\n` +
        `| Auto checkout branch | ${autoBranch} | \`/settings review.autoBranch <true/false>\` |\n` +
        `| Strict mode | ${config.review?.strict ?? false} | \`/settings review.strict <true/false>\` |\n` +
        `| Program max issues | ${maxIssues} | \`/settings program.maxIssues <n>\` |\n` +
        `| Program max auto-retries | ${maxAutoRetries} | \`/settings program.maxAutoRetries <n>\` |\n` +
        `| Program gate mode | ${gateMode} | \`/settings program.gateMode <required/advisory>\` |\n` +
        `| Program gates | ${gateCount} command(s) | Edit \`program.gates\` in \`cli.json\` |\n` +
        `| Sandbox | ${sandboxMode} | \`/settings sandbox <true/false>\` |\n` +
        `| Jira URL | ${config.jira?.baseUrl || "\u2014"} | \`/settings jira.url <url>\` |\n` +
        `| Jira email | ${config.jira?.email || "\u2014"} | \`/settings jira.email <email>\` |\n` +
        `| Jira token | ${config.jira?.apiToken ? "***" : "\u2014"} | \`/settings jira.token <token>\` |\n` +
        `| Linear key | ${config.linear?.apiKey ? "***" : "\u2014"} | \`/settings linear.key <key>\` |\n` +
        `| Permission allow rules | ${allowRules.length} rule(s) | Edit \`cli.json\` |\n` +
        `| Permission deny rules | ${denyRules.length} rule(s) | Edit \`cli.json\` |`;
    } else {
      table += `\n\nType \`/settings all\` to see all settings.`;
    }

    ctx.addSystemMessage(table);

    const displayRoutingProvider = (persona: string, provider: string): string => {
      const suffix = `_${persona}`;
      if (provider.endsWith(suffix)) {
        return provider.slice(0, -suffix.length);
      }
      return provider;
    };
    const displayRoutingModel = (provider: string): string => {
      return config.providers?.[provider]?.model || "(unknown)";
    };

    // Show routing — filter out stale entries (e.g. "critic" after removal)
    const routing = config.routing;
    const validEntries = Object.entries(routing || {}).filter(([persona]) => persona !== "critic");
    const routingRows = [
      ...(showAll
        ? [`| default | ${displayRoutingProvider("default", config.default)} | ${displayRoutingModel(config.default)} | ${config.default} |`]
        : [`| default | ${displayRoutingProvider("default", config.default)} | ${displayRoutingModel(config.default)} |`]),
      ...validEntries.map(([persona, provider]) =>
        showAll
          ? `| ${persona} | ${displayRoutingProvider(persona, provider)} | ${displayRoutingModel(provider)} | ${provider} |`
          : `| ${persona} | ${displayRoutingProvider(persona, provider)} | ${displayRoutingModel(provider)} |`,
      ),
    ];
    const routingHeader = showAll
      ? `| Persona | Provider | Model | Config key |\n|---|---|---|---|\n`
      : `| Persona | Provider | Model |\n|---|---|---|\n`;
    ctx.addSystemMessage(
      `\n\n**Persona Routing** (\`/settings route <persona> <provider>/<model>\`)\n\n` +
      routingHeader +
      routingRows.join("\n"),
    );
  } else {
    // Parse key=value or key value
    const parts = arg.split(/[\s=]+/);
    const rawKey = parts[0];
    const keyAliases: Record<string, string> = {
      "ollama.host": "ollama.host",
      "ollama.context": "ollama.context",
      "review.enabled": "review.enabled",
      "review.maxrevisions": "review.maxRevisions",
      "review.threshold": "review.threshold",
      "review.autorevise": "review.autoRevise",
      "review.autobranch": "review.autoBranch",
      "review.strict": "review.strict",
      "qa.participation": "qa.participation",
      "program.maxissues": "program.maxIssues",
      "program.maxautoretries": "program.maxAutoRetries",
      "program.gatemode": "program.gateMode",
      "sandbox": "sandbox",
      "liveview": "liveView",
      "ui.inlineeditpreview": "ui.inlineEditPreview",
      "inlineeditpreview": "ui.inlineEditPreview",
      "bell": "bell",
      "experimental": "experimental",
      "tickets": "tickets",
      "jira.url": "jira.url",
      "jira.email": "jira.email",
      "jira.token": "jira.token",
      "linear.key": "linear.key",
      "route": "route",
      "key": "key",
    };
    const key = keyAliases[rawKey.toLowerCase()] ?? rawKey;
    const value = parts.slice(1).join(" ");

    if (!value) {
      ctx.addSystemMessage(`Usage: \`/settings ${key} <value>\``);
      return;
    }

    const boolVal = (v: string) => v === "true" || v === "1" || v === "on" || v === "yes";
    const numVal = (v: string) => parseInt(v, 10);
    const parseIntSetting = (raw: string, keyName: string, min: number): number | null => {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < min) {
        ctx.addSystemMessage(`Invalid value for \`${keyName}\`. Use an integer >= ${min}.`);
        return null;
      }
      return n;
    };
    let settingApplied = true;

    switch (key) {
      case "ollama.host": {
        if (!config.providers.ollama) config.providers.ollama = { model: "qwen3-coder:30b" };
        config.providers.ollama.host = value;
        break;
      }
      case "ollama.context": {
        if (!config.providers.ollama) config.providers.ollama = { model: "qwen3-coder:30b" };
        config.providers.ollama.contextLength = numVal(value);
        break;
      }
      case "review.enabled": {
        config.review = { ...config.review, enabled: boolVal(value) };
        break;
      }
      case "review.maxRevisions": {
        config.review = { ...config.review, maxRevisions: numVal(value) };
        break;
      }
      case "review.threshold": {
        config.review = { ...config.review, approvalThreshold: numVal(value) };
        break;
      }
      case "review.autoRevise": {
        config.review = { ...config.review, autoRevise: boolVal(value) };
        break;
      }
      case "review.autoBranch": {
        config.review = { ...config.review, autoBranch: boolVal(value) };
        break;
      }
      case "review.strict": {
        config.review = { ...config.review, strict: boolVal(value) };
        break;
      }
      case "qa.participation": {
        const normalized = value.toLowerCase();
        if (!["default", "always"].includes(normalized)) {
          ctx.addSystemMessage("Invalid value for `qa.participation`. Use `default` or `always`.");
          settingApplied = false;
          break;
        }
        config.qa = { ...config.qa, participation: normalized as "default" | "always" };
        break;
      }
      case "program.maxIssues": {
        const n = parseIntSetting(value, "program.maxIssues", 1);
        if (n === null) {
          settingApplied = false;
          break;
        }
        config.program = { ...(config.program || {}), maxIssues: n };
        break;
      }
      case "program.maxAutoRetries": {
        const n = parseIntSetting(value, "program.maxAutoRetries", 0);
        if (n === null) {
          settingApplied = false;
          break;
        }
        config.program = { ...(config.program || {}), maxAutoRetries: n };
        break;
      }
      case "program.gateMode": {
        const normalized = value.toLowerCase();
        if (normalized !== "required" && normalized !== "advisory") {
          ctx.addSystemMessage("Invalid value for `program.gateMode`. Use `required` or `advisory`.");
          settingApplied = false;
          break;
        }
        config.program = { ...(config.program || {}), gateMode: normalized as "required" | "advisory" };
        break;
      }
      case "sandbox": {
        const normalized = value.toLowerCase();
        if (["true", "1", "on", "yes"].includes(normalized)) {
          config.sandbox = true;
          break;
        }
        if (["false", "0", "off", "no"].includes(normalized)) {
          config.sandbox = false;
          break;
        }
        ctx.addSystemMessage("Invalid value for `sandbox`. Use `true` or `false`.");
        settingApplied = false;
        break;
      }
      case "liveView": {
        const normalized = value.toLowerCase();
        if (["true", "1", "on", "yes"].includes(normalized)) {
          config.liveView = true;
          break;
        }
        if (["false", "0", "off", "no"].includes(normalized)) {
          config.liveView = false;
          break;
        }
        ctx.addSystemMessage("Invalid value for `liveView`. Use `true` or `false`.");
        settingApplied = false;
        break;
      }
      case "bell": {
        config.bell = boolVal(value);
        break;
      }
      case "ui.inlineEditPreview": {
        config.inlineEditPreview = boolVal(value);
        break;
      }
      case "experimental": {
        config.experimental = boolVal(value);
        break;
      }
      case "tickets": {
        const valid = ["github", "jira", "linear"];
        if (!valid.includes(value)) {
          ctx.addSystemMessage(`Invalid tracker: \`${value}\`. Use one of: ${valid.join(", ")}`);
          settingApplied = false;
          break;
        }
        config.ticketSystem = value as "github" | "jira" | "linear";
        if (value === "jira" && !config.jira) {
          ctx.addSystemMessage("**Switched to Jira.** Now set credentials:\n\n```\n/settings jira.url https://myteam.atlassian.net\n/settings jira.email you@company.com\n/settings jira.token <api-token>\n```");
        } else if (value === "linear" && !config.linear) {
          ctx.addSystemMessage("**Switched to Linear.** Now set your API key:\n\n```\n/settings linear.key <api-key>\n```");
        }
        break;
      }
      case "jira.url": {
        config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, baseUrl: value };
        break;
      }
      case "jira.email": {
        config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, email: value };
        break;
      }
      case "jira.token": {
        config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, apiToken: value };
        break;
      }
      case "linear.key": {
        config.linear = { apiKey: value };
        break;
      }
      case "route": {
        // /settings route <persona> <provider>/<model>
        const routeParts = value.split(/\s+/);
        if (routeParts.length < 2) {
          ctx.addSystemMessage("**Usage:** `/settings route <persona> <provider>/<model>`\n\nExample: `/settings route backend_developer anthropic/claude-sonnet-4-6`");
          break;
        }
        const [persona, routeTarget] = routeParts;
        const targetParts = routeTarget.split("/");
        if (targetParts.length < 2) {
          ctx.addSystemMessage("**Usage:** `/settings route <persona> <provider>/<model>`\n\nExample: `/settings route qa_engineer xai/grok-code-fast-1`");
          settingApplied = false;
          break;
        }
        const provider = targetParts[0];
        const model = targetParts.slice(1).join("/");
        if (!config.providers[provider]) {
          ctx.addSystemMessage(`Provider \`${provider}\` not found in config. Available: ${Object.keys(config.providers).join(", ")}\n\nTo add a provider first: \`/settings key ${provider} <api-key>\``);
          settingApplied = false;
          break;
        }
        const envVar = getApiKeyEnvVar(provider);
        const needsKey = !!envVar;
        const hasConfigKey = !!config.providers[provider]?.apiKey;
        const hasEnvKey = !!(envVar && process.env[envVar]);
        if (needsKey && !hasConfigKey && !hasEnvKey) {
          ctx.addSystemMessage(
            `**Cannot route \`${persona}\` to \`${provider}/${model}\`** \u2014 no API key found.\n\n` +
            `Add your key: \`/settings key ${provider} <your-api-key>\`\n` +
            `Then run \`/settings route ${persona} ${provider}/${model}\` again.`
          );
          settingApplied = false;
          break;
        }
        const roleProviderKey = `${provider}_${persona}`;
        const baseEntry = config.providers[provider];
        const apiKey = baseEntry?.apiKey || (hasEnvKey ? `{env:${envVar}}` : undefined);
        config.providers[roleProviderKey] = {
          model,
          ...(apiKey ? { apiKey } : {}),
          ...(baseEntry?.host ? { host: baseEntry.host } : {}),
          ...(baseEntry?.contextLength ? { contextLength: baseEntry.contextLength } : {}),
        };
        config.routing = { ...config.routing, [persona]: roleProviderKey };
        break;
      }
      case "key": {
        // /settings key <provider> <api-key>
        const keyParts = value.split(/\s+/);
        if (keyParts.length < 2) {
          ctx.addSystemMessage("**Usage:** `/settings key <provider> <api-key>`\n\nExample: `/settings key anthropic sk-ant-...`");
          break;
        }
        const [keyProvider, ...keyRest] = keyParts;
        const apiKeyValue = keyRest.join(" ").trim();
        if (!config.providers[keyProvider]) {
          config.providers[keyProvider] = { model: "", apiKey: apiKeyValue };
        } else {
          config.providers[keyProvider].apiKey = apiKeyValue;
        }
        // Also set in process.env so it's immediately usable
        const envName = getApiKeyEnvVar(keyProvider);
        if (envName) {
          process.env[envName] = apiKeyValue;
        }
        break;
      }
      default:
        ctx.addSystemMessage(`Unknown setting: \`${key}\`. Type \`/settings all\` to see all options.`);
        settingApplied = false;
        break;
    }

    if (settingApplied && ["ollama.host", "ollama.context", "review.enabled", "review.maxRevisions", "review.threshold", "review.autoRevise", "review.autoBranch", "review.strict", "qa.participation", "program.maxIssues", "program.maxAutoRetries", "program.gateMode", "sandbox", "liveView", "ui.inlineEditPreview", "bell", "experimental", "route", "key", "tickets", "jira.url", "jira.email", "jira.token", "linear.key", ].includes(key)) {
      saveConfig(config);
      ctx.addSystemMessage(`**Updated** \`${key}\` \u2192 \`${value}\` (saved to ~/.workermill/cli.json)`);
      if (key === "route") {
        ctx.updateRoleModels?.();
      }
      if (key === "liveView" && ctx.setLiveViewEnabled) {
        const enabled = boolVal(value);
        const url = ctx.setLiveViewEnabled(enabled);
        if (enabled && url) {
          const isWsl = process.platform === "linux" && (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));
          const wslHint = isWsl ? " (WSL: open this URL in your Windows browser)" : "";
          ctx.addSystemMessage(`Live code view listening: \`${url}\`${wslHint}`);
        } else if (enabled) {
          ctx.addSystemMessage("Live code view enabled.");
        } else {
          ctx.addSystemMessage("Live code view disabled.");
        }
      }
      if (key === "ui.inlineEditPreview" && ctx.setInlineEditPreviewEnabled) {
        ctx.setInlineEditPreviewEnabled(boolVal(value));
      }
    }
  }
}
