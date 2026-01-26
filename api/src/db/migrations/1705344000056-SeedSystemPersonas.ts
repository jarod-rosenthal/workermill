import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Seed system personas for Persona Studio
 * These are global personas (org_id = NULL) that all organizations can see
 */
export class SeedSystemPersonas1705344000056 implements MigrationInterface {
  name = "SeedSystemPersonas1705344000056";

  private personas = [
    {
      slug: "backend_developer",
      name: "Backend Developer",
      emoji: "⚙️",
      color: "***REMOVED***3B82F6",
      short_label: "Backend",
      description: "Specializes in REST APIs, database design, server-side logic, and backend architecture",
      priority: 1,
      skills: "api,database,typescript,node,express,postgres",
      risk_level: "medium",
    },
    {
      slug: "frontend_developer",
      name: "Frontend Developer",
      emoji: "🎨",
      color: "***REMOVED***8B5CF6",
      short_label: "Frontend",
      description: "Specializes in React, UI components, CSS, and responsive design",
      priority: 2,
      skills: "react,typescript,tailwind,html,css,ui",
      risk_level: "low",
    },
    {
      slug: "devops_engineer",
      name: "DevOps Engineer",
      emoji: "🔧",
      color: "***REMOVED***F59E0B",
      short_label: "DevOps",
      description: "Specializes in CI/CD, Docker, Kubernetes, Terraform, and cloud infrastructure",
      priority: 3,
      skills: "docker,kubernetes,terraform,aws,ci-cd,infrastructure",
      risk_level: "high",
    },
    {
      slug: "security_engineer",
      name: "Security Engineer",
      emoji: "🛡️",
      color: "***REMOVED***EF4444",
      short_label: "Security",
      description: "Specializes in security audits, vulnerability assessment, and secure coding practices",
      priority: 4,
      skills: "security,owasp,audit,penetration-testing,compliance",
      risk_level: "high",
    },
    {
      slug: "qa_engineer",
      name: "QA Engineer",
      emoji: "🧪",
      color: "***REMOVED***10B981",
      short_label: "QA",
      description: "Specializes in test automation, integration testing, and quality assurance",
      priority: 5,
      skills: "testing,jest,playwright,cypress,automation",
      risk_level: "low",
    },
    {
      slug: "tech_writer",
      name: "Technical Writer",
      emoji: "📝",
      color: "***REMOVED***6366F1",
      short_label: "Tech Writer",
      description: "Specializes in documentation, API docs, and technical communication",
      priority: 6,
      skills: "documentation,markdown,api-docs,guides",
      risk_level: "low",
    },
    {
      slug: "project_manager",
      name: "Project Manager",
      emoji: "📊",
      color: "***REMOVED***EC4899",
      short_label: "PM",
      description: "Specializes in project planning, task breakdown, and coordination",
      priority: 7,
      skills: "planning,jira,agile,coordination",
      risk_level: "low",
    },
    {
      slug: "api_developer",
      name: "API Developer",
      emoji: "🔌",
      color: "***REMOVED***0EA5E9",
      short_label: "API",
      description: "Specializes in API design, OpenAPI specs, and integration development",
      priority: 8,
      skills: "api,rest,graphql,openapi,swagger",
      risk_level: "medium",
    },
    {
      slug: "data_engineer",
      name: "Data Engineer",
      emoji: "📈",
      color: "***REMOVED***14B8A6",
      short_label: "Data",
      description: "Specializes in data pipelines, ETL, analytics, and data modeling",
      priority: 9,
      skills: "sql,etl,analytics,data-modeling,python",
      risk_level: "medium",
    },
    {
      slug: "database_administrator",
      name: "Database Administrator",
      emoji: "🗄️",
      color: "***REMOVED***8B5CF6",
      short_label: "DBA",
      description: "Specializes in database administration, optimization, and migrations",
      priority: 10,
      skills: "postgres,mysql,migrations,optimization,backup",
      risk_level: "high",
    },
    {
      slug: "ml_engineer",
      name: "ML Engineer",
      emoji: "🤖",
      color: "***REMOVED***F97316",
      short_label: "ML",
      description: "Specializes in machine learning, model training, and AI integration",
      priority: 11,
      skills: "python,tensorflow,pytorch,machine-learning,ai",
      risk_level: "medium",
    },
    {
      slug: "mobile_developer_android",
      name: "Android Developer",
      emoji: "📱",
      color: "***REMOVED***22C55E",
      short_label: "Android",
      description: "Specializes in Android app development with Kotlin and Java",
      priority: 12,
      skills: "android,kotlin,java,mobile,gradle",
      risk_level: "medium",
    },
    {
      slug: "mobile_developer_ios",
      name: "iOS Developer",
      emoji: "🍎",
      color: "***REMOVED***3B82F6",
      short_label: "iOS",
      description: "Specializes in iOS app development with Swift and SwiftUI",
      priority: 13,
      skills: "ios,swift,swiftui,xcode,mobile",
      risk_level: "medium",
    },
    {
      slug: "tech_lead",
      name: "Tech Lead",
      emoji: "🎯",
      color: "***REMOVED***7C3AED",
      short_label: "Tech Lead",
      description: "Leads technical decisions, architecture reviews, and team coordination",
      priority: 14,
      skills: "architecture,code-review,mentoring,planning,coordination",
      risk_level: "medium",
    },
    {
      slug: "manager",
      name: "Manager",
      emoji: "👔",
      color: "***REMOVED***6B7280",
      short_label: "Manager",
      description: "Virtual manager for code review and task approval workflows",
      priority: 0,
      skills: "review,approval,quality-gate",
      risk_level: "low",
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const persona of this.personas) {
      // Check if persona already exists
      const exists = await queryRunner.query(
        `SELECT 1 FROM personas WHERE slug = $1 AND org_id IS NULL`,
        [persona.slug]
      );

      if (exists.length === 0) {
        // Insert the persona
        await queryRunner.query(`
          INSERT INTO personas (
            org_id, slug, name, emoji, color, short_label, description,
            enabled, is_system, priority, skills, risk_level
          )
          VALUES (
            NULL,
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            true,
            true,
            $7,
            $8,
            $9
          )
        `, [
          persona.slug,
          persona.name,
          persona.emoji,
          persona.color,
          persona.short_label,
          persona.description,
          persona.priority,
          persona.skills,
          persona.risk_level,
        ]);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Delete only the system personas we created
    const slugs = this.personas.map(p => `'${p.slug}'`).join(",");
    await queryRunner.query(`
      DELETE FROM personas
      WHERE org_id IS NULL
      AND is_system = true
      AND slug IN (${slugs})
    `);
  }
}
