/**
 * Starter Projects
 *
 * Curated example descriptions that users can select as their first project.
 * Prevents trivial tasks ("fix this typo") from being the first impression.
 * Each starter project is pre-mapped to a stack template.
 */

import { CACHED_PLANS, type CachedPlanData } from "./cached-plans.js";

export interface StarterProject {
  id: string;
  title: string;
  description: string;
  stackTemplate: string;
  complexity: "simple" | "medium" | "complex";
  estimatedStories: number;
  tags: string[];
}

export interface StarterProjectWithPlan extends StarterProject {
  cachedPlan?: CachedPlanData;
}

/**
 * Returns starter projects with their cached plans attached.
 */
export function getStarterProjectsWithPlans(): StarterProjectWithPlan[] {
  return STARTER_PROJECTS.map((p) => ({
    ...p,
    cachedPlan: CACHED_PLANS[p.id],
  }));
}

export const STARTER_PROJECTS: StarterProject[] = [
  {
    id: "saas-dashboard",
    title: "SaaS Analytics Dashboard",
    description:
      "Build a multi-tenant analytics dashboard with user authentication, " +
      "team management, and interactive charts. Users can sign up, create " +
      "organizations, invite team members, and view real-time metrics. " +
      "Include role-based access control (admin, member, viewer), a " +
      "settings page for organization config, and a responsive layout " +
      "that works on desktop and tablet.",
    stackTemplate: "nextjs-prisma",
    complexity: "medium",
    estimatedStories: 8,
    tags: ["saas", "dashboard", "auth", "charts"],
  },
  {
    id: "rest-api",
    title: "REST API with Auth & Docs",
    description:
      "Build a production REST API with JWT authentication, input validation, " +
      "rate limiting, and auto-generated OpenAPI documentation. Include user " +
      "registration and login endpoints, CRUD operations for a resource " +
      "(e.g., posts or products), pagination and filtering, and comprehensive " +
      "error handling with proper HTTP status codes.",
    stackTemplate: "fastapi-react",
    complexity: "simple",
    estimatedStories: 6,
    tags: ["api", "auth", "docs"],
  },
  {
    id: "ecommerce-store",
    title: "E-Commerce Storefront",
    description:
      "Build an online store with product catalog, shopping cart, and checkout " +
      "flow. Include product listing with search and category filters, product " +
      "detail pages with image gallery, a persistent shopping cart, Stripe " +
      "checkout integration, order confirmation, and an admin panel for " +
      "managing products and viewing orders.",
    stackTemplate: "nextjs-prisma",
    complexity: "complex",
    estimatedStories: 12,
    tags: ["ecommerce", "payments", "catalog", "cart"],
  },
  {
    id: "blog-platform",
    title: "Blog Platform with CMS",
    description:
      "Build a blog platform with a markdown editor, post publishing workflow, " +
      "and public-facing blog pages. Authors can write posts in markdown with " +
      "live preview, save drafts, publish/unpublish, and manage tags. The " +
      "public site has an index page, individual post pages with SEO meta " +
      "tags, tag filtering, and an RSS feed.",
    stackTemplate: "django-react",
    complexity: "medium",
    estimatedStories: 8,
    tags: ["blog", "cms", "markdown", "seo"],
  },
  {
    id: "project-tracker",
    title: "Project Management Board",
    description:
      "Build a Kanban-style project management tool with drag-and-drop " +
      "columns, task cards, and team collaboration. Include boards with " +
      "customizable columns (To Do, In Progress, Done), task creation with " +
      "title, description, assignee, and due date, drag-and-drop reordering, " +
      "and real-time updates when team members move cards.",
    stackTemplate: "express-react",
    complexity: "medium",
    estimatedStories: 9,
    tags: ["project-management", "kanban", "realtime", "collaboration"],
  },
  {
    id: "cli-tool",
    title: "Developer CLI Tool",
    description:
      "Build a command-line tool with subcommands, configuration management, " +
      "and interactive prompts. Include an init command that scaffolds a " +
      "project, a config command for managing settings in a dotfile, a run " +
      "command that executes a workflow, colorized output with progress " +
      "spinners, and comprehensive --help documentation.",
    stackTemplate: "go-htmx",
    complexity: "simple",
    estimatedStories: 5,
    tags: ["cli", "developer-tools", "automation"],
  },
];

/**
 * Look up a starter project by ID. Returns undefined if not found.
 */
export function getStarterProject(id: string): StarterProject | undefined {
  return STARTER_PROJECTS.find((p) => p.id === id);
}
