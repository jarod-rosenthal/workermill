import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

interface LspStatus {
  language: string;
  status: "available" | "missing";
  detail: string;
}

interface ProjectContextSummary {
  manifests: string[];
  lockfiles: string[];
  packageManager: string | null;
  frameworks: string[];
  scripts: Array<{ name: string; command: string }>;
  keyConfigs: string[];
  lsp: LspStatus | null;
}

const MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "Gemfile",
  "composer.json",
] as const;

const LOCKFILE_TO_PACKAGE_MANAGER: Array<{ file: string; label: string }> = [
  { file: "pnpm-lock.yaml", label: "pnpm" },
  { file: "package-lock.json", label: "npm" },
  { file: "yarn.lock", label: "yarn" },
  { file: "bun.lock", label: "bun" },
  { file: "bun.lockb", label: "bun" },
];

const KEY_CONFIG_FILES = [
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.config.js",
  "jest.config.js",
  "jest.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.ts",
  "eslint.config.js",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  "prettier.config.js",
  ".prettierrc",
  "turbo.json",
  "nx.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
];

const FRAMEWORK_DETECTIONS: Array<{ pkg: string; label: string }> = [
  { pkg: "react", label: "React" },
  { pkg: "next", label: "Next.js" },
  { pkg: "vite", label: "Vite" },
  { pkg: "express", label: "Express" },
  { pkg: "fastify", label: "Fastify" },
  { pkg: "@nestjs/core", label: "NestJS" },
  { pkg: "hono", label: "Hono" },
  { pkg: "vitest", label: "Vitest" },
  { pkg: "jest", label: "Jest" },
  { pkg: "prisma", label: "Prisma" },
  { pkg: "drizzle-orm", label: "Drizzle" },
  { pkg: "typeorm", label: "TypeORM" },
  { pkg: "vue", label: "Vue" },
  { pkg: "nuxt", label: "Nuxt" },
  { pkg: "astro", label: "Astro" },
  { pkg: "svelte", label: "Svelte" },
  { pkg: "solid-js", label: "SolidJS" },
];

const SCRIPT_PRIORITY = ["dev", "start", "build", "test", "lint", "typecheck", "check"] as const;

function readRootEntries(workingDir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(workingDir));
  } catch {
    return new Set<string>();
  }
}

