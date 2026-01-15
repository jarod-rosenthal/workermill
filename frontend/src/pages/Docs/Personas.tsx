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
  Clock,
  LayoutDashboard,
  Building2,
  Wallet,
  Megaphone,
  TrendingUp,
  Scale,
  Microscope,
  BarChart3,
  TestTube,
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
];

const comingSoonPersonas = [
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
  },
  {
    id: "mobile_developer_ios",
    emoji: "🍎",
    title: "Mobile Developer (iOS)",
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
  },
  {
    id: "mobile_developer_android",
    emoji: "🤖",
    title: "Mobile Developer (Android)",
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

// Dashboard Views - Role-based dashboards for different users
const dashboardViews = [
  {
    id: "engineer",
    emoji: "👨‍💻",
    title: "Engineer",
    icon: Code,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    description: "Task execution, PR management, and code change tracking.",
    features: ["My Tasks queue", "PR review actions", "Live terminal output", "Code change stats"],
    status: "available",
  },
  {
    id: "manager",
    emoji: "👥",
    title: "Engineering Manager",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Team performance metrics, cost tracking, and approval workflows.",
    features: ["Team activity charts", "Cost breakdown", "Approval queue", "Performance metrics"],
    status: "available",
  },
  {
    id: "devops",
    emoji: "🔧",
    title: "DevOps/SRE",
    icon: Server,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    description: "Deployment pipeline, system health, and infrastructure monitoring.",
    features: ["Pipeline visualization", "Health monitors", "Deployment history", "Rollback controls"],
    status: "available",
  },
  {
    id: "security",
    emoji: "🔒",
    title: "Security Engineer",
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    description: "Security scanning results, compliance status, and audit trails.",
    features: ["Vulnerability findings", "Compliance tracking", "Audit logs", "Security gates"],
    status: "available",
  },
  {
    id: "qa",
    emoji: "🧪",
    title: "QA Engineer",
    icon: TestTube,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "Test metrics, coverage tracking, and quality assurance.",
    features: ["Test coverage", "Pass/fail rates", "Test run history", "Quality metrics"],
    status: "available",
  },
  {
    id: "tech_lead",
    emoji: "🧭",
    title: "Tech Lead",
    icon: Compass,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    description: "Architecture decisions, code review oversight, and technical debt.",
    features: ["Code review queue", "Architecture decisions", "Technical debt tracking", "Standards compliance"],
    status: "available",
  },
  {
    id: "product_manager",
    emoji: "📋",
    title: "Product Manager",
    icon: ClipboardList,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    description: "Sprint progress, ticket status, and delivery velocity.",
    features: ["Sprint burndown", "Ticket status", "Velocity trends", "Backlog overview"],
    status: "available",
  },
  {
    id: "cto",
    emoji: "🏢",
    title: "CTO / VP Engineering",
    icon: Building2,
    color: "text-slate-600",
    bgColor: "bg-slate-600/10",
    borderColor: "border-slate-600/30",
    description: "Executive ROI metrics, team adoption, and strategic risk assessment.",
    features: ["ROI calculator", "Team adoption heatmap", "Risk scorecard", "Velocity trends"],
    status: "available",
  },
  {
    id: "finance",
    emoji: "💰",
    title: "Finance",
    icon: Wallet,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    description: "Budget tracking, cost forecasting, and savings analysis.",
    features: ["Budget tracker", "Cost forecast", "Savings breakdown", "Provider costs"],
    status: "available",
  },
  {
    id: "sales",
    emoji: "📈",
    title: "Sales",
    icon: TrendingUp,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    description: "Demo mode for prospects, velocity showcases, and customer success metrics.",
    features: ["Demo mode (sanitized data)", "Velocity benchmarks", "Case study metrics", "Feature request tracking"],
    status: "available",
  },
  {
    id: "marketing",
    emoji: "📣",
    title: "Marketing",
    icon: Megaphone,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
    description: "Release timelines, feature changelogs, and announcement coordination.",
    features: ["Release timeline", "Auto-generated changelog", "Feature categorization", "Launch coordination"],
    status: "available",
  },
];

const comingSoonDashboards = [
  {
    id: "legal",
    emoji: "⚖️",
    title: "Legal / Compliance",
    icon: Scale,
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
    description: "IP attribution, license compliance, and regulatory audit exports.",
    features: ["Code attribution", "License scanning", "Audit exports", "Compliance checklists"],
    status: "planned",
  },
  {
    id: "research",
    emoji: "🔬",
    title: "R&D / Research",
    icon: Microscope,
    color: "text-indigo-400",
    bgColor: "bg-indigo-400/10",
    borderColor: "border-indigo-400/30",
    description: "Experiment tracking, prototype gallery, and innovation pipeline.",
    features: ["Experiment tracker", "Prototype gallery", "Research spikes", "Innovation metrics"],
    status: "planned",
  },
];

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
          Worker Personas (7 Types)
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

      {/* Coming Soon Personas */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          Coming Soon (6 Types)
        </h2>
        <p className="text-muted-foreground text-sm">
          These specialized personas are in development and will be available soon.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {comingSoonPersonas.map((persona) => (
            <div
              key={persona.id}
              className={`bg-card border ${persona.borderColor} rounded-xl p-4 opacity-75`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${persona.bgColor}`}>
                  <span className="text-xl">{persona.emoji}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground text-sm">{persona.title}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{persona.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {persona.skills.slice(0, 4).map((skill) => (
                      <span
                        key={skill}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {skill}
                      </span>
                    ))}
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

      {/* Divider */}
      <div className="border-t border-border my-8" />

      {/* Dashboard Views Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-primary" />
            Role-Based Dashboards
          </h2>
          <p className="text-muted-foreground">
            WorkerMill provides tailored dashboard views for different roles in your organization.
            Each view shows relevant metrics, controls, and insights for that persona.
          </p>
        </div>
      </section>

      {/* Available Dashboard Views */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-500" />
          Available Now ({dashboardViews.length} Views)
        </h3>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dashboardViews.map((view) => (
            <div
              key={view.id}
              className={`bg-card border ${view.borderColor} rounded-xl p-4`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${view.bgColor}`}>
                  <span className="text-xl">{view.emoji}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-foreground text-sm">{view.title}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                      Available
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{view.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {view.features.slice(0, 3).map((feature) => (
                      <span
                        key={feature}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coming Soon Dashboard Views */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          Coming Soon ({comingSoonDashboards.length} Views)
        </h3>
        <p className="text-muted-foreground text-sm">
          These dashboard views are in development to support more roles across your organization.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {comingSoonDashboards.map((view) => (
            <div
              key={view.id}
              className={`bg-card border ${view.borderColor} rounded-xl p-4 opacity-80`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${view.bgColor}`}>
                  <span className="text-xl">{view.emoji}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-foreground text-sm">{view.title}</h4>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      view.status === 'coming_soon'
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {view.status === 'coming_soon' ? 'Coming Soon' : 'Planned'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{view.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {view.features.map((feature) => (
                      <span
                        key={feature}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dashboard Selection Info */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-foreground">Switching Dashboard Views</h3>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Users can switch between dashboard views using the role switcher in the dashboard header.
            Your selection is persisted across sessions.
          </p>
          <div className="bg-background rounded-lg p-4 border border-border">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-muted-foreground">Available views:</span>
              {dashboardViews.map((view) => (
                <span
                  key={view.id}
                  className={`text-xs px-2 py-1 rounded-full ${view.bgColor} ${view.color}`}
                >
                  {view.emoji} {view.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
