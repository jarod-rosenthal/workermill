import {
  FileText,
  CheckCircle2,
  Zap,
  BarChart3,
  AlertTriangle,
  Shield,
  Target,
  BookOpen,
  ArrowRight,
  Star,
  TrendingUp,
  Settings,
  ListChecks,
} from "lucide-react";

const specSections = [
  { number: 1, name: "Overview", description: "Deliverables as a numbered list. What exactly will be built?" },
  { number: 2, name: "Technical Specification", description: "Version constraints, pinned dependencies, runtime requirements" },
  { number: 3, name: "Data Model", description: "Complete database schema with column types, constraints, and relations" },
  { number: 4, name: "File Structure", description: "Exact directory layout showing every file to create or modify" },
  { number: 5, name: "API Specification", description: "Endpoints with HTTP methods, request/response shapes, status codes" },
  { number: 6, name: "Component Specification", description: "UI components with props, state, and behavior descriptions" },
  { number: 7, name: "Quality Gates", description: "Lint, typecheck, test, and build commands that must pass" },
  { number: 8, name: "Acceptance Criteria", description: "Measurable success conditions -- binary pass/fail, no ambiguity" },
  { number: 9, name: "Scope Boundary", description: "Explicit \"DO NOT create\" list to prevent scope creep" },
  { number: 10, name: "Pre-Provisioned Infrastructure", description: "What already exists: databases, queues, services, credentials" },
];

const scoringDimensions = [
  {
    name: "Completeness",
    weight: "30%",
    description: "Does the spec cover all sections? Are data models, API shapes, file structure, and acceptance criteria all present?",
    tips: "Fill every section of the template. A missing data model or file structure forces the agent to guess.",
  },
  {
    name: "Clarity",
    weight: "20%",
    description: "Is every requirement unambiguous? Could two engineers read this spec and build the same thing?",
    tips: "Replace vague words like \"fast\", \"nice\", or \"good\" with numbers. \"Responds in < 200ms\" beats \"responds quickly\".",
  },
  {
    name: "Decomposability",
    weight: "20%",
    description: "Can the spec be broken into independent stories that workers can execute in parallel?",
    tips: "Separate concerns cleanly: data model, API, UI, tests. Avoid monolithic descriptions where everything depends on everything.",
  },
  {
    name: "Constraints",
    weight: "15%",
    description: "Are versions pinned, scope boundaries defined, and pre-existing infrastructure documented?",
    tips: "Pin every dependency version. List what NOT to build. Document what already exists so agents don't recreate it.",
  },
  {
    name: "Testability",
    weight: "15%",
    description: "Can every acceptance criterion be verified by running a command or checking a condition?",
    tips: "Each criterion should be a yes/no check. \"User can log in\" is weak. \"POST /auth/login with valid credentials returns 200 and a JWT\" is strong.",
  },
];