function readPackageJson(workingDir: string): Record<string, unknown> | null {
  try {
    const packageJsonPath = path.join(workingDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return null;
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function commandExists(cmd: string): boolean {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(whichCmd, [cmd], { stdio: "ignore" });
  return result.status === 0;
}

function getPackageManager(
  entries: Set<string>,
  packageJson: Record<string, unknown> | null,
): string | null {
  const packageManagerField = typeof packageJson?.packageManager === "string"
    ? packageJson.packageManager
    : "";
  const packageManagerName = packageManagerField.split("@")[0].trim();
  if (packageManagerName) return packageManagerName;

  for (const lockfile of LOCKFILE_TO_PACKAGE_MANAGER) {
    if (entries.has(lockfile.file)) return lockfile.label;
  }

  if (entries.has("package.json")) return "npm";
  return null;
}

function collectFrameworks(packageJson: Record<string, unknown> | null): string[] {
  if (!packageJson) return [];
  const dependencies = {
    ...(typeof packageJson.dependencies === "object" && packageJson.dependencies ? packageJson.dependencies as Record<string, unknown> : {}),
    ...(typeof packageJson.devDependencies === "object" && packageJson.devDependencies ? packageJson.devDependencies as Record<string, unknown> : {}),
  };

  return FRAMEWORK_DETECTIONS
    .filter(({ pkg }) => Object.prototype.hasOwnProperty.call(dependencies, pkg))
    .map(({ label }) => label);
}

function collectScripts(packageJson: Record<string, unknown> | null): Array<{ name: string; command: string }> {
  if (!packageJson || typeof packageJson.scripts !== "object" || !packageJson.scripts) return [];
  const scripts = packageJson.scripts as Record<string, unknown>;
  const seen = new Set<string>();
  const ordered: Array<{ name: string; command: string }> = SCRIPT_PRIORITY
    .filter((name) => typeof scripts[name] === "string")
    .map((name) => ({ name, command: String(scripts[name]) }));

  for (const script of ordered) {
    seen.add(script.name);
  }

  for (const [name, command] of Object.entries(scripts)) {
    if (seen.has(name) || typeof command !== "string") continue;
    ordered.push({ name, command });
    if (ordered.length >= 8) break;
  }

  return ordered;
}

function detectLspStatus(entries: Set<string>): LspStatus | null {
  if (entries.has("tsconfig.json") || entries.has("package.json")) {
    if (commandExists("typescript-language-server")) {
      return {
        language: "TypeScript",
        status: "available",
        detail: "global typescript-language-server detected",
      };
    }
    if (commandExists("npx")) {
      return {
        language: "TypeScript",
        status: "available",
        detail: "available via npx auto-provision",
      };
    }
    return {
      language: "TypeScript",
      status: "missing",
      detail: "install typescript-language-server and typescript",
    };
  }

  if (entries.has("pyproject.toml") || entries.has("setup.py") || entries.has("requirements.txt")) {
    if (commandExists("pyright-langserver")) {
      return { language: "Python", status: "available", detail: "pyright-langserver detected" };
    }
    if (commandExists("pylsp")) {
      return { language: "Python", status: "available", detail: "pylsp detected" };
    }
    return { language: "Python", status: "missing", detail: "install pyright or python-lsp-server" };
  }

  if (entries.has("go.mod")) {
    if (commandExists("gopls")) {
      return { language: "Go", status: "available", detail: "gopls detected" };
    }
    return { language: "Go", status: "missing", detail: "install gopls" };
  }

  if (entries.has("Cargo.toml")) {
    if (commandExists("rust-analyzer")) {
      return { language: "Rust", status: "available", detail: "rust-analyzer detected" };
    }
    return { language: "Rust", status: "missing", detail: "install rust-analyzer" };
  }

  return null;
}

export function detectProjectContext(workingDir: string): ProjectContextSummary {
  const entries = readRootEntries(workingDir);
  const packageJson = readPackageJson(workingDir);

  return {
    manifests: MANIFEST_FILES.filter((name) => entries.has(name)),
    lockfiles: LOCKFILE_TO_PACKAGE_MANAGER.map(({ file }) => file).filter((name) => entries.has(name)),
    packageManager: getPackageManager(entries, packageJson),
    frameworks: collectFrameworks(packageJson),
    scripts: collectScripts(packageJson),
    keyConfigs: KEY_CONFIG_FILES.filter((name) => entries.has(name)),
    lsp: detectLspStatus(entries),
  };
}

export function formatPromptProjectContext(workingDir: string): string {
  const context = detectProjectContext(workingDir);
  const hasSignal = context.manifests.length > 0
    || context.lockfiles.length > 0
    || context.packageManager
    || context.frameworks.length > 0
    || context.scripts.length > 0
    || context.keyConfigs.length > 0
    || context.lsp;

  if (!hasSignal) return "";

  const lines = ["\n\n## Project Context"];
  if (context.packageManager) lines.push(`- Package manager: ${context.packageManager}`);
  if (context.manifests.length > 0) lines.push(`- Manifests: ${context.manifests.join(", ")}`);
  if (context.lockfiles.length > 0) lines.push(`- Lockfiles: ${context.lockfiles.join(", ")}`);
  if (context.frameworks.length > 0) lines.push(`- Detected stack: ${context.frameworks.join(", ")}`);
  if (context.scripts.length > 0) {
    lines.push(`- Useful scripts: ${context.scripts.map((script) => `${script.name}="${script.command}"`).join("; ")}`);
  }
  if (context.keyConfigs.length > 0) lines.push(`- Key config files: ${context.keyConfigs.join(", ")}`);
  if (context.lsp) {
    lines.push(`- LSP: ${context.lsp.language} ${context.lsp.status === "available" ? "available" : "not available"} (${context.lsp.detail})`);
  }
  lines.push("- Treat this as a starting summary. Verify critical details with tools before acting.");
  lines.push("\n---");

  return lines.join("\n");
}
