/**
 * Seed System Personas
 *
 * Imports file-based personas and directives into the database.
 * Run with: npx tsx src/db/seeds/seed-personas.ts
 */

import { readdir, readFile } from "fs/promises";
import { join, resolve } from "path";
import { IsNull } from "typeorm";
import { AppDataSource } from "../connection.js";
import { Persona, PersonaDirective } from "../../models/index.js";
import { logger } from "../../utils/logger.js";

// Persona metadata configuration
const PERSONA_CONFIG: Record<
  string,
  {
    name: string;
    emoji: string;
    color: string;
    shortLabel: string;
    description: string;
    priority: number;
    skills: string[];
    riskLevel: "low" | "medium" | "high";
    keywordPattern: string;
    labelShortcuts: string[];
  }
> = {
  backend_developer: {
    name: "Backend Developer",
    emoji: "💻",
    color: "***REMOVED***3B82F6",
    shortLabel: "Backend",
    description:
      "Specializes in REST APIs, database design, server-side logic, and backend architecture",
    priority: 1,
    skills: [
      "api",
      "database",
      "typescript",
      "node",
      "express",
      "postgres",
      "graphql",
      "openapi",
      "query-optimization",
    ],
    riskLevel: "medium",
    keywordPattern:
      "api|endpoint|typeorm|sql|backend|server|lambda|express|route|controller|database|migration|model|rest api|graphql|openapi|swagger|sdk|api design|api contract|endpoint design|api versioning|dba|database admin|postgres|mysql|index|indexing|query optimization|replication|backup|recovery|schema",
    labelShortcuts: ["backend", "api", "dba", "database"],
  },
  frontend_developer: {
    name: "Frontend Developer",
    emoji: "🎨",
    color: "***REMOVED***8B5CF6",
    shortLabel: "Frontend",
    description:
      "Specializes in React, UI components, CSS, and responsive design",
    priority: 2,
    skills: ["react", "typescript", "tailwind", "html", "css", "ui"],
    riskLevel: "low",
    keywordPattern:
      "react|component|ui|ux|frontend|css|tailwind|mobile|react native|expo|vite|tailwindcss|button|form|modal|page|screen",
    labelShortcuts: ["frontend"],
  },
  devops_engineer: {
    name: "DevOps Engineer",
    emoji: "🔧",
    color: "***REMOVED***F59E0B",
    shortLabel: "DevOps",
    description:
      "Specializes in CI/CD, Docker, Kubernetes, Terraform, and cloud infrastructure",
    priority: 3,
    skills: ["docker", "kubernetes", "terraform", "aws", "ci-cd", "infrastructure"],
    riskLevel: "high",
    keywordPattern:
      "terraform|infrastructure|cicd|deployment|docker|kubernetes|aws|cloudfront|s3|rds|cloudwatch|ecs|ecr|vpc|iam|github actions",
    labelShortcuts: ["devops", "infra", "infrastructure"],
  },
  security_engineer: {
    name: "Security Engineer",
    emoji: "🛡️",
    color: "***REMOVED***EF4444",
    shortLabel: "Security",
    description:
      "Specializes in security audits, vulnerability assessment, and secure coding practices",
    priority: 4,
    skills: ["security", "owasp", "audit", "penetration-testing", "compliance"],
    riskLevel: "high",
    keywordPattern:
      "security|vulnerability|cve|encryption|authentication|authorization|cors|xss|sql injection|owasp|audit",
    labelShortcuts: ["security"],
  },
  qa_engineer: {
    name: "QA Engineer",
    emoji: "🧪",
    color: "***REMOVED***10B981",
    shortLabel: "QA",
    description:
      "Specializes in test automation, integration testing, and quality assurance",
    priority: 5,
    skills: ["testing", "jest", "playwright", "cypress", "automation"],
    riskLevel: "low",
    keywordPattern:
      "test|testing|qa|e2e|unit test|integration test|playwright|jest|coverage|spec|fixture",
    labelShortcuts: ["qa", "testing"],
  },
  tech_writer: {
    name: "Technical Writer",
    emoji: "📝",
    color: "***REMOVED***6366F1",
    shortLabel: "Tech Writer",
    description:
      "Specializes in documentation, API docs, and technical communication",
    priority: 6,
    skills: ["documentation", "markdown", "api-docs", "guides"],
    riskLevel: "low",
    keywordPattern:
      "documentation|docs|readme|guide|tutorial|api docs|openapi|docusaurus|jsdoc",
    labelShortcuts: ["docs", "documentation"],
  },
  project_manager: {
    name: "Project Manager",
    emoji: "📊",
    color: "***REMOVED***EC4899",
    shortLabel: "PM",
    description:
      "Specializes in project planning, task breakdown, and coordination",
    priority: 7,
    skills: ["planning", "jira", "agile", "coordination"],
    riskLevel: "low",
    keywordPattern:
      "roadmap|planning|coordination|milestone|sprint|epic|backlog|estimate|priorit",
    labelShortcuts: ["pm"],
  },
  architect: {
    name: "Architect",
    emoji: "🏗️",
    color: "***REMOVED***7C3AED",
    shortLabel: "Architect",
    description:
      "Specializes in system decomposition, task planning, codebase analysis, and architecture design",
    priority: 0,
    skills: [
      "system-design",
      "decomposition",
      "planning",
      "architecture",
      "tradeoffs",
    ],
    riskLevel: "medium",
    keywordPattern:
      "architecture|system design|decompose|plan|technical design|tradeoff|rfc",
    labelShortcuts: ["architect"],
  },
  data_ml_engineer: {
    name: "Data & ML Engineer",
    emoji: "📊",
    color: "***REMOVED***14B8A6",
    shortLabel: "Data/ML",
    description:
      "Specializes in data pipelines, ETL, analytics, machine learning, model training, and MLOps",
    priority: 8,
    skills: [
      "sql",
      "etl",
      "python",
      "machine-learning",
      "mlops",
      "data-modeling",
    ],
    riskLevel: "medium",
    keywordPattern:
      "etl|pipeline|data pipeline|dbt|airflow|dagster|kafka|streaming|data warehouse|data lake|spark|machine learning|ml|tensorflow|pytorch|model|training|llm|ai model|mlops|feature engineering",
    labelShortcuts: ["data", "ml", "etl", "ai"],
  },
  mobile_developer: {
    name: "Mobile Developer",
    emoji: "📱",
    color: "***REMOVED***22C55E",
    shortLabel: "Mobile",
    description:
      "Specializes in iOS (Swift, SwiftUI) and Android (Kotlin, Jetpack Compose) development",
    priority: 9,
    skills: [
      "ios",
      "android",
      "swift",
      "kotlin",
      "react-native",
      "mobile",
    ],
    riskLevel: "medium",
    keywordPattern:
      "ios|swift|swiftui|uikit|xcode|cocoapods|core data|apple|iphone|ipad|android|kotlin|jetpack|compose|gradle|room|retrofit|hilt|dagger|google play|react native|flutter",
    labelShortcuts: ["ios", "android", "mobile"],
  },
  tech_lead: {
    name: "Tech Lead",
    emoji: "🎯",
    color: "***REMOVED***7C3AED",
    shortLabel: "Tech Lead",
    description:
      "Leads technical decisions, architecture reviews, and team coordination",
    priority: 14,
    skills: ["architecture", "code-review", "mentoring", "planning", "coordination"],
    riskLevel: "medium",
    keywordPattern:
      "review|architecture|code review|pr review|tech lead|lead|architect|design pattern|refactor|technical debt",
    labelShortcuts: ["lead", "techlead", "architect"],
  },
  manager: {
    name: "Manager",
    emoji: "👔",
    color: "***REMOVED***6B7280",
    shortLabel: "Manager",
    description:
      "Virtual manager for code review and task approval workflows",
    priority: 0,
    skills: ["review", "approval", "quality-gate"],
    riskLevel: "low",
    keywordPattern:
      "manage|management|manager|oversee|delegate|strategy|stakeholder|resource allocation",
    labelShortcuts: ["manager"],
  },
  support_agent: {
    name: "Support Agent",
    emoji: "💬",
    color: "***REMOVED***06B6D4",
    shortLabel: "Support",
    description:
      "Customer support agent for answering questions and triaging issues",
    priority: 15,
    keywordPattern:
      "support|customer|triage|troubleshoot|help|ticket|incident|respond",
    labelShortcuts: ["support"],
    skills: ["support", "documentation", "troubleshooting", "triage"],
    riskLevel: "low",
  },
};