export default function SpecEngineering() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Specification Engineering</h1>
        <p className="text-muted-foreground">
          Specs are the highest-leverage artifact when building with AI coding agents.
          A well-structured spec drives everything downstream -- decomposition, planning, and code quality.
        </p>
      </div>

      {/* What is Specification Engineering? */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          What is Specification Engineering?
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Specification engineering is the practice of writing precise, structured specs that AI coding agents
            can reliably execute. A 10% better spec produces dramatically better decompositions, plans, and code.
            The spec is the input that drives everything else.
          </p>
          <p className="text-muted-foreground mb-4">
            WorkerMill pioneered spec-driven development for AI agents. Instead of giving agents vague instructions
            and hoping for the best, you write a structured spec that eliminates ambiguity, pins constraints, and
            defines measurable success conditions. The result: agents build what you actually want, the first time.
          </p>
          <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
            <h4 className="font-medium text-foreground mb-2">Industry Recognition</h4>
            <p className="text-sm text-muted-foreground">
              The industry is converging on spec-driven development. Addy Osmani has written extensively about
              the importance of detailed specs for AI coding. GitHub released Spec Kit for structured AI
              prompting. Thoughtworks identified Specification-Driven Development (SDD) as a key practice.
              WorkerMill builds this into the platform as a first-class workflow.
            </p>
          </div>
        </div>
      </section>

      {/* The WorkerMill Spec Format */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-500" />
          The WorkerMill Spec Format
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Every WorkerMill spec follows a standard template with 10 sections. Each section serves a specific
            purpose in guiding AI agents toward correct implementation.
          </p>
          <div className="space-y-3">
            {specSections.map((section) => (
              <div key={section.number} className="flex items-start gap-4 p-3 bg-muted/30 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                  {section.number}
                </div>
                <div className="flex-1">
                  <span className="font-medium text-foreground">{section.name}</span>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quality Scoring */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          Quality Scoring
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            WorkerMill scores every spec across 5 dimensions. The total score (0-100) determines whether the
            spec is ready for decomposition or needs improvement.
          </p>
          <div className="space-y-4 mb-6">
            {scoringDimensions.map((dim) => (
              <div key={dim.name} className="p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-foreground">{dim.name}</span>
                  <span className="text-sm font-mono text-primary">{dim.weight}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{dim.description}</p>
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">{dim.tips}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="font-medium text-foreground mb-3">Example Score Breakdown</h4>
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Completeness (30%)</span>
                <span className="text-foreground">27 / 30</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clarity (20%)</span>
                <span className="text-foreground">18 / 20</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Decomposability (20%)</span>
                <span className="text-foreground">16 / 20</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Constraints (15%)</span>
                <span className="text-foreground">12 / 15</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Testability (15%)</span>
                <span className="text-foreground">13 / 15</span>
              </div>
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-bold">
                <span className="text-foreground">Total</span>
                <span className="text-primary">86 / 100</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Writing Better Specs */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          Writing Better Specs -- Principles
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-6">
          {/* Pin dependency versions */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Pin dependency versions explicitly
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="text-xs font-medium text-red-500 mb-2">BEFORE (weak)</div>
                <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">Use React and TypeScript with Tailwind CSS for styling.</pre>
              </div>
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="text-xs font-medium text-green-500 mb-2">AFTER (strong)</div>
                <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">React 19.0.0, TypeScript 5.7.x, Tailwind CSS 4.0, Vite 6.x</pre>
              </div>
            </div>
          </div>

          {/* Scope boundaries */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Define scope boundaries with "DO NOT" sections
            </h3>
            <div className="p-3 bg-muted/50 border border-border rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`## Scope Boundary
DO NOT create:
- Authentication system (use existing auth middleware)
- Database migrations (schema already exists)
- CI/CD pipeline configuration
- Docker or deployment files
- Any npm packages not listed in Technical Specification`}</pre>
            </div>
          </div>

          {/* Measurable acceptance criteria */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Make acceptance criteria measurable
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="text-xs font-medium text-red-500 mb-2">WEAK</div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>- The page loads quickly</li>
                  <li>- Users can manage their data</li>
                  <li>- Error handling works properly</li>
                </ul>
              </div>
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="text-xs font-medium text-green-500 mb-2">STRONG</div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>- GET /api/items returns 200 with JSON array in &lt; 200ms</li>
                  <li>- DELETE /api/items/:id returns 204 and removes the row</li>
                  <li>- POST /api/items with missing "name" returns 400 with error message</li>
                </ul>
              </div>
            </div>
          </div>

          {/* File structure */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Include complete file structure
            </h3>
            <div className="p-3 bg-muted/50 border border-border rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`## File Structure
src/
  components/
    UserTable.tsx          # Main data table with sorting
    UserTableRow.tsx       # Individual row with actions
    UserFilters.tsx        # Filter bar (status, role, date)
  hooks/
    useUsers.ts            # React Query hook for /api/users
    useUserMutations.ts    # Create/update/delete mutations
  types/
    user.ts                # User interface + API types
  __tests__/
    UserTable.test.tsx     # Table render + interaction tests`}</pre>
            </div>
          </div>

          {/* Quality gate commands */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Specify quality gate commands
            </h3>
            <div className="p-3 bg-muted/50 border border-border rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`## Quality Gates
- npm run lint          # ESLint must pass with zero warnings
- npm run typecheck     # TypeScript strict mode, no errors
- npm run test          # All tests pass, no skipped tests
- npm run build         # Production build completes`}</pre>
            </div>
          </div>

          {/* Show, don't tell */}
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Show, don't tell -- include code examples
            </h3>
            <div className="p-3 bg-muted/50 border border-border rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`## API Specification

### POST /api/users
Request:
  { "name": "Jane", "email": "jane@co.com", "role": "admin" }

Response 201:
  { "id": "uuid", "name": "Jane", "email": "jane@co.com",
    "role": "admin", "createdAt": "2026-01-15T..." }

Response 400:
  { "error": "Email already exists" }`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* Before & After */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-primary" />
          Before & After
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-6">
          {/* Weak spec */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <h3 className="font-medium text-red-500">Weak Spec</h3>
              <span className="text-xs font-mono bg-red-500/10 text-red-500 px-2 py-0.5 rounded">Score: 34</span>
            </div>
            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`Build a user management page.

It should show a list of users with their info.
Users should be able to add, edit, and delete users.
Use React and make it look nice.
Add some tests.`}</pre>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              No versions, no data model, no API shape, no file structure, no scope boundary.
              The agent has to guess everything, producing inconsistent results.
            </p>
          </div>

          {/* Strong spec */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-green-500" />
              <h3 className="font-medium text-green-500">Strong Spec</h3>
              <span className="text-xs font-mono bg-green-500/10 text-green-500 px-2 py-0.5 rounded">Score: 91</span>
            </div>
            <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{`## Overview
1. User management CRUD page at /admin/users
2. Server-side paginated table (20 rows/page)
3. Role-based filtering (admin, member, viewer)

## Technical Specification
React 19.0.0, TypeScript 5.7.x, TanStack Table 8.x,
React Query 5.x, Tailwind CSS 4.0, Vitest 3.x

## Data Model
users: id (uuid PK), name (varchar 255), email (varchar 255 UNIQUE),
       role (enum: admin|member|viewer), created_at (timestamptz)

## File Structure
src/pages/AdminUsers.tsx
src/components/UsersTable.tsx
src/hooks/useUsers.ts
src/types/user.ts
src/__tests__/UsersTable.test.tsx

## Quality Gates
npm run lint && npm run typecheck && npm run test

## Acceptance Criteria
- GET /api/users?page=1&role=admin returns paginated JSON
- DELETE /api/users/:id returns 204
- Table renders 20 rows per page with Next/Prev controls
- All 3 tests pass in Vitest

## Scope Boundary
DO NOT create: auth system, database migrations,
Docker files, CI pipeline`}</pre>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Pinned versions, explicit data model, file structure, quality gates, measurable criteria,
              and a scope boundary. The agent knows exactly what to build and what to skip.
            </p>
          </div>
        </div>
      </section>

      {/* Organization Standards */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Organization Standards
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Admins can configure organization-wide standards for specifications to ensure
            consistent quality across all teams and projects.
          </p>
          <div className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-foreground">Spec Templates</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Set default templates for new specs. Pre-populate required sections so authors
                start with the right structure instead of a blank page.
              </p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-foreground">Minimum Quality Score</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Set a minimum quality score (e.g., 75/100) that specs must meet before
                decomposition is allowed. Prevents low-quality specs from entering the build pipeline.
              </p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <ListChecks className="w-4 h-4 text-primary" />
                <h4 className="font-medium text-foreground">Required Sections</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Enforce that specific sections (e.g., Quality Gates, Scope Boundary, Acceptance Criteria)
                must be filled in before a spec can be submitted. Missing required sections block decomposition.
              </p>
            </div>
          </div>
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-sm text-yellow-500">
              <strong>Tip:</strong> Configure organization standards at{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded">/settings</code> under the Specifications tab.
              Changes apply to all new specs across the organization.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
