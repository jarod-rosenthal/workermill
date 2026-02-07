import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedShowcaseProjects1706688000024 implements MigrationInterface {
  name = "SeedShowcaseProjects1706688000024";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Only seed if table is empty
    const existing = await queryRunner.query(
      `SELECT COUNT(*) as count FROM showcase_projects`
    );
    if (parseInt(existing[0].count) > 0) return;

    await queryRunner.query(`
      INSERT INTO showcase_projects (name, tagline, description, stack, story_count, cost, duration, repo_url, live_url, task_log_url, category, is_featured, display_order, build_metadata, stories) VALUES
      (
        'OnCallShift',
        'Production incident management platform — built entirely by WorkerMill.',
        'Complete rebuild of a production incident management platform: on-call scheduling, alert routing, escalation policies, real-time dashboards, mobile app, and Terraform infrastructure. 78 database models, 46 API routes, 60 frontend pages, 31 mobile screens.',
        'Express + TypeScript + React + React Native + Terraform',
        105,
        '$142.00',
        '~18 hrs',
        'https://github.com/jarod-rosenthal/oncallshift',
        'https://oncallshift.com',
        NULL,
        'incident-management',
        true,
        0,
        '{"storyCount": 105, "personasUsed": ["backend_developer", "frontend_developer", "devops_engineer", "security_engineer", "qa_engineer", "tech_writer"], "qualityScores": {"lint": "0 errors", "types": "0 errors", "tests": ">80% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'TeamBoard',
        'Multi-tenant SaaS project management with Kanban boards.',
        'Full-stack SaaS with multi-tenancy, RBAC, drag-and-drop Kanban boards, real-time updates, workspace dashboards with charts, and activity feeds. Deployed to Vercel with Neon PostgreSQL.',
        'Next.js + Prisma + TailwindCSS',
        10,
        '$14.20',
        '48 min',
        'https://github.com/workermill-examples/teamboard',
        NULL,
        NULL,
        'saas',
        false,
        1,
        '{"storyCount": 10, "personasUsed": ["backend_developer", "frontend_developer", "qa_engineer"], "qualityScores": {"lint": "0 errors", "types": "0 errors", "tests": ">60% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'ShipAPI',
        'Production REST API with auto-generated docs, deployed to AWS via Terraform.',
        'Inventory management API with JWT auth, API key auth, rate limiting, pagination, full-text search, audit logging, and auto-generated OpenAPI documentation. Full AWS deployment: ECS Fargate, RDS, ALB, all via Terraform.',
        'FastAPI + SQLAlchemy + Terraform',
        8,
        '$9.80',
        '35 min',
        'https://github.com/workermill-examples/shipapi',
        NULL,
        NULL,
        'api',
        false,
        2,
        '{"storyCount": 8, "personasUsed": ["backend_developer", "devops_engineer", "qa_engineer"], "qualityScores": {"lint": "0 errors", "types": "0 errors (mypy strict)", "tests": ">80% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'PulseView',
        'Real-time event analytics dashboard with always-alive demo data.',
        'Event ingestion API with real-time WebSocket dashboard: counter cards, line/bar/pie charts, heatmap, and searchable event table. Includes a demo data generator that keeps charts perpetually active. Deployed to GCP Cloud Run.',
        'Express + React + Socket.io + Terraform (GCP)',
        12,
        '$18.40',
        '62 min',
        'https://github.com/workermill-examples/pulseview',
        NULL,
        NULL,
        'analytics',
        false,
        3,
        '{"storyCount": 12, "personasUsed": ["backend_developer", "frontend_developer", "devops_engineer"], "qualityScores": {"lint": "0 errors", "types": "0 errors", "tests": ">60% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'DocForge',
        'Developer documentation site with CMS, full-text search, and version history.',
        'Documentation platform with Stripe-like design, sidebar page tree, Markdown rendering, Meilisearch-powered search, Django admin CMS with version history, and 15-20 pages of generated API documentation. Multi-service AWS deployment.',
        'Django + HTMX + TailwindCSS + Meilisearch',
        10,
        '$12.60',
        '42 min',
        'https://github.com/workermill-examples/docforge',
        NULL,
        NULL,
        'documentation',
        false,
        4,
        '{"storyCount": 10, "personasUsed": ["backend_developer", "frontend_developer", "tech_writer"], "qualityScores": {"lint": "0 errors", "types": "0 errors (mypy)", "tests": ">60% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'EnvGuard',
        'Secret scanning CLI (Go) with a tracking web dashboard.',
        'Go CLI that scans codebases for leaked secrets using regex patterns and Shannon entropy analysis. Scans files and git history. Outputs table/JSON/SARIF. Web dashboard tracks scan results across projects with trend charts. Cross-platform binaries via goreleaser.',
        'Go + Cobra + Next.js + Terraform',
        12,
        '$22.30',
        '75 min',
        'https://github.com/workermill-examples/envguard',
        NULL,
        NULL,
        'security',
        false,
        5,
        '{"storyCount": 12, "personasUsed": ["backend_developer", "frontend_developer", "security_engineer", "devops_engineer"], "qualityScores": {"lint": "0 errors (golangci-lint + eslint)", "types": "0 errors (go vet + tsc)", "tests": ">70% coverage", "security": "0 critical"}}',
        NULL
      ),
      (
        'OrderFlow',
        'Event-driven microservices with message queues and monitoring dashboard.',
        'Three-service order processing system (Order, Payment, Notification) communicating via AWS SQS. Real-time monitoring dashboard shows animated message flow between services, live event log, and order lifecycle tracker. Deployed as 4 ECS services via Terraform.',
        'Express + TypeScript + SQS + React + Terraform',
        14,
        '$28.50',
        '95 min',
        'https://github.com/workermill-examples/orderflow',
        NULL,
        NULL,
        'microservices',
        false,
        6,
        '{"storyCount": 14, "personasUsed": ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer"], "qualityScores": {"lint": "0 errors", "types": "0 errors", "tests": ">60% coverage", "security": "0 critical"}}',
        NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM showcase_projects`);
  }
}