// Default config for unknown personas
const DEFAULT_CONFIG = {
  name: "Unknown Persona",
  emoji: "🤖",
  color: "***REMOVED***6B7280",
  shortLabel: "Worker",
  description: "AI worker persona",
  priority: 99,
  skills: [] as string[],
  riskLevel: "medium" as const,
  keywordPattern: null as string | null,
  labelShortcuts: [] as string[],
};

async function seedPersonas() {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");

    const personaRepo = AppDataSource.getRepository(Persona);
    const directiveRepo = AppDataSource.getRepository(PersonaDirective);

    // Find directives directory (relative to api/)
    const directivesPath = resolve(
      process.cwd(),
      "..",
      "worker",
      "directives"
    );
    logger.info("Reading directives from", { path: directivesPath });

    // Get all persona directories
    const entries = await readdir(directivesPath, { withFileTypes: true });
    const personaDirs = entries
      .filter((e) => e.isDirectory() && e.name !== "common")
      .map((e) => e.name);

    logger.info(`Found ${personaDirs.length} persona directories`, {
      personas: personaDirs,
    });

    let personasCreated = 0;
    let directivesCreated = 0;

    // Process each persona
    for (const slug of personaDirs) {
      const config = PERSONA_CONFIG[slug] || {
        ...DEFAULT_CONFIG,
        name: slug
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      };

      // Check if persona already exists
      let persona = await personaRepo.findOne({
        where: { slug, orgId: IsNull() }, // System personas have null orgId
      });

      if (!persona) {
        // Create system persona
        persona = personaRepo.create({
          orgId: null,
          slug,
          name: config.name,
          emoji: config.emoji,
          color: config.color,
          shortLabel: config.shortLabel,
          description: config.description,
          enabled: true,
          isSystem: true,
          priority: config.priority,
          skills: config.skills,
          riskLevel: config.riskLevel,
          keywordPattern: config.keywordPattern || null,
          labelShortcuts: config.labelShortcuts || null,
        });
        await personaRepo.save(persona);
        personasCreated++;
        logger.info(`Created persona: ${persona.name}`, { slug: persona.slug });
      } else {
        // Update existing persona with new fields if missing
        let needsUpdate = false;
        if (config.keywordPattern && !persona.keywordPattern) {
          persona.keywordPattern = config.keywordPattern;
          needsUpdate = true;
        }
        if (config.labelShortcuts && !persona.labelShortcuts) {
          persona.labelShortcuts = config.labelShortcuts;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await personaRepo.save(persona);
          logger.info(`Updated persona with keyword pattern: ${persona.name}`, {
            slug: persona.slug,
          });
        } else {
          logger.info(`Persona already exists: ${persona.name}`, {
            slug: persona.slug,
          });
        }
      }

      // Read and import README.md directive
      const readmePath = join(directivesPath, slug, "README.md");
      try {
        const content = await readFile(readmePath, "utf-8");

        // Check if directive already exists
        const existingDirective = await directiveRepo.findOne({
          where: {
            personaId: persona.id,
            type: "readme",
            isActive: true,
          },
        });

        if (!existingDirective) {
          const directive = directiveRepo.create({
            personaId: persona.id,
            type: "readme",
            filename: null,
            content,
            version: 1,
            isActive: true,
            createdById: null,
            changeSummary: "Initial import from file system",
          });
          await directiveRepo.save(directive);
          directivesCreated++;
          logger.info(`Created README directive for ${slug}`);
        } else {
          logger.info(`README directive already exists for ${slug}`);
        }
      } catch (error) {
        logger.warn(`No README.md found for ${slug}`);
      }
    }

    // Import common directives
    const commonPath = join(directivesPath, "common");
    const commonFiles = await readdir(commonPath);

    // Get or create common pseudo-persona
    let commonPersona = await personaRepo.findOne({
      where: { slug: "__common__", orgId: IsNull() },
    });

    if (!commonPersona) {
      commonPersona = personaRepo.create({
        orgId: null,
        slug: "__common__",
        name: "Common Directives",
        emoji: "📚",
        color: "***REMOVED***6B7280",
        description: "Shared directives available to all personas",
        enabled: true,
        isSystem: true,
        priority: -1,
      });
      await personaRepo.save(commonPersona);
      personasCreated++;
      logger.info("Created common directives pseudo-persona");
    }

    // Import common directive files
    for (const filename of commonFiles) {
      if (!filename.endsWith(".md")) continue;

      const filePath = join(commonPath, filename);
      const content = await readFile(filePath, "utf-8");

      // Check if directive already exists
      const existingDirective = await directiveRepo.findOne({
        where: {
          personaId: commonPersona.id,
          type: "common",
          filename,
          isActive: true,
        },
      });

      if (!existingDirective) {
        const directive = directiveRepo.create({
          personaId: commonPersona.id,
          type: "common",
          filename,
          content,
          version: 1,
          isActive: true,
          createdById: null,
          changeSummary: "Initial import from file system",
        });
        await directiveRepo.save(directive);
        directivesCreated++;
        logger.info(`Created common directive: ${filename}`);
      } else {
        logger.info(`Common directive already exists: ${filename}`);
      }
    }

    console.log("\n=== Persona Seed Complete ===");
    console.log(`Personas created: ${personasCreated}`);
    console.log(`Directives created: ${directivesCreated}`);
    console.log("");

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    logger.error("Persona seed failed", { error });
    console.error(error);
    process.exit(1);
  }
}

seedPersonas();
