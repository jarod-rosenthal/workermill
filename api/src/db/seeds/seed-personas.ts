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
  }
> = {
  backend_developer: {
    name: "Backend Developer",
    emoji: "⚙️",
    color: "#3B82F6",
    shortLabel: "Backend",
    description:
      "Specializes in REST APIs, database design, server-side logic, and backend architecture",
    priority: 1,
    skills: ["api", "database", "typescript", "node", "express", "postgres"],
    riskLevel: "medium",
  },
  frontend_developer: {
    name: "Frontend Developer",
    emoji: "🎨",
    color: "#8B5CF6",
    shortLabel: "Frontend",
    description:
      "Specializes in React, UI components, CSS, and responsive design",
    priority: 2,
    skills: ["react", "typescript", "tailwind", "html", "css", "ui"],
    riskLevel: "low",
  },
  devops_engineer: {
    name: "DevOps Engineer",
    emoji: "🔧",
    color: "#F59E0B",
    shortLabel: "DevOps",
    description:
      "Specializes in CI/CD, Docker, Kubernetes, Terraform, and cloud infrastructure",
    priority: 3,
    skills: ["docker", "kubernetes", "terraform", "aws", "ci-cd", "infrastructure"],
    riskLevel: "high",
  },
  security_engineer: {
    name: "Security Engineer",
    emoji: "🛡️",
    color: "#EF4444",
    shortLabel: "Security",
    description:
      "Specializes in security audits, vulnerability assessment, and secure coding practices",
    priority: 4,
    skills: ["security", "owasp", "audit", "penetration-testing", "compliance"],
    riskLevel: "high",
  },
  qa_engineer: {
    name: "QA Engineer",
    emoji: "🧪",
    color: "#10B981",
    shortLabel: "QA",
    description:
      "Specializes in test automation, integration testing, and quality assurance",
    priority: 5,
    skills: ["testing", "jest", "playwright", "cypress", "automation"],
    riskLevel: "low",
  },
  tech_writer: {
    name: "Technical Writer",
    emoji: "📝",
    color: "#6366F1",
    shortLabel: "Tech Writer",
    description:
      "Specializes in documentation, API docs, and technical communication",
    priority: 6,
    skills: ["documentation", "markdown", "api-docs", "guides"],
    riskLevel: "low",
  },
  project_manager: {
    name: "Project Manager",
    emoji: "📊",
    color: "#EC4899",
    shortLabel: "PM",
    description:
      "Specializes in project planning, task breakdown, and coordination",
    priority: 7,
    skills: ["planning", "jira", "agile", "coordination"],
    riskLevel: "low",
  },
  api_developer: {
    name: "API Developer",
    emoji: "🔌",
    color: "#0EA5E9",
    shortLabel: "API",
    description:
      "Specializes in API design, OpenAPI specs, and integration development",
    priority: 8,
    skills: ["api", "rest", "graphql", "openapi", "swagger"],
    riskLevel: "medium",
  },
  data_engineer: {
    name: "Data Engineer",
    emoji: "📈",
    color: "#14B8A6",
    shortLabel: "Data",
    description:
      "Specializes in data pipelines, ETL, analytics, and data modeling",
    priority: 9,
    skills: ["sql", "etl", "analytics", "data-modeling", "python"],
    riskLevel: "medium",
  },
  database_administrator: {
    name: "Database Administrator",
    emoji: "🗄️",
    color: "#8B5CF6",
    shortLabel: "DBA",
    description:
      "Specializes in database administration, optimization, and migrations",
    priority: 10,
    skills: ["postgres", "mysql", "migrations", "optimization", "backup"],
    riskLevel: "high",
  },
  ml_engineer: {
    name: "ML Engineer",
    emoji: "🤖",
    color: "#F97316",
    shortLabel: "ML",
    description:
      "Specializes in machine learning, model training, and AI integration",
    priority: 11,
    skills: ["python", "tensorflow", "pytorch", "machine-learning", "ai"],
    riskLevel: "medium",
  },
  mobile_developer_android: {
    name: "Android Developer",
    emoji: "📱",
    color: "#22C55E",
    shortLabel: "Android",
    description:
      "Specializes in Android app development with Kotlin and Java",
    priority: 12,
    skills: ["android", "kotlin", "java", "mobile", "gradle"],
    riskLevel: "medium",
  },
  mobile_developer_ios: {
    name: "iOS Developer",
    emoji: "🍎",
    color: "#3B82F6",
    shortLabel: "iOS",
    description:
      "Specializes in iOS app development with Swift and SwiftUI",
    priority: 13,
    skills: ["ios", "swift", "swiftui", "xcode", "mobile"],
    riskLevel: "medium",
  },
  tech_lead: {
    name: "Tech Lead",
    emoji: "🎯",
    color: "#7C3AED",
    shortLabel: "Tech Lead",
    description:
      "Leads technical decisions, architecture reviews, and team coordination",
    priority: 14,
    skills: ["architecture", "code-review", "mentoring", "planning", "coordination"],
    riskLevel: "medium",
  },
  manager: {
    name: "Manager",
    emoji: "👔",
    color: "#6B7280",
    shortLabel: "Manager",
    description:
      "Virtual manager for code review and task approval workflows",
    priority: 0,
    skills: ["review", "approval", "quality-gate"],
    riskLevel: "low",
  },
};

// Default config for unknown personas
const DEFAULT_CONFIG = {
  name: "Unknown Persona",
  emoji: "🤖",
  color: "#6B7280",
  shortLabel: "Worker",
  description: "AI worker persona",
  priority: 99,
  skills: [],
  riskLevel: "medium" as const,
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
        });
        await personaRepo.save(persona);
        personasCreated++;
        logger.info(`Created persona: ${persona.name}`, { slug: persona.slug });
      } else {
        logger.info(`Persona already exists: ${persona.name}`, {
          slug: persona.slug,
        });
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
        color: "#6B7280",
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
