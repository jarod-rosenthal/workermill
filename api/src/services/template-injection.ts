/**
 * Template Injection Service
 *
 * Handles Step 0 template injection for V2 Pipeline.
 * Copies pre-built scaffolds to target repositories and
 * replaces placeholders with project-specific values.
 */

import { promises as fs } from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import type { TechStackV2 } from "./pipeline-v2-types.js";

// Template directory relative to the worker container
const TEMPLATES_DIR = "/app/templates";

// Available template IDs
export type TemplateId =
  | "react-vite-typescript"
  | "fastapi-python"
  | "express-typescript"
  | "nextjs-typescript";

// Template variable placeholders
interface TemplateVariables {
  PROJECT_NAME: string;
  PROJECT_DESCRIPTION?: string;
}

/**
 * Check if a template exists
 */
export async function templateExists(templateId: TemplateId): Promise<boolean> {
  try {
    const templatePath = path.join(TEMPLATES_DIR, templateId);
    await fs.access(templatePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of all files in a template directory (recursively)
 */
async function getTemplateFiles(
  templatePath: string,
  basePath: string = ""
): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(templatePath, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(basePath, entry.name);
    const fullPath = path.join(templatePath, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, .git, etc.
      if (["node_modules", ".git", "__pycache__", ".next", "dist"].includes(entry.name)) {
        continue;
      }
      const subFiles = await getTemplateFiles(fullPath, relativePath);
      files.push(...subFiles);
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Replace template variables in content
 */
function replaceVariables(content: string, variables: TemplateVariables): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(value || "");
  }
  return result;
}

/**
 * Generate template files with variables replaced
 *
 * Returns a map of relative file path -> file content
 * This can be used to commit files to a git repo
 */
export async function generateTemplateFiles(
  templateId: TemplateId,
  variables: TemplateVariables
): Promise<Map<string, string>> {
  const templatePath = path.join(TEMPLATES_DIR, templateId);

  if (!(await templateExists(templateId))) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const files = await getTemplateFiles(templatePath);
  const result = new Map<string, string>();

  for (const relativePath of files) {
    const fullPath = path.join(templatePath, relativePath);
    const content = await fs.readFile(fullPath, "utf-8");
    const processedContent = replaceVariables(content, variables);
    result.set(relativePath, processedContent);
  }

  logger.info(`Generated ${result.size} template files`, {
    templateId,
    projectName: variables.PROJECT_NAME,
  });

  return result;
}

/**
 * Get the appropriate template ID based on tech stack
 */
export function selectTemplate(techStack: TechStackV2): TemplateId | null {
  // Explicit template ID takes precedence
  if (techStack.templateId) {
    return techStack.templateId;
  }

  // Auto-select based on framework and language
  const { framework, language, buildTool } = techStack;

  if (framework === "react" && buildTool === "vite" && language === "typescript") {
    return "react-vite-typescript";
  }
  if (framework === "fastapi" && language === "python") {
    return "fastapi-python";
  }
  if (framework === "express" && language === "typescript") {
    return "express-typescript";
  }
  if (framework === "nextjs" && language === "typescript") {
    return "nextjs-typescript";
  }

  // No matching template
  return null;
}

/**
 * Create shell script for template injection
 *
 * This generates a shell script that the worker can execute
 * to copy template files into the repository
 */
export function generateInjectionScript(
  templateId: TemplateId,
  variables: TemplateVariables
): string {
  const escapedName = variables.PROJECT_NAME.replace(/'/g, "'\\''");
  const escapedDesc = (variables.PROJECT_DESCRIPTION || "").replace(/'/g, "'\\''");

  return `***REMOVED***!/bin/bash
***REMOVED*** Step 0: Template Injection
***REMOVED*** Template: ${templateId}
***REMOVED*** Project: ${variables.PROJECT_NAME}

set -e

TEMPLATE_DIR="/app/templates/${templateId}"
PROJECT_NAME='${escapedName}'
PROJECT_DESCRIPTION='${escapedDesc}'

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "ERROR: Template not found: $TEMPLATE_DIR"
  exit 1
fi

echo "Injecting template: ${templateId}"

***REMOVED*** Copy all template files
cp -r "$TEMPLATE_DIR"/* .
cp -r "$TEMPLATE_DIR"/.* . 2>/dev/null || true

***REMOVED*** Replace placeholders in all files
find . -type f \\( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.toml" -o -name "*.md" -o -name "*.html" -o -name "*.yml" -o -name "*.yaml" \\) | while read file; do
  if [ -f "$file" ]; then
    sed -i "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" "$file"
    sed -i "s/{{PROJECT_DESCRIPTION}}/$PROJECT_DESCRIPTION/g" "$file"
  fi
done

echo "Template injection complete"
echo "Files injected:"
find . -type f | head -20

***REMOVED*** Commit the scaffold
git add -A
git commit -m "Initial scaffold from ${templateId} template"

echo "Step 0 complete - scaffold committed"
`;
}

/**
 * Get template metadata
 */
export function getTemplateMetadata(templateId: TemplateId): {
  name: string;
  description: string;
  stack: string[];
  testCommand: string;
  buildCommand: string;
} {
  const metadata: Record<TemplateId, ReturnType<typeof getTemplateMetadata>> = {
    "react-vite-typescript": {
      name: "React + Vite + TypeScript",
      description: "Modern React SPA with Vite bundler and TypeScript",
      stack: ["React 18", "Vite", "TypeScript", "Tailwind CSS", "Vitest"],
      testCommand: "npm run test:run",
      buildCommand: "npm run build",
    },
    "fastapi-python": {
      name: "FastAPI + Python",
      description: "High-performance Python API with FastAPI and Pydantic",
      stack: ["FastAPI", "Python 3.11", "Pydantic", "pytest"],
      testCommand: "pytest",
      buildCommand: "echo 'No build step needed for Python'",
    },
    "express-typescript": {
      name: "Express + TypeScript",
      description: "Node.js API with Express and TypeScript",
      stack: ["Express", "TypeScript", "Vitest"],
      testCommand: "npm run test:run",
      buildCommand: "npm run build",
    },
    "nextjs-typescript": {
      name: "Next.js + TypeScript",
      description: "Full-stack React with Next.js App Router",
      stack: ["Next.js 14", "TypeScript", "Tailwind CSS", "Vitest"],
      testCommand: "npm run test:run",
      buildCommand: "npm run build",
    },
  };

  return metadata[templateId];
}

/**
 * Validate that a template has required files
 */
export async function validateTemplate(templateId: TemplateId): Promise<{
  valid: boolean;
  missingFiles: string[];
}> {
  const required: Record<TemplateId, string[]> = {
    "react-vite-typescript": ["package.json", "tsconfig.json", "vite.config.ts", "src/App.tsx"],
    "fastapi-python": ["pyproject.toml", "src/main.py", "tests/conftest.py"],
    "express-typescript": ["package.json", "tsconfig.json", "src/index.ts"],
    "nextjs-typescript": ["package.json", "tsconfig.json", "next.config.mjs", "src/app/page.tsx"],
  };

  const templatePath = path.join(TEMPLATES_DIR, templateId);
  const missingFiles: string[] = [];

  for (const file of required[templateId]) {
    const filePath = path.join(templatePath, file);
    try {
      await fs.access(filePath);
    } catch {
      missingFiles.push(file);
    }
  }

  return {
    valid: missingFiles.length === 0,
    missingFiles,
  };
}
