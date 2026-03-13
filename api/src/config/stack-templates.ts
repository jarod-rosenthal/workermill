/**
 * Stack Templates
 *
 * Pre-defined technology stack configurations that constrain the planning agent.
 * Used on the Build page to let users pick a stack, and injected into planning
 * prompts so the planner generates stories using the right technologies.
 */

export interface TechStack {
  language: string;
  framework: string;
  styling?: string;
  database?: string;
  orm?: string;
  testing: string;
  rationale: string;
}

export interface QualityThresholds {
  minQualityScore: number;
  blockOnTypeErrors: boolean;
  blockOnLintErrors: boolean;
}

export interface StackTemplate {
  id: string;
  name: string;
  description: string;
  techStack: TechStack;
  defaultPersonas: string[];
  qualityThresholds: QualityThresholds;
}

export const STACK_TEMPLATES: StackTemplate[] = [
  {
    id: "nextjs-prisma",
    name: "Next.js + Prisma + Tailwind",
    description: "Full-stack TypeScript with Next.js App Router, Prisma ORM, TailwindCSS",
    techStack: {
      language: "typescript",
      framework: "next.js",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "prisma",
      testing: "vitest",
      rationale: "Modern full-stack TypeScript with excellent DX and type safety",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: true, blockOnLintErrors: true },
  },
  {
    id: "django-react",
    name: "Django + React + PostgreSQL",
    description: "Python backend with Django REST Framework, React frontend, PostgreSQL",
    techStack: {
      language: "python",
      framework: "django",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "django-orm",
      testing: "pytest",
      rationale: "Battle-tested Python backend with rich ecosystem and React frontend",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: false, blockOnLintErrors: true },
  },
  {
    id: "fastapi-react",
    name: "FastAPI + React + SQLAlchemy",
    description: "High-performance async Python API with React frontend, SQLAlchemy ORM",
    techStack: {
      language: "python",
      framework: "fastapi",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "sqlalchemy",
      testing: "pytest",
      rationale: "Modern async Python with automatic OpenAPI docs and type hints",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: false, blockOnLintErrors: true },
  },
  {
    id: "express-react",
    name: "Express + React + TypeORM",
    description: "Node.js backend with Express, React frontend, TypeORM with PostgreSQL",
    techStack: {
      language: "typescript",
      framework: "express",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "typeorm",
      testing: "vitest",
      rationale: "Familiar Node.js stack with TypeScript end-to-end",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: true, blockOnLintErrors: true },
  },
  {
    id: "rails-react",
    name: "Rails + React + PostgreSQL",
    description: "Ruby on Rails API backend with React frontend, PostgreSQL database",
    techStack: {
      language: "ruby",
      framework: "rails",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "activerecord",
      testing: "rspec",
      rationale: "Convention-over-configuration with rapid prototyping and mature ecosystem",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 65, blockOnTypeErrors: false, blockOnLintErrors: true },
  },
  {
    id: "flask-htmx",
    name: "Flask + HTMX + SQLAlchemy",
    description: "Lightweight Python backend with HTMX for interactivity, minimal JavaScript",
    techStack: {
      language: "python",
      framework: "flask",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "sqlalchemy",
      testing: "pytest",
      rationale: "Simple server-rendered approach with progressive enhancement",
    },
    defaultPersonas: ["backend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 65, blockOnTypeErrors: false, blockOnLintErrors: true },
  },
  {
    id: "go-htmx",
    name: "Go + HTMX + Templ",
    description: "Go backend with HTMX and Templ templates, minimal JavaScript",
    techStack: {
      language: "go",
      framework: "chi",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "sqlc",
      testing: "go-test",
      rationale: "Fast compiled backend with type-safe SQL and server-rendered UI",
    },
    defaultPersonas: ["backend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: true, blockOnLintErrors: true },
  },
  {
    id: "spring-boot-react",
    name: "Spring Boot + React + JPA",
    description: "Java Spring Boot backend with React frontend, JPA/Hibernate ORM",
    techStack: {
      language: "java",
      framework: "spring-boot",
      styling: "tailwindcss",
      database: "postgresql",
      orm: "jpa",
      testing: "junit",
      rationale: "Enterprise-grade Java backend with rich Spring ecosystem",
    },
    defaultPersonas: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"],
    qualityThresholds: { minQualityScore: 70, blockOnTypeErrors: true, blockOnLintErrors: true },
  },
];

/**
 * Look up a stack template by ID. Returns undefined if not found.
 */
export function getStackTemplate(id: string): StackTemplate | undefined {
  return STACK_TEMPLATES.find((t) => t.id === id);
}
