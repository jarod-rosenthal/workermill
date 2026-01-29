import {
  Palette,
  Server,
  Wrench,
  Shield,
  FlaskConical,
  FileText,
  ClipboardList,
  Briefcase,
  Code,
  Lock,
  Users,
  Database,
  Brain,
  Smartphone,
  Globe,
  HardDrive,
  Compass,
} from "lucide-react";

const personas = [
  {
    id: "frontend_developer",
    emoji: "🎨",
    title: "Frontend Developer",
    icon: Palette,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
    description: "Specializes in UI/UX implementation, React components, and styling.",
    skills: ["React", "TypeScript", "Tailwind CSS", "Accessibility", "Responsive Design"],
    bestFor: [
      "Building new UI components",
      "Styling and layout changes",
      "Fixing CSS/styling issues",
      "Adding new pages or views",
      "Accessibility improvements",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "backend_developer",
    emoji: "⚙️",
    title: "Backend Developer",
    icon: Server,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Expert in API development, database design, and server-side logic.",
    skills: ["Node.js", "Express", "PostgreSQL", "REST APIs", "TypeORM"],
    bestFor: [
      "Creating new API endpoints",
      "Database schema changes",
      "Business logic implementation",
      "Data validation",
      "Performance optimization",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "devops_engineer",
    emoji: "🔧",
    title: "DevOps Engineer",
    icon: Wrench,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    description: "Handles infrastructure, CI/CD pipelines, and deployment automation.",
    skills: ["Terraform", "AWS", "Docker", "GitHub Actions", "Kubernetes"],
    bestFor: [
      "Infrastructure changes",
      "CI/CD pipeline updates",
      "Container configuration",
      "Cloud resource management",
      "Deployment scripts",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "security_engineer",
    emoji: "🔒",
    title: "Security Engineer",
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    description: "Focuses on security audits, vulnerability fixes, and compliance.",
    skills: ["OWASP Top 10", "Penetration Testing", "IAM", "Encryption", "Audit Logging"],
    bestFor: [
      "Security vulnerability fixes",
      "Authentication/authorization",
      "Input validation hardening",
      "Secrets management",
      "Security audit remediation",
    ],
    model: "claude-opus-4-5",
  },
  {
    id: "qa_engineer",
    emoji: "🧪",
    title: "QA Engineer",
    icon: FlaskConical,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "Specializes in test writing, quality assurance, and bug verification.",
    skills: ["Jest", "Playwright", "Test Design", "Bug Triage", "E2E Testing"],
    bestFor: [
      "Writing unit tests",
      "E2E test automation",
      "Test coverage improvements",
      "Bug reproduction scripts",
      "Test fixture creation",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "tech_writer",
    emoji: "📝",
    title: "Technical Writer",
    icon: FileText,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    description: "Creates documentation, API docs, and user guides.",
    skills: ["Markdown", "API Documentation", "User Guides", "README files", "Code Comments"],
    bestFor: [
      "README updates",
      "API documentation",
      "Code comments and JSDoc",
      "User guides",
      "Architecture documentation",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "project_manager",
    emoji: "📋",
    title: "Project Manager",
    icon: ClipboardList,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description: "Handles task planning, coordination, and status updates.",
    skills: ["Jira", "Project Planning", "Stakeholder Management", "Reporting"],
    bestFor: [
      "Ticket triage and refinement",
      "Status report generation",
      "Dependency analysis",
      "Sprint planning support",
      "Documentation review",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "api_developer",
    emoji: "🔌",
    title: "API Developer",
    icon: Globe,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    description: "Specializes in API design, documentation, and SDK generation.",
    skills: ["OpenAPI", "GraphQL", "REST", "Postman", "SDK Generation"],
    bestFor: [
      "API design and documentation",
      "OpenAPI/Swagger specs",
      "GraphQL schema design",
      "Client SDK generation",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "database_administrator",
    emoji: "💾",
    title: "Database Administrator",
    icon: HardDrive,
    color: "text-amber-600",
    bgColor: "bg-amber-600/10",
    borderColor: "border-amber-600/30",
    description: "Expert in database schema design, optimization, and administration.",
    skills: ["PostgreSQL", "MySQL", "Query Optimization", "Indexing", "Migrations"],
    bestFor: [
      "Schema design",
      "Query optimization",
      "Database migrations",
      "Performance tuning",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "data_engineer",
    emoji: "📊",
    title: "Data Engineer",
    icon: Database,
    color: "text-teal-500",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/30",
    description: "Specializes in ETL pipelines, data modeling, and warehouse architecture.",
    skills: ["dbt", "Airflow", "Snowflake", "BigQuery", "Pandas", "SQL"],
    bestFor: [
      "Building ETL/ELT pipelines",
      "Data warehouse design",
      "Data quality checks",
      "Stream processing setup",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "ml_engineer",
    emoji: "🧠",
    title: "ML Engineer",
    icon: Brain,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    description: "Expert in training pipelines, model deployment, and MLOps practices.",
    skills: ["PyTorch", "MLflow", "SageMaker", "scikit-learn", "TensorFlow"],
    bestFor: [
      "Model training pipelines",
      "Feature engineering",
      "Model deployment",
      "Experiment tracking",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "mobile_developer_ios",
    emoji: "🍎",
    title: "iOS Developer",
    icon: Smartphone,
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
    borderColor: "border-gray-400/30",
    description: "Specializes in iOS app development with Swift and SwiftUI.",
    skills: ["Swift", "SwiftUI", "Xcode", "Core Data", "UIKit"],
    bestFor: [
      "iOS app development",
      "SwiftUI components",
      "App Store submission",
      "iOS-specific features",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "mobile_developer_android",
    emoji: "🤖",
    title: "Android Developer",
    icon: Smartphone,
    color: "text-lime-500",
    bgColor: "bg-lime-500/10",
    borderColor: "border-lime-500/30",
    description: "Expert in Android app development with Kotlin and Jetpack Compose.",
    skills: ["Kotlin", "Jetpack Compose", "Room", "Android Studio", "Material Design"],
    bestFor: [
      "Android app development",
      "Compose UI components",
      "Play Store submission",
      "Android-specific features",
    ],
    model: "claude-sonnet-4",
  },
  {
    id: "tech_lead",
    emoji: "🎯",
    title: "Tech Lead",
    icon: Compass,
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/30",
    description: "Guides architecture decisions, code reviews, and technical strategy.",
    skills: ["System Design", "Code Review", "Technical Strategy", "Mentorship", "Architecture"],
    bestFor: [
      "Architecture decisions",
      "Technical design reviews",
      "Code quality standards",
      "Technical debt assessment",
    ],
    model: "claude-opus-4-5",
  },
];

const managerPersona = {
  id: "manager",
  emoji: "👔",
  title: "Virtual Manager",
  icon: Briefcase,
  color: "text-indigo-500",
  bgColor: "bg-indigo-500/10",
  borderColor: "border-indigo-500/30",
  description:
    "Reviews all PRs created by workers, provides feedback, and approves or requests revisions.",
  skills: ["Code Review", "Quality Assurance", "Feedback", "Approval Workflow"],
  responsibilities: [
    "Review code changes for quality and correctness",
    "Ensure changes match ticket requirements",
    "Check for security issues and best practices",
    "Approve, reject, or request revisions",
    "Provide actionable feedback to workers",
  ],
};


export default function Personas() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Worker Personas</h1>
        <p className="text-muted-foreground">
          WorkerMill uses specialized AI personas to handle different types of development tasks.
          Each persona has domain expertise and is optimized for specific work.
        </p>
      </div>

      {/* Virtual Manager */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-indigo-500" />
          Virtual Manager
        </h2>
        <div className={`bg-card border ${managerPersona.borderColor} rounded-xl p-6`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-lg ${managerPersona.bgColor}`}>
              <span className="text-3xl">{managerPersona.emoji}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-semibold text-foreground">{managerPersona.title}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${managerPersona.bgColor} ${managerPersona.color}`}>
                  Always Active
                </span>
              </div>
              <p className="text-muted-foreground mb-4">{managerPersona.description}</p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-2">Skills</h4>
                  <div className="flex flex-wrap gap-2">
                    {managerPersona.skills.map((skill) => (
                      <span
                        key={skill}
                        className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-2">Responsibilities</h4>
                  <ul className="space-y-1">
                    {managerPersona.responsibilities.map((resp, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-indigo-500" />
                        {resp}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Worker Personas */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Worker Personas (14 Types)
        </h2>
        <div className="grid gap-4">
          {personas.map((persona) => (
            <div
              key={persona.id}
              className={`bg-card border ${persona.borderColor} rounded-xl p-5`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg ${persona.bgColor}`}>
                  <span className="text-2xl">{persona.emoji}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-foreground">{persona.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {persona.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {persona.model}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{persona.description}</p>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                        Skills
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {persona.skills.map((skill) => (
                          <span
                            key={skill}
                            className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                        Best For
                      </h4>
                      <ul className="space-y-1">
                        {persona.bestFor.slice(0, 3).map((item, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                            <div className={`w-1 h-1 rounded-full ${persona.bgColor.replace("/10", "")}`} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Persona Selection */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">How Personas Are Selected</h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            Persona selection can happen automatically or manually:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Automatic Assignment</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Based on Jira ticket labels</li>
                <li>- Inferred from ticket summary/description</li>
                <li>- Default persona if uncertain</li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground mb-2">Manual Assignment</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- Selected when creating task</li>
                <li>- Override via dashboard</li>
                <li>- API parameter on task creation</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Model Selection */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Claude Models</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Workers can use different Claude models based on task complexity:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-foreground">Claude Sonnet 4</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Fast, capable model for most development tasks. Default choice for workers.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-accent" />
                <h4 className="font-medium text-foreground">Claude Opus 4.5</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Most capable model for complex reasoning. Used for security and architecture tasks.
              </p>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
