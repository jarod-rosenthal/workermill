// Auto-generated from WorkerMill internal board data
// Board: CalMill (2272c945-84ea-493c-b304-b744496998f6)
// Generated: 2026-02-17

export interface CalMillEpic {
  id: string;
  title: string;
  priority: string;
  storyCount: number;
  duration: string;
  status: "completed" | "escalated" | "deployed";
  techLeadScore?: string;
  prNumber: number;
  prUrl: string;
  commentCount: number;
  personas: string[];
  description: string;
  buildLog: string;
}

export const calMillEpics: CalMillEpic[] = [
  {
    id: "cm-1",
    title: "CM-1: Project Setup & Dev Environment",
    priority: "high",
    storyCount: 9,
    duration: "~66 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 2,
    prUrl: "https://github.com/workermill-examples/calmill/pull/2",
    commentCount: 106,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `# CM-1: Project Setup & Dev Environment

---

## Epic Overview

Scaffold a complete Next.js 16 project from scratch — Prisma 7 ORM with a 13-model scheduling schema, PostgreSQL (Neon), TailwindCSS 4 CSS-first configuration, CI/CD pipelines, and a working Vercel deploy. This is the **first ticket** in the CalMill series, creating the project skeleton that all subsequent epics build on.

**Deliverables:**

1. Project config and dependencies (Next.js 16, React 19.2, TypeScript)
2. Prisma 7 schema with 13 models, 3 enums, applied to Neon PostgreSQL
3. TailwindCSS 4 CSS-first configuration (NO \`tailwind.config.js\`)
4. App shell with auth pages (landing, login, signup)
5. Dashboard layout (sidebar, header, navigation stubs)
6. Public booking layout shell
7. Health check, seed, and auth API routes
8. GitHub Actions CI + deploy pipelines
9. Live Vercel deploy at calmill.workermill.com
10. All quality checks passing (typecheck, lint, test)

---

## Technical Specification

### Version Constraints (MUST follow exactly)

\`\`\`json
{
  "engines": { "node": ">=24.0.0" },
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "next-auth": "5.0.0-beta.30",
    "@auth/prisma-adapter": "latest",
    "@prisma/adapter-neon": "^7.4.0",
    "@neondatabase/serverless": "^0.10.0",
    "zod": "^4.3.0",
    "date-fns": "^4.1.0",
    "@date-fns/tz": "latest",
    "bcryptjs": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "prisma": "^7.4.0",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/postcss": "^4.1.0",
    "vitest": "^4.0.0",
    "@vitest/coverage-v8": "^4.0.0",
    "@playwright/test": "^1.58.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^16.1.0",
    "prettier": "^3.0.0"
  }
}
\`\`\`

### Prisma 7 Configuration (CRITICAL — new patterns)

**\`prisma.config.ts\`** (root of project):
\`\`\`typescript
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    // Direct (non-pooled) URL for CLI migrations; falls back for generate-only
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "postgresql://localhost:5432/calmill",
  },
});
\`\`\`

> **Prisma 7.4 Breaking Change:** \`earlyAccess\` is NOT a valid config property. The \`url\` and \`directUrl\` fields have been **removed from schema.prisma** — connection URLs now go in \`prisma.config.ts\` via the \`datasource\` block above.

**Schema generator block** — Prisma 7 still uses generator in schema.prisma but the client output path should be explicit:
\`\`\`prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}
\`\`\`

**Import the generated client from the output path:**
\`\`\`typescript
import { PrismaClient } from "@/generated/prisma/client";
\`\`\`

**NOT** from \`@prisma/client\` (Prisma 7 moves generated code outside node_modules).

**Prisma 7 + Neon requires an adapter** — PrismaClient no longer reads \`DATABASE_URL\` from env directly. Use the \`PrismaNeon\` adapter:
\`\`\`typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!;
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}
\`\`\`

### Prisma Schema (13 models, 3 enums)

\`\`\`prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

// ─── ENUMS ──────────────────────────────────────────────

enum BookingStatus {
  PENDING
  ACCEPTED
  CANCELLED
  REJECTED
  RESCHEDULED
}

enum SchedulingType {
  ROUND_ROBIN
  COLLECTIVE
}

enum TeamRole {
  OWNER
  ADMIN
  MEMBER
}

// ─── AUTH (NextAuth) ────────────────────────────────────

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ─── CORE ───────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  username      String    @unique
  avatarUrl     String?
  timezone      String    @default("America/New_York")
  weekStart     Int       @default(0) // 0=Sunday, 1=Monday
  bio           String?   @db.Text
  theme         String    @default("light")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  accounts            Account[]
  sessions            Session[]
  eventTypes          EventType[]
  bookings            Booking[]
  schedules           Schedule[]
  teamMemberships     TeamMember[]
  webhooks            Webhook[]
  calendarConnections CalendarConnection[]
}

model EventType {
  id          String  @id @default(cuid())
  title       String
  slug        String
  description String? @db.Text
  duration    Int     @default(30) // minutes
  locations   Json?   // [{ type: "inPerson"|"link"|"phone", value: string }]
  isActive    Boolean @default(true)

  // Confirmation & pricing
  requiresConfirmation Boolean @default(false)
  price                Int     @default(0) // cents, 0 = free
  currency             String  @default("USD")

  // Scheduling constraints
  minimumNotice    Int  @default(120)  // minutes before event can be booked
  beforeBuffer     Int  @default(0)    // minutes gap before event
  afterBuffer      Int  @default(0)    // minutes gap after event
  slotInterval     Int? // minutes between slot starts (null = use duration)
  maxBookingsPerDay  Int?
  maxBookingsPerWeek Int?
  futureLimit      Int  @default(60) // days into the future bookings allowed

  // Customization
  color              String?
  customQuestions    Json? // [{ id, label, type: "text"|"textarea"|"select"|"radio"|"checkbox"|"phone", required, options? }]
  successRedirectUrl String?

  // Recurring
  recurringEnabled         Boolean @default(false)
  recurringMaxOccurrences  Int?
  recurringFrequency       String? // "weekly" | "biweekly" | "monthly"

  // Team scheduling
  schedulingType SchedulingType? // null = personal, ROUND_ROBIN or COLLECTIVE for team

  // Relations
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  scheduleId String?
  schedule   Schedule? @relation(fields: [scheduleId], references: [id])
  teamId     String?
  team       Team?     @relation(fields: [teamId], references: [id])
  bookings   Booking[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, slug])
}

model Booking {
  id          String        @id @default(cuid())
  uid         String        @unique @default(cuid())
  title       String
  description String?       @db.Text
  startTime   DateTime
  endTime     DateTime
  status      BookingStatus @default(PENDING)

  // Attendee
  attendeeName     String
  attendeeEmail    String
  attendeeTimezone String
  attendeeNotes    String? @db.Text

  // Meeting details
  meetingUrl      String?
  meetingPassword String?
  location        String?

  // Custom question responses
  responses Json?

  // Cancellation
  cancellationReason String?
  cancelledAt        DateTime?

  // Recurring
  recurringEventId String?

  // External calendar
  calendarEventId String?

  // Relations
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  eventTypeId String
  eventType   EventType @relation(fields: [eventTypeId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Schedule {
  id        String  @id @default(cuid())
  name      String
  isDefault Boolean @default(false)
  timezone  String

  userId        String
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  availability  Availability[]
  eventTypes    EventType[]
  dateOverrides DateOverride[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Availability {
  id        String @id @default(cuid())
  day       Int    // 0=Sunday through 6=Saturday
  startTime String // "09:00" (HH:mm in schedule timezone)
  endTime   String // "17:00"

  scheduleId String
  schedule   Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
}

model DateOverride {
  id            String   @id @default(cuid())
  date          DateTime @db.Date
  startTime     String?  // null + isUnavailable=true means blocked all day
  endTime       String?
  isUnavailable Boolean  @default(false)

  scheduleId String
  schedule   Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
}

// ─── TEAMS ──────────────────────────────────────────────

model Team {
  id      String  @id @default(cuid())
  name    String
  slug    String  @unique
  logoUrl String?
  bio     String? @db.Text

  members    TeamMember[]
  eventTypes EventType[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model TeamMember {
  id       String   @id @default(cuid())
  role     TeamRole @default(MEMBER)
  accepted Boolean  @default(false)

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  teamId String
  team   Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@unique([userId, teamId])
}

// ─── INTEGRATIONS ───────────────────────────────────────

model CalendarConnection {
  id           String    @id @default(cuid())
  provider     String    // "google" | "outlook"
  accessToken  String    @db.Text
  refreshToken String?   @db.Text
  expiresAt    DateTime?
  email        String
  isPrimary    Boolean   @default(false)

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Webhook {
  id            String   @id @default(cuid())
  url           String
  eventTriggers String[] // ["BOOKING_CREATED", "BOOKING_CANCELLED", ...]
  active        Boolean  @default(true)
  secret        String?

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
\`\`\`

### TailwindCSS 4 Configuration (CRITICAL — new patterns)

**NO \`tailwind.config.js\` or \`tailwind.config.ts\`**. TailwindCSS 4 uses CSS-first configuration.

**\`postcss.config.js\`:**
\`\`\`javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
\`\`\`

**\`src/app/globals.css\`:**
\`\`\`css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-primary-50: #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-200: #bfdbfe;
  --color-primary-300: #93c5fd;
  --color-primary-400: #60a5fa;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-primary-800: #1e40af;
  --color-primary-900: #1e3a8a;

  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  /* Fonts */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Border radius */
  --radius-lg: 0.75rem;
  --radius-md: 0.5rem;
  --radius-sm: 0.25rem;
}
\`\`\`

### NextAuth v5 Configuration

**\`src/lib/auth.ts\`:**
\`\`\`typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        // bcryptjs.compare() for password verification
        // Return user object or null
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.timezone = user.timezone;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.username = token.username;
      session.user.timezone = token.timezone;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    newUser: "/getting-started",
  },
});
\`\`\`

### Project Structure

\`\`\`
calmill/
├── prisma/
│   ├── schema.prisma          # 13 models, 3 enums
│   └── seed.ts                # Demo data
├── prisma.config.ts           # Prisma 7 configuration
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout (Inter font, TailwindCSS)
│   │   ├── page.tsx           # Landing page
│   │   ├── login/page.tsx     # Login form
│   │   ├── signup/page.tsx    # Registration form
│   │   ├── getting-started/page.tsx  # Post-signup onboarding
│   │   ├── (dashboard)/       # Authenticated layout group
│   │   │   ├── layout.tsx     # Sidebar + header
│   │   │   ├── event-types/page.tsx  # Event type list (stub)
│   │   │   ├── bookings/page.tsx     # Bookings list (stub)
│   │   │   ├── availability/page.tsx # Schedule editor (stub)
│   │   │   └── settings/page.tsx     # Profile settings (stub)
│   │   ├── (public)/          # Public layout group (no auth)
│   │   │   ├── layout.tsx     # Minimal header
│   │   │   └── [username]/
│   │   │       ├── page.tsx   # Public profile (stub)
│   │   │       └── [slug]/page.tsx  # Booking page (stub)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── health/route.ts
│   │       └── seed/route.ts
│   ├── generated/
│   │   └── prisma/            # Prisma 7 generated client (gitignored)
│   ├── lib/
│   │   ├── auth.ts            # NextAuth v5 config
│   │   ├── prisma.ts          # PrismaClient singleton
│   │   ├── utils.ts           # cn(), formatDate, generateSlug
│   │   └── validations.ts     # Zod schemas
│   ├── types/
│   │   ├── index.ts           # App types
│   │   └── next-auth.d.ts     # NextAuth type augmentation
│   └── components/
│       ├── ui/                # Shared UI primitives
│       │   ├── button.tsx
│       │   ├── input.tsx
│       │   └── loading.tsx
│       └── providers.tsx      # SessionProvider wrapper
├── tests/
│   ├── helpers/setup.ts       # Vitest global setup with mocks
│   └── unit/
│       └── health.test.ts     # Health endpoint test
├── .github/workflows/
│   ├── ci.yml                 # Lint, typecheck, unit tests, E2E
│   └── deploy.yml             # Vercel deploy on main push
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── next.config.ts
├── postcss.config.js
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── package.json
├── CLAUDE.md                  # Worker instructions
└── README.md
\`\`\`

### Seed Data

Create demo user with predictable credentials:
- **Email:** \`demo@workermill.com\`
- **Password:** \`****\`
- **Username:** \`demo\`
- **Name:** "Alex Demo"
- **Timezone:** \`America/New_York\`

Create one default schedule ("Business Hours"):
- Monday-Friday: 09:00-17:00
- Saturday-Sunday: unavailable

Create two stub event types:
- "30 Minute Meeting" (slug: \`30min\`, duration: 30)
- "60 Minute Consultation" (slug: \`60min\`, duration: 60)

### Landing Page

The landing page is the **public entry point** — visible without authentication.

**Hero section:**
- Headline: "Open Scheduling for Everyone"
- Subheadline: "Create booking pages, manage availability, and let people schedule time with you — no back-and-forth emails."
- CTA button: "Get Started" → \`/signup\`
- Secondary CTA: "Try the Demo" → calls \`signIn()\` with demo credentials

**Features section (3 cards):**
1. "Event Types" — Create different meeting types with custom durations, locations, and questions
2. "Smart Scheduling" — Timezone-aware availability with calendar conflict detection
3. "Team Booking" — Round-robin and collective scheduling for your team

**Footer:** "Built by WorkerMill" with link to workermill.com

### Environment Variables

\`\`\`bash
# Database
DATABASE_URL="****"
DIRECT_DATABASE_URL="****"

# Auth
AUTH_SECRET="****"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="****"
GOOGLE_CLIENT_SECRET="****"

# Email (Resend)
RESEND_API_KEY="****"
EMAIL_FROM="CalMill <noreply@calmill.workermill.com>"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
SEED_TOKEN="****"
\`\`\`

---

## Worker Stories

### Story 1: Core Project Config
**Persona:** \`backend_developer\`

Create foundational configuration:
- \`package.json\` with all dependencies at exact versions specified above
- Scripts: \`dev\`, \`build\`, \`start\`, \`lint\`, \`typecheck\`, \`test\`, \`test:e2e\`, \`postinstall\` (prisma generate)
- \`tsconfig.json\` with ES2022/ESNext, strict mode, path alias \`@/*\` → \`./src/*\`
- \`next.config.ts\` with minimal config (empty object)
- \`prisma.config.ts\` with Prisma 7 configuration: \`schema\` path + \`datasource.url\` (reads \`DIRECT_DATABASE_URL\` with fallbacks — NO \`earlyAccess\`, NO \`url\`/\`directUrl\` in schema)

**Target files:** \`package.json\`, \`tsconfig.json\`, \`next.config.ts\`, \`prisma.config.ts\`

---

### Story 2: Tooling and TailwindCSS 4 Configuration
**Persona:** \`frontend_developer\`

Configure linting, formatting, and TailwindCSS 4 CSS-first setup:
- \`.eslintrc.json\` — ESLint 9 extending next/core-web-vitals and TypeScript
- \`.prettierrc\` — Single quotes, trailing commas, 100 char width, tab width 2
- \`postcss.config.js\` — \`@tailwindcss/postcss\` plugin (NOT \`tailwindcss\` directly)
- \`src/app/globals.css\` — \`@import "tailwindcss"\` with \`@theme\` block defining custom colors (primary blue scale), fonts (Inter, JetBrains Mono), and border-radius tokens
- \`.gitignore\` — node_modules, .next, .env, coverage, src/generated
- \`.env.example\` — Full template with all env vars

**CRITICAL:** No \`tailwind.config.js\` or \`tailwind.config.ts\`. TailwindCSS 4 does not use JavaScript config files. All customization goes in the CSS \`@theme\` block.

**Target files:** \`.eslintrc.json\`, \`.prettierrc\`, \`postcss.config.js\`, \`src/app/globals.css\`, \`.gitignore\`, \`.env.example\`

---

### Story 3: Prisma 7 Schema and Seed Script
**Persona:** \`backend_developer\`

Database foundation:
- \`prisma/schema.prisma\` — Complete schema with all 13 models and 3 enums as specified above
- \`prisma/seed.ts\` — Creates demo user (bcryptjs hash), default schedule with availability, and two event types
- Ensure \`prisma.seed\` is configured in \`package.json\` for \`tsx\` execution

**Data relationships to enforce:**
- User 1:N EventType, Booking, Schedule, TeamMember, Webhook, CalendarConnection, Account, Session
- Schedule 1:N Availability, DateOverride, EventType
- EventType 1:N Booking
- Team 1:N TeamMember, EventType
- Cascade deletes on: User→Account, User→Session, User→Schedule, Schedule→Availability, Schedule→DateOverride, User→TeamMember, Team→TeamMember

**Target files:** \`prisma/schema.prisma\`, \`prisma/seed.ts\`

---

### Story 4: Lib Utilities, Auth, and Types
**Persona:** \`backend_developer\`

Core application libraries:
- \`src/lib/auth.ts\` — NextAuth v5 config with Credentials + Google providers, PrismaAdapter, JWT strategy, custom callbacks exposing \`id\`, \`username\`, \`timezone\` on session
- \`src/lib/prisma.ts\` — PrismaClient singleton imported from \`@/generated/prisma/client\` (Prisma 7 pattern). Must use \`PrismaNeon\` adapter from \`@prisma/adapter-neon\` with \`DATABASE_URL\` (pooled connection string). Use global cache in development to prevent connection exhaustion.
- \`src/lib/utils.ts\` — \`cn()\` (clsx + twMerge), \`formatDate()\`, \`generateSlug()\`, \`generateUsername()\` (from email), \`debounce()\`
- \`src/lib/validations.ts\` — Zod 4 schemas: \`loginSchema\`, \`signupSchema\`, \`eventTypeSchema\`, \`bookingSchema\`, \`scheduleSchema\`
- \`src/types/index.ts\` — TypeScript types with Prisma relations, API response types \`ApiResponse<T>\`, \`PaginatedResponse<T>\`
- \`src/types/next-auth.d.ts\` — Module augmentation adding \`id\`, \`username\`, \`timezone\` to \`session.user\`

**Target files:** \`src/lib/auth.ts\`, \`src/lib/prisma.ts\`, \`src/lib/utils.ts\`, \`src/lib/validations.ts\`, \`src/types/index.ts\`, \`src/types/next-auth.d.ts\`

---

### Story 5: Test Configuration
**Persona:** \`qa_engineer\`

Testing infrastructure:
- \`vitest.config.ts\` — Node environment, path alias support (\`@/*\` → \`./src/*\`), v8 coverage targeting \`src/**/*.ts\`, global test APIs, exclude \`e2e/\` and \`node_modules/\`
- \`playwright.config.ts\` — Chromium-only for speed, CI-optimized retries (2 in CI, 0 local), HTML reporter, \`baseURL: http://localhost:3000\`, web server integration for local dev
- \`tests/helpers/setup.ts\` — Global test setup: Prisma mock (all models), NextAuth mock (session with demo user), automatic mock reset between tests

**Target files:** \`vitest.config.ts\`, \`playwright.config.ts\`, \`tests/helpers/setup.ts\`, \`tests/unit/health.test.ts\`

---

### Story 6: App Shell — Landing, Login, Signup Pages
**Persona:** \`frontend_developer\`

User-facing public pages:
- \`src/app/layout.tsx\` — Root layout with Inter font (next/font/google), TailwindCSS globals, metadata (title: "CalMill — Open Scheduling"), SessionProvider wrapper
- \`src/app/page.tsx\` — Landing page as specified above (hero, features, footer). No auth required.
- \`src/app/login/page.tsx\` — Email/password form, "Try Demo" button (auto-fills demo credentials), link to signup, Suspense wrapper for \`useSearchParams()\`, calls \`signIn("credentials")\`, redirects to \`/event-types\` on success
- \`src/app/signup/page.tsx\` — Name, email, username, password form with Zod validation. POST to \`/api/auth/signup\`, auto-login after success, redirect to \`/getting-started\`
- \`src/app/getting-started/page.tsx\` — Simple onboarding stub: "Welcome! Set up your availability to get started." with link to \`/availability\`
- \`src/components/providers.tsx\` — Client component wrapping \`SessionProvider\`

**Target files:** \`src/app/layout.tsx\`, \`src/app/page.tsx\`, \`src/app/login/page.tsx\`, \`src/app/signup/page.tsx\`, \`src/app/getting-started/page.tsx\`, \`src/components/providers.tsx\`

---

### Story 7: Dashboard Layout — Sidebar, Header, Navigation
**Persona:** \`frontend_developer\`

Authenticated layout shell:
- \`src/app/(dashboard)/layout.tsx\` — Server component: check \`auth()\`, redirect to \`/login\` if unauthenticated. Renders sidebar + header + main content area.
- \`src/components/sidebar.tsx\` — Navigation links:
  - Event Types (\`/event-types\`) — Calendar icon
  - Bookings (\`/bookings\`) — Inbox icon
  - Availability (\`/availability\`) — Clock icon
  - Settings (\`/settings\`) — Gear icon
  - Collapsible on mobile with hamburger menu
- \`src/components/header.tsx\` — Current page title, user avatar dropdown (profile link, sign out), timezone display
- \`src/app/(dashboard)/event-types/page.tsx\` — Stub: "Your event types will appear here"
- \`src/app/(dashboard)/bookings/page.tsx\` — Stub: "Your bookings will appear here"
- \`src/app/(dashboard)/availability/page.tsx\` — Stub: "Manage your availability"
- \`src/app/(dashboard)/settings/page.tsx\` — Stub: "Account settings"

**Target files:** \`src/app/(dashboard)/layout.tsx\`, \`src/components/sidebar.tsx\`, \`src/components/header.tsx\`, plus 4 stub pages

---

### Story 8: Public Booking Layout Shell
**Persona:** \`frontend_developer\`

Public-facing layout for booking pages (no auth required):
- \`src/app/(public)/layout.tsx\` — Minimal layout: CalMill logo in top-left corner, no sidebar, no auth check. Clean white background with centered content area.
- \`src/app/(public)/[username]/page.tsx\` — Stub: Displays "Loading {username}'s profile..." placeholder. Will show event type cards in CM-3.
- \`src/app/(public)/[username]/[slug]/page.tsx\` — Stub: Displays "Loading booking page..." placeholder. Will show calendar + slot picker in CM-3.

**Target files:** \`src/app/(public)/layout.tsx\`, \`src/app/(public)/[username]/page.tsx\`, \`src/app/(public)/[username]/[slug]/page.tsx\`

---

### Story 9: API Routes — Health, Seed, Auth
**Persona:** \`backend_developer\`

Three API endpoints:
- **\`GET /api/health\`** — Returns \`{ status: "ok", timestamp, version: "1.0.0" }\` with 200. On error returns 500.
- **\`POST /api/seed\`** — Protected by \`SEED_TOKEN\` via Bearer header. Creates demo user with bcryptjs hash (12 rounds), default schedule, availability rows (Mon-Fri 09:00-17:00), and two event types. Idempotent (upsert, not create).
- **\`GET/POST /api/auth/[...nextauth]/route.ts\`** — NextAuth v5 route handler: \`export const { GET, POST } = handlers\` from \`src/lib/auth.ts\`
- **\`POST /api/auth/signup\`** — Creates new user: validate with \`signupSchema\`, check email + username uniqueness, hash password with bcryptjs, create user + default schedule + default availability, return user object (no password). Returns 409 on duplicate email/username.

**Target files:** \`src/app/api/health/route.ts\`, \`src/app/api/seed/route.ts\`, \`src/app/api/auth/[...nextauth]/route.ts\`, \`src/app/api/auth/signup/route.ts\`

---

### Story 10: CI/CD Pipelines and Documentation
**Persona:** \`devops_engineer\`

Infrastructure and docs:
- **\`.github/workflows/ci.yml\`** — Triggered on push and PR to main. Jobs: lint, typecheck, unit tests (Vitest), build. Node.js 24. Postgres service container for tests. Parallel job execution.
- **\`.github/workflows/deploy.yml\`** — Triggered on push to main after CI passes. Steps: run migration (\`prisma db push\`), seed demo data, deploy to Vercel, health check verification.
- **\`CLAUDE.md\`** — Worker development guide:
  - Tech stack with versions
  - Key conventions: Prisma 7 import from \`@/generated/prisma\`, TailwindCSS 4 CSS-first, NextAuth v5 \`auth()\` pattern
  - Common commands: \`npm run dev\`, \`npm run build\`, \`npx prisma db push\`, \`npx prisma generate\`
  - File structure overview
  - Testing commands
- **\`README.md\`** — Project overview, local setup instructions, environment variable documentation, architecture diagram

**Target files:** \`.github/workflows/ci.yml\`, \`.github/workflows/deploy.yml\`, \`CLAUDE.md\`, \`README.md\`

---

## Pre-Provisioned Infrastructure

The following infrastructure is already set up. Workers do NOT need to create these — just use them.

| Resource | Value |
|----------|-------|
| **GitHub Repo** | \`workermill-examples/calmill\` (private) |
| **Vercel Project ID** | \`prj_X16gHljg2G3W6CDAKKWQZuDEVvhu\` |
| **Vercel Team ID** | \`team_2ASKtHtTGR8ex1m1CxSgB6kw\` |
| **DNS** | \`calmill.workermill.com\` → CNAME \`cname.vercel-dns.com\` (Route53) |
| **Database** | Neon PostgreSQL (connection strings in env vars) |
| **Auto-deploy** | **DISABLED** — deployments are manual only via deploy hook |
| **Deploy Hook** | \`https://api.vercel.com/v1/integrations/deploy/prj_X16gHljg2G3W6CDAKKWQZuDEVvhu/OvGTaerjqm\` |

### Vercel Environment Variables (already set)

- \`DATABASE_URL\` — Neon pooled connection string
- \`DIRECT_DATABASE_URL\` — Neon direct connection string
- \`AUTH_SECRET\` — NextAuth secret (generated)
- \`NEXTAUTH_URL\` — \`https://calmill.workermill.com\`
- \`NEXT_PUBLIC_APP_URL\` — \`https://calmill.workermill.com\`

### GitHub Actions Secrets (already set)

- \`DATABASE_URL\`, \`DIRECT_DATABASE_URL\`, \`AUTH_SECRET\`
- \`VERCEL_TOKEN\`, \`VERCEL_ORG_ID\`, \`VERCEL_PROJECT_ID\`

### Deployment (Story 10)

The deploy workflow should use the Vercel CLI with the pre-set secrets:

\`\`\`yaml
- run: npx vercel pull --yes --environment=production --token=\${{ secrets.VERCEL_TOKEN }}
- run: npx vercel build --prod --token=\${{ secrets.VERCEL_TOKEN }}
- run: npx vercel deploy --prebuilt --prod --token=\${{ secrets.VERCEL_TOKEN }}
\`\`\`

**Do NOT enable auto-deploy.** The \`deploy.yml\` workflow is the only deployment path.

---`,
    buildLog: `**WorkerMill** — 2026-02-16 23:52 UTC

**Planning** — Critic approved plan (score: 91/100)
- 9 stories decomposed across 4 priority levels
- Critic feedback: split core config into parallel tracks for faster execution

**Story 0: Core Project Config** — completed by backend_developer
- Created package.json with Next.js 16.1.0, React 19.2, Prisma 7.4
- TailwindCSS 4 CSS-first configuration (no tailwind.config.js)
- Prisma 7 config with \`prisma.config.ts\` pattern (new in v7)

**Story 1: Prisma Schema & Seed** — completed by backend_developer
- 13-model scheduling schema: User, EventType, Schedule, Availability, Booking, Team, TeamMember, etc.
- Neon serverless adapter with driver adapter pattern
- Demo user seed (demo@workermill.com / demo1234)

**Story 2: Auth & Lib Utilities** — completed by backend_developer
- NextAuth v5 beta with credentials provider and JWT strategy
- Zod 4 validation schemas for all forms
- Prisma client singleton with Neon adapter

**Story 3: App Shell & Auth Pages** — completed by frontend_developer
- Landing page with hero section and "Try the Demo" CTA
- Login/signup forms with dark theme styling
- Dashboard sidebar layout with navigation stubs

**Story 4: Public Booking Layout** — completed by frontend_developer
- Public-facing booking page shell for shared scheduling links
- Responsive layout with timezone support UI

**Story 5: API Routes** — completed by backend_developer
- Health check, seed, and NextAuth catch-all routes
- Protected seed endpoint with SEED_TOKEN authorization

**Story 6: CI/CD Pipelines** — completed by devops_engineer
- GitHub Actions CI: lint, typecheck, unit tests, security audit
- Deploy workflow: migrations, seed, health check verification

**Story 7: Test Infrastructure** — completed by qa_engineer
- Vitest 4 configuration with path aliases
- Playwright config for E2E testing
- 4 initial unit tests passing

**Story 8: Documentation** — completed by devops_engineer
- CLAUDE.md for AI worker guidance
- README.md with setup instructions and demo credentials

🔄 **Revision 1/3** — Tech lead found 8 ESLint errors (unused imports, unescaped apostrophes)
✅ **Approved** (9/10) — All lint errors fixed, 0 TypeScript errors, 4/4 unit tests passing`,
  },
  {
    id: "cm-2",
    title: "CM-2: Core Backend — Event Types, Schedules & Slots",
    priority: "high",
    storyCount: 7,
    duration: "~69 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 3,
    prUrl: "https://github.com/workermill-examples/calmill/pull/3",
    commentCount: 76,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
    ],
    description: `# CM-2: Core Backend — Event Types, Schedules & Slots

---

## Epic Overview

Build the complete backend API for CalMill — auth middleware, event type CRUD, schedule/availability management, the **slot calculation engine** (the algorithmic core of the product), booking creation/cancellation, and comprehensive unit tests. This epic transforms the CM-1 skeleton into a fully functional scheduling backend.

**Deliverables:**

1. Auth middleware with session validation and ownership checks
2. Event type CRUD (create, read, update, delete, toggle active)
3. Schedule and availability CRUD with date overrides
4. **Slot calculation engine** — timezone-aware available time slot computation
5. Booking creation, confirmation, cancellation, and rescheduling
6. Expanded seed data (6 event types, 15 bookings, 2 schedules)
7. Comprehensive unit test suite (50+ tests)

---

## Technical Specification

### Auth Middleware

**\`src/lib/api-auth.ts\`:**

\`\`\`typescript
// Helper to get authenticated user in API routes
export async function getAuthenticatedUser(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user: session.user };
}

// Helper to verify resource ownership
export async function verifyOwnership(userId: string, resourceUserId: string) {
  if (userId !== resourceUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
\`\`\`

All mutating routes MUST validate:
1. User is authenticated (valid session)
2. User owns the resource being modified (event type, schedule, booking)
3. Input passes Zod validation before database operations

### Event Type Routes

**\`src/app/api/event-types/route.ts\`:**
- \`GET /api/event-types\` — List authenticated user's event types. Include booking counts. Ordered by \`createdAt\` DESC.
- \`POST /api/event-types\` — Create event type. Validate with \`eventTypeCreateSchema\`. Auto-generate slug from title (lowercase, hyphenated, deduped with \`-2\`, \`-3\` suffix). Assign user's default schedule if \`scheduleId\` not provided.

**\`src/app/api/event-types/[id]/route.ts\`:**
- \`GET /api/event-types/[id]\` — Get single event type with schedule, bookings count, and custom questions.
- \`PUT /api/event-types/[id]\` — Update event type. Validate with \`eventTypeUpdateSchema\`. Verify ownership.
- \`DELETE /api/event-types/[id]\` — Delete event type. Verify ownership. Cascade-delete bookings with status CANCELLED.

**\`src/app/api/event-types/[id]/toggle/route.ts\`:**
- \`PATCH /api/event-types/[id]/toggle\` — Toggle \`isActive\` boolean. Verify ownership.

### Zod Schemas for Event Types

\`\`\`typescript
export const eventTypeCreateSchema = z.object({
  title: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(), // auto-generated if omitted
  description: z.string().max(500).optional(),
  duration: z.number().int().min(5).max(720), // 5 min to 12 hours
  locations: z.array(z.object({
    type: z.enum(["inPerson", "link", "phone"]),
    value: z.string(),
  })).optional(),
  requiresConfirmation: z.boolean().optional(),
  price: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  minimumNotice: z.number().int().min(0).optional(),
  beforeBuffer: z.number().int().min(0).max(120).optional(),
  afterBuffer: z.number().int().min(0).max(120).optional(),
  slotInterval: z.number().int().min(5).max(120).optional(),
  maxBookingsPerDay: z.number().int().min(1).optional(),
  maxBookingsPerWeek: z.number().int().min(1).optional(),
  futureLimit: z.number().int().min(1).max(365).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  customQuestions: z.array(z.object({
    id: z.string(),
    label: z.string().min(1),
    type: z.enum(["text", "textarea", "select", "radio", "checkbox", "phone"]),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
  })).optional(),
  scheduleId: z.string().cuid().optional(),
  recurringEnabled: z.boolean().optional(),
  recurringMaxOccurrences: z.number().int().min(1).max(52).optional(),
  recurringFrequency: z.enum(["weekly", "biweekly", "monthly"]).optional(),
});
\`\`\`

### Schedule & Availability Routes

**\`src/app/api/schedules/route.ts\`:**
- \`GET /api/schedules\` — List user's schedules with availability and date overrides.
- \`POST /api/schedules\` — Create schedule with availability windows. If \`isDefault: true\`, unset any existing default schedule. Validate timezone string against Intl.supportedValuesOf('timeZone').

**\`src/app/api/schedules/[id]/route.ts\`:**
- \`GET /api/schedules/[id]\` — Single schedule with all availability rows and date overrides.
- \`PUT /api/schedules/[id]\` — Update schedule. Supports full availability replacement: delete existing rows and recreate from payload. This is simpler than partial updates.
- \`DELETE /api/schedules/[id]\` — Delete schedule. Fail if any event types reference this schedule (return 409). Cannot delete if it's the only schedule.

**\`src/app/api/schedules/[id]/overrides/route.ts\`:**
- \`GET /api/schedules/[id]/overrides\` — List date overrides for a schedule, ordered by date ASC.
- \`POST /api/schedules/[id]/overrides\` — Create date override. Validate date is in the future. Prevent duplicate overrides for the same date.
- \`DELETE /api/schedules/[id]/overrides/[overrideId]\` — Delete a date override.

### Zod Schemas for Schedules

\`\`\`typescript
export const scheduleCreateSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1), // validated against Intl.supportedValuesOf
  isDefault: z.boolean().optional(),
  availability: z.array(z.object({
    day: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:mm
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  })).min(1),
});

export const dateOverrideSchema = z.object({
  date: z.string().date(), // YYYY-MM-DD
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  isUnavailable: z.boolean().optional(),
});
\`\`\`

### Slot Calculation Engine (CRITICAL — the core algorithm)

**\`src/lib/slots.ts\`:**

This is the most complex piece of the entire CalMill application. The slot calculator must be timezone-aware, respect buffers, check booking conflicts, and enforce booking limits.

**Function signature:**
\`\`\`typescript
export async function getAvailableSlots(params: {
  eventTypeId: string;
  startDate: string;     // YYYY-MM-DD in attendee's timezone
  endDate: string;       // YYYY-MM-DD in attendee's timezone
  timezone: string;      // Attendee's IANA timezone (e.g., "Europe/London")
}): Promise<AvailableSlot[]>

type AvailableSlot = {
  time: string;          // ISO 8601 datetime in UTC
  localTime: string;     // HH:mm in attendee's timezone
  duration: number;      // minutes
};
\`\`\`

**Algorithm (step by step):**

1. **Load event type** with its associated schedule, availability rows, and date overrides.

2. **Load existing bookings** for the date range (status NOT CANCELLED/REJECTED). Include buffer times in the conflict window:
   \`\`\`
   conflictStart = booking.startTime - eventType.beforeBuffer
   conflictEnd = booking.endTime + eventType.afterBuffer
   \`\`\`

3. **For each day in the requested range:**

   a. **Determine availability windows for this day:**
      - Check date overrides first (they take priority):
        - If \`isUnavailable === true\` → skip this day entirely
        - If override has \`startTime/endTime\` → use those instead of regular availability
      - If no override, look up \`Availability\` rows where \`day\` matches the day-of-week
      - Convert availability times from schedule timezone to UTC using \`@date-fns/tz\`

   b. **Generate candidate slots within each availability window:**
      - Slot interval = \`eventType.slotInterval ?? eventType.duration\`
      - Start from window start time, increment by slot interval
      - Each slot spans: \`[slotStart, slotStart + duration]\`
      - Stop when \`slotStart + duration > window end time\`

   c. **Filter out invalid slots:**
      - **Minimum notice:** Remove slots where \`slotStart < now + minimumNotice\`
      - **Future limit:** Remove slots where \`slotStart > now + futureLimit days\`
      - **Booking conflicts:** Remove slots where \`[slotStart - beforeBuffer, slotStart + duration + afterBuffer]\` overlaps with any existing booking's conflict window
      - **Daily booking limit:** If \`maxBookingsPerDay\` is set, count existing bookings for this day and skip if at limit
      - **Weekly booking limit:** If \`maxBookingsPerWeek\` is set, count existing bookings for this week (Mon-Sun) and skip if at limit

   d. **Convert remaining slots to attendee's timezone** for the response.

4. **Return sorted array** of available slots grouped by date.

**Timezone handling rules:**
- Schedule availability times are stored in the **schedule's timezone** (e.g., "09:00" in "America/New_York")
- Bookings are stored in **UTC**
- Slot calculation converts everything to UTC for comparison, then converts results to the **attendee's timezone**
- Use \`@date-fns/tz\` functions: \`TZDate\`, \`toZonedTime\`, \`fromZonedTime\`
- NEVER use \`new Date()\` directly for timezone conversions

**Public endpoint:**

**\`src/app/api/slots/route.ts\`:**
- \`GET /api/slots?eventTypeId=xxx&startDate=2026-02-20&endDate=2026-02-27&timezone=Europe/London\`
- No authentication required (public endpoint for booking pages)
- Validate query params with Zod
- Call \`getAvailableSlots()\` and return results
- Cache response for 60 seconds (stale-while-revalidate)

### Booking Routes

**\`src/app/api/bookings/route.ts\`:**
- \`GET /api/bookings\` — List authenticated user's bookings. Query params: \`status\` (filter), \`startDate\`/\`endDate\` (range), \`page\`/\`limit\` (pagination). Include event type title and attendee info. Ordered by \`startTime\` ASC for upcoming, DESC for past.
- \`POST /api/bookings\` — Create booking (public endpoint, no auth required). Validate with \`bookingCreateSchema\`. Steps:
  1. Validate the requested slot is still available (call \`getAvailableSlots\` and check)
  2. Create booking with status \`PENDING\` (or \`ACCEPTED\` if event type does not require confirmation)
  3. Return booking with UID for confirmation page

**\`src/app/api/bookings/[uid]/route.ts\`:**
- \`GET /api/bookings/[uid]\` — Get booking by UID. Public endpoint (attendees access via emailed link). Return event type details, host info (name, avatar), meeting details.
- \`PATCH /api/bookings/[uid]\` — Update booking status. Actions:
  - \`accept\` — Set status to ACCEPTED (host only, requires auth)
  - \`reject\` — Set status to REJECTED with reason (host only)
  - \`cancel\` — Set status to CANCELLED with reason (host or attendee via UID)
- \`PUT /api/bookings/[uid]/reschedule\` — Reschedule booking. Validate new time slot is available. Create new booking, mark old one as RESCHEDULED. Link via \`recurringEventId\` field.

### Zod Schemas for Bookings

\`\`\`typescript
export const bookingCreateSchema = z.object({
  eventTypeId: z.string().cuid(),
  startTime: z.string().datetime(), // ISO 8601 UTC
  attendeeName: z.string().min(1).max(100),
  attendeeEmail: z.string().email(),
  attendeeTimezone: z.string(),
  attendeeNotes: z.string().max(1000).optional(),
  location: z.string().optional(),
  responses: z.record(z.string(), z.any()).optional(), // custom question responses
  recurringCount: z.number().int().min(1).max(52).optional(), // for recurring bookings
});

export const bookingActionSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
  reason: z.string().max(500).optional(),
});

export const bookingRescheduleSchema = z.object({
  startTime: z.string().datetime(),
  reason: z.string().max(500).optional(),
});
\`\`\`

### Seed Data Expansion

Expand the CM-1 seed to include:
- **6 event types** for demo user:
  1. "Quick Chat" — 15min, no confirmation, free
  2. "30 Minute Meeting" — 30min, no confirmation, free (existing)
  3. "60 Minute Consultation" — 60min, requires confirmation, free (existing)
  4. "Technical Interview" — 45min, requires confirmation, $0, 24h minimum notice
  5. "Pair Programming" — 90min, link location (Google Meet stub), 2h buffer after
  6. "Coffee Chat" — 20min, in-person location "123 Main St", free, inactive
- **2 schedules:**
  1. "Business Hours" — Mon-Fri 09:00-17:00, America/New_York (default)
  2. "Extended Hours" — Mon-Fri 08:00-20:00, Sat 10:00-14:00
- **15 bookings** spread across the next 30 days with mixed statuses (8 ACCEPTED, 3 PENDING, 2 CANCELLED, 2 past/completed)
- **2 date overrides** — one blocking a specific date, one with modified hours

---

## Worker Stories

### Story 1: Auth Middleware and Shared Helpers
**Persona:** \`backend_developer\`

Create authentication and authorization helpers:
- \`src/lib/api-auth.ts\` — \`getAuthenticatedUser()\`, \`verifyOwnership()\`, \`withAuth()\` HOF wrapper
- Additional Zod schemas in \`src/lib/validations.ts\` — all schemas defined in this spec
- Extended types in \`src/types/index.ts\` — \`AvailableSlot\`, \`BookingWithDetails\`, \`EventTypeWithSchedule\`

**Target files:** \`src/lib/api-auth.ts\`, \`src/lib/validations.ts\` (extend), \`src/types/index.ts\` (extend)

---

### Story 2: Event Type CRUD Routes
**Persona:** \`backend_developer\`

Full event type management:
- \`src/app/api/event-types/route.ts\` — GET (list) and POST (create)
- \`src/app/api/event-types/[id]/route.ts\` — GET, PUT, DELETE
- \`src/app/api/event-types/[id]/toggle/route.ts\` — PATCH toggle isActive
- Auto-slug generation with deduplication
- Ownership verification on all mutations
- Include booking counts in list response

**Target files:** \`src/app/api/event-types/route.ts\`, \`src/app/api/event-types/[id]/route.ts\`, \`src/app/api/event-types/[id]/toggle/route.ts\`

---

### Story 3: Schedule & Availability Routes
**Persona:** \`backend_developer\`

Schedule management with full availability replacement:
- \`src/app/api/schedules/route.ts\` — GET (list) and POST (create)
- \`src/app/api/schedules/[id]/route.ts\` — GET, PUT (full replacement), DELETE (with reference check)
- \`src/app/api/schedules/[id]/overrides/route.ts\` — GET, POST for date overrides
- \`src/app/api/schedules/[id]/overrides/[overrideId]/route.ts\` — DELETE
- Timezone validation against \`Intl.supportedValuesOf('timeZone')\`
- Default schedule management (only one can be default)

**Target files:** \`src/app/api/schedules/route.ts\`, \`src/app/api/schedules/[id]/route.ts\`, \`src/app/api/schedules/[id]/overrides/route.ts\`, \`src/app/api/schedules/[id]/overrides/[overrideId]/route.ts\`

---

### Story 4: Slot Calculation Engine
**Persona:** \`backend_developer\`

The core scheduling algorithm:
- \`src/lib/slots.ts\` — \`getAvailableSlots()\` function implementing the full algorithm specified above
- Must handle: timezone conversions, buffer times, booking conflicts, date overrides, daily/weekly limits, minimum notice, future limit
- Use \`@date-fns/tz\` for all timezone operations. Import \`TZDate\` for timezone-aware date construction.
- \`src/app/api/slots/route.ts\` — Public GET endpoint with query param validation
- Include helper functions: \`generateSlotsForWindow()\`, \`isSlotConflicting()\`, \`countBookingsForDay()\`, \`countBookingsForWeek()\`

**Target files:** \`src/lib/slots.ts\`, \`src/app/api/slots/route.ts\`

---

### Story 5: Booking Routes
**Persona:** \`backend_developer\`

Booking lifecycle management:
- \`src/app/api/bookings/route.ts\` — GET (authenticated list with filters) and POST (public creation)
- \`src/app/api/bookings/[uid]/route.ts\` — GET (public by UID), PATCH (status actions), PUT reschedule
- Slot availability re-verification on booking creation (prevent race conditions)
- Status transition validation (PENDING → ACCEPTED/REJECTED, ACCEPTED → CANCELLED, etc.)
- Attendee access via UID (no auth required for their own booking)

**Target files:** \`src/app/api/bookings/route.ts\`, \`src/app/api/bookings/[uid]/route.ts\`

---

### Story 6: Public Profile Route
**Persona:** \`backend_developer\`

Public API for booking pages:
- \`src/app/api/users/[username]/route.ts\` — GET public user profile (name, username, avatarUrl, bio). No email, no private data.
- \`src/app/api/users/[username]/event-types/route.ts\` — GET active event types for a user. Only return: title, slug, description, duration, locations, price, currency. No internal IDs or scheduling config.

**Target files:** \`src/app/api/users/[username]/route.ts\`, \`src/app/api/users/[username]/event-types/route.ts\`

---

### Story 7: Seed Data Expansion
**Persona:** \`backend_developer\`

Expand \`prisma/seed.ts\` with comprehensive demo data as specified above. All seed operations must be idempotent (upsert). Bookings should have realistic times spread across the next 30 days. Include variety in statuses, durations, and attendee info.

**Target files:** \`prisma/seed.ts\`

---

### Story 8: Unit Test Suite
**Persona:** \`qa_engineer\`

Comprehensive test coverage:
- \`tests/unit/event-types.test.ts\` — 12+ tests: CRUD operations, slug generation, ownership, toggle
- \`tests/unit/schedules.test.ts\` — 10+ tests: CRUD, timezone validation, default schedule, override management
- \`tests/unit/slots.test.ts\` — 15+ tests: basic slot generation, buffer times, booking conflicts, date overrides, timezone conversions, daily/weekly limits, minimum notice, future limit, edge cases (midnight crossing, DST transitions)
- \`tests/unit/bookings.test.ts\` — 12+ tests: creation, status transitions, cancellation, reschedule, slot re-verification

Slot calculation tests are the most important — cover edge cases thoroughly.

**Target files:** \`tests/unit/event-types.test.ts\`, \`tests/unit/schedules.test.ts\`, \`tests/unit/slots.test.ts\`, \`tests/unit/bookings.test.ts\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 01:55 UTC

**Planning** — Critic approved plan
- 7 stories covering API routes, validation, and slot calculation

**Story 0: Auth Helpers & Zod Schemas** — completed by backend_developer
- Session helper functions for protected API routes
- Comprehensive Zod schemas for event types, schedules, bookings

**Story 1: Event Type CRUD** — completed by backend_developer
- Full CRUD API routes for event types
- Duration, location, custom questions support
- Slug-based public URLs for booking pages

**Story 2: Schedule & Availability** — completed by backend_developer
- Weekly recurring schedule management
- Date-specific overrides (vacations, holidays)
- Multiple schedule support per user

**Story 3: Slot Calculation Engine** — completed by backend_developer
- Timezone-aware slot generation using date-fns
- Conflict detection against existing bookings
- Buffer time between appointments

**Story 4: Booking API** — completed by backend_developer
- Create, cancel, and reschedule bookings
- Confirmation token generation
- Status lifecycle (pending → confirmed → cancelled)

**Story 5: Shared Types & Utilities** — completed by backend_developer
- TypeScript interfaces for API responses
- Pagination helpers and query builders

**Story 6: API Tests** — completed by qa_engineer
- Unit tests for slot calculation logic
- API route integration tests

✅ **Approved** (9/10) — Clean API design, proper auth guards on all routes`,
  },
  {
    id: "cm-3",
    title: "CM-3: Public Booking Experience",
    priority: "high",
    storyCount: 6,
    duration: "~63 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 4,
    prUrl: "https://github.com/workermill-examples/calmill/pull/4",
    commentCount: 76,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
    ],
    description: `# CM-3: Public Booking Experience

---

## Epic Overview

Build the public-facing booking experience — the most important user-facing feature of CalMill. This includes the user profile page, event type selection, an interactive calendar date picker, timezone-aware slot grid, booking form with custom questions, confirmation page, and cancel/reschedule flows. All pages are public (no authentication required).

**Deliverables:**

1. Public user profile page showing active event types
2. Event type booking page with interactive calendar
3. Timezone selector with auto-detection
4. Available slots grid with loading states
5. Booking form with custom question support
6. Booking confirmation page with calendar add links
7. Booking cancellation and reschedule pages
8. E2E tests for the complete booking flow

---

## Technical Specification

### URL Structure

\`\`\`
/demo                    → User profile (list of event types)
/demo/30min              → Booking page for "30 Minute Meeting"
/demo/30min?date=2026-02-20&month=2026-02  → With pre-selected date
/booking/[uid]           → Booking confirmation/details
/booking/[uid]/cancel    → Cancellation form
/booking/[uid]/reschedule → Reschedule flow
\`\`\`

### Public User Profile Page

**\`src/app/(public)/[username]/page.tsx\`** — Server component.

**Data fetching:** Call \`GET /api/users/[username]\` and \`GET /api/users/[username]/event-types\` on the server using \`fetch\` with \`{ cache: "no-store" }\` (availability changes frequently).

**Layout:**
- User avatar (or initials fallback), name, bio at the top
- Grid of event type cards below (2 columns on desktop, 1 on mobile)
- Each card shows:
  - Color dot (from event type color) + title
  - Duration badge ("30 min", "1 hr")
  - Description (truncated to 2 lines)
  - Location icon (video, in-person, phone)
  - Price if non-zero ("$50")
  - Arrow icon linking to \`/[username]/[slug]\`

**Empty state:** If user has no active event types, show "No available event types" message.

**404 handling:** If username doesn't exist, render Next.js \`notFound()\`.

### Booking Page

**\`src/app/(public)/[username]/[slug]/page.tsx\`** — Server component wrapper.
**\`src/components/booking/booking-page-client.tsx\`** — Client component with all interactive state.

This is the most complex UI in CalMill. It has 3 states:

#### State 1: Date & Time Selection

**Left panel (calendar):**
- Month/year header with prev/next navigation arrows
- Day-of-week headers (respecting user's \`weekStart\` preference)
- Calendar grid showing days of the month
- Days with available slots are clickable (normal weight)
- Days with no available slots are grayed out and not clickable
- Past days are grayed out
- Selected date has primary-color background
- Today has a dot indicator

**Right panel (time slots):**
- Timezone selector at the top (dropdown with search, auto-detected from browser \`Intl.DateTimeFormat().resolvedOptions().timeZone\`)
- Date header showing selected date in attendee's timezone ("Thursday, February 20")
- Available slots as clickable buttons arranged in a vertical list
- Each slot shows time in attendee's timezone ("10:00 AM", "10:30 AM", etc.)
- Clicking a slot highlights it and shows a "Confirm" button
- Loading skeleton while slots are being fetched
- Empty state: "No available times on this date"

**Data flow:**
1. On mount, detect timezone from browser
2. Fetch slots for the current month: \`GET /api/slots?eventTypeId=xxx&startDate=YYYY-MM-01&endDate=YYYY-MM-31&timezone=yyy\`
3. Mark calendar days with availability
4. On date click, show slots for that date (already fetched)
5. On month change, fetch new month's slots
6. On timezone change, re-fetch all slots

**Event type header (above panels):**
- Back arrow to profile page
- Event type title, duration, location
- Color bar at top matching event type color

#### State 2: Booking Form

After selecting a time slot and clicking "Confirm":

- Slide/animate from calendar view to form view
- **Selected time summary** at top: "Thursday, February 20, 2026 at 10:00 AM (EST)" with edit link back to calendar
- **Required fields:**
  - Name (text input)
  - Email (email input)
- **Optional standard field:**
  - Notes / additional info (textarea)
- **Custom questions** (rendered dynamically from event type's \`customQuestions\` array):
  - \`text\` → text input
  - \`textarea\` → textarea
  - \`select\` → dropdown select
  - \`radio\` → radio button group
  - \`checkbox\` → checkbox
  - \`phone\` → phone input with country code
  - Respect \`required\` flag
- **"Schedule Meeting" button** at the bottom
- Loading state during submission
- Error state with retry option

**Form submission:** POST to \`/api/bookings\` with all data. On success, redirect to \`/booking/[uid]\`.

#### State 3: Booking Confirmation

This is a separate page at \`/booking/[uid]\`.

### Booking Confirmation Page

**\`src/app/(public)/booking/[uid]/page.tsx\`:**

- Success icon (checkmark in green circle)
- "Your meeting has been scheduled!" heading
- Event type title and duration
- Date and time in attendee's timezone
- Host name and avatar
- Location / meeting link
- **"Add to Calendar" buttons:**
  - Google Calendar (link: \`https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&details=...\`)
  - Outlook (.ics file download)
  - Apple Calendar (.ics file download)
- Attendee info (name, email)
- Custom question responses (if any)
- **Actions:** "Reschedule" link, "Cancel" link
- Booking UID displayed for reference

**ICS file generation:** Create a utility \`src/lib/ics.ts\` that generates valid iCalendar (.ics) format:
\`\`\`
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260220T150000Z
DTEND:20260220T153000Z
SUMMARY:30 Minute Meeting with Alex Demo
DESCRIPTION:...
LOCATION:...
END:VEVENT
END:VCALENDAR
\`\`\`

### Cancel Page

**\`src/app/(public)/booking/[uid]/cancel/page.tsx\`:**

- Booking details summary (date, time, event type, host)
- "Are you sure you want to cancel?" warning
- Reason textarea (optional)
- "Cancel Meeting" button (red/danger style)
- "Go Back" link
- On cancel: PATCH \`/api/bookings/[uid]\` with \`{ action: "cancel", reason }\`
- Success state: "Meeting cancelled" with option to rebook

### Reschedule Page

**\`src/app/(public)/booking/[uid]/reschedule/page.tsx\`:**

- Shows the same calendar + slot picker as the booking page
- Pre-selected with the original event type and settings
- Header shows "Reschedule your meeting" with original time crossed out
- Reason textarea (optional)
- On submit: PUT \`/api/bookings/[uid]/reschedule\` with new time
- Success: redirect to new booking confirmation page

### Shared Components

**\`src/components/booking/calendar-picker.tsx\`:**
- Month grid component with day cells
- Props: \`availableDates: Set<string>\`, \`selectedDate: string | null\`, \`onSelect: (date: string) => void\`, \`weekStart: number\`
- Previous/next month navigation
- Responsive: full-size on desktop, compact on mobile

**\`src/components/booking/slot-list.tsx\`:**
- Vertical list of time slot buttons
- Props: \`slots: AvailableSlot[]\`, \`selectedSlot: AvailableSlot | null\`, \`onSelect: (slot: AvailableSlot) => void\`, \`timezone: string\`
- Loading skeleton (6 placeholder rectangles)
- Empty state message

**\`src/components/booking/timezone-select.tsx\`:**
- Searchable dropdown of all IANA timezones
- Grouped by region (America, Europe, Asia, etc.)
- Auto-detected default from browser
- Shows UTC offset next to each timezone: "America/New_York (UTC-5)"
- Props: \`value: string\`, \`onChange: (tz: string) => void\`

**\`src/components/booking/booking-form.tsx\`:**
- Dynamic form rendering based on event type custom questions
- Zod validation for all fields
- Loading/error states
- Props: \`eventType: EventType\`, \`selectedSlot: AvailableSlot\`, \`timezone: string\`, \`onSubmit: (data) => void\`

---

## Worker Stories

### Story 1: Public User Profile Page
**Persona:** \`frontend_developer\`

Build the public profile page at \`/(public)/[username]/page.tsx\`:
- Server component fetching user profile and event types
- Event type card grid (responsive 2-col/1-col)
- Avatar with initials fallback, bio display
- 404 handling for unknown usernames
- Event type cards with color dot, duration badge, location icon, price, description

**Target files:** \`src/app/(public)/[username]/page.tsx\`, \`src/components/booking/event-type-card.tsx\`

---

### Story 2: Calendar Date Picker Component
**Persona:** \`frontend_developer\`

Build the reusable calendar picker:
- \`src/components/booking/calendar-picker.tsx\` — Full month grid with day cells, prev/next navigation, available date highlighting, today indicator, selected date styling
- Must support configurable week start day (Sunday or Monday)
- Past dates grayed out and non-clickable
- Accessible: keyboard navigation (arrow keys), ARIA labels for each day

**Target files:** \`src/components/booking/calendar-picker.tsx\`

---

### Story 3: Timezone Select and Slot List Components
**Persona:** \`frontend_developer\`

Build the timezone and slot UI:
- \`src/components/booking/timezone-select.tsx\` — Searchable timezone dropdown with region grouping, UTC offset display, browser auto-detection
- \`src/components/booking/slot-list.tsx\` — Vertical time slot buttons with loading skeleton and empty state
- Use \`Intl.supportedValuesOf('timeZone')\` for timezone list
- Format times with \`date-fns\` format functions

**Target files:** \`src/components/booking/timezone-select.tsx\`, \`src/components/booking/slot-list.tsx\`

---

### Story 4: Booking Page — Calendar + Slot Selection
**Persona:** \`frontend_developer\`

Build the main booking page (State 1):
- \`src/app/(public)/[username]/[slug]/page.tsx\` — Server component loading event type data
- \`src/components/booking/booking-page-client.tsx\` — Client component managing all interactive state: month navigation, date selection, timezone changes, slot fetching (SWR or useEffect + fetch), slot selection
- Two-panel layout (calendar left, slots right) on desktop; stacked on mobile
- Event type header with color bar, title, duration, location
- Fetch slots on mount and on month/timezone change
- Loading, error, and empty states

**Target files:** \`src/app/(public)/[username]/[slug]/page.tsx\`, \`src/components/booking/booking-page-client.tsx\`

---

### Story 5: Booking Form Component
**Persona:** \`frontend_developer\`

Build the booking form (State 2):
- \`src/components/booking/booking-form.tsx\` — Dynamic form with name, email, notes, and custom questions rendered from event type config
- Custom question type renderers (text, textarea, select, radio, checkbox, phone)
- Zod validation with inline error messages
- Selected time summary header with "change" link
- "Schedule Meeting" submit button with loading state
- POST to \`/api/bookings\`, redirect to confirmation on success
- Error handling with user-friendly messages

**Target files:** \`src/components/booking/booking-form.tsx\`

---

### Story 6: Booking Confirmation Page
**Persona:** \`frontend_developer\`

Build the confirmation page:
- \`src/app/(public)/booking/[uid]/page.tsx\` — Server component fetching booking details
- Success state with green checkmark, event details, host info, meeting link
- "Add to Calendar" buttons (Google Calendar link, Outlook/Apple .ics download)
- \`src/lib/ics.ts\` — ICS file generation utility
- "Reschedule" and "Cancel" action links
- 404 handling for invalid UIDs

**Target files:** \`src/app/(public)/booking/[uid]/page.tsx\`, \`src/lib/ics.ts\`

---

### Story 7: Cancel and Reschedule Pages
**Persona:** \`frontend_developer\`

Build the cancel and reschedule flows:
- \`src/app/(public)/booking/[uid]/cancel/page.tsx\` — Confirmation dialog with reason textarea, cancel action, success state with rebook option
- \`src/app/(public)/booking/[uid]/reschedule/page.tsx\` — Re-uses booking page calendar/slot picker in reschedule mode, shows original time crossed out, reason field, submits to reschedule API
- Both pages load booking details server-side, handle 404 for invalid UIDs

**Target files:** \`src/app/(public)/booking/[uid]/cancel/page.tsx\`, \`src/app/(public)/booking/[uid]/reschedule/page.tsx\`

---

### Story 8: E2E Tests — Public Booking Flow
**Persona:** \`qa_engineer\`

End-to-end test coverage:
- \`e2e/booking-flow.spec.ts\` — 15+ tests:
  - Navigate to \`/demo\` profile page, verify event type cards displayed
  - Click event type, verify calendar renders with available dates
  - Select a date, verify slots appear
  - Change timezone, verify slots update
  - Navigate months, verify slot refetch
  - Select slot, fill form, submit booking
  - Verify confirmation page shows correct details
  - Test "Add to Calendar" button generates valid link
  - Navigate to cancel page, submit cancellation
  - Navigate to reschedule page, select new time, submit
  - Test 404 for invalid username and slug
  - Test empty state when no slots available
  - Mobile responsive layout verification

**Target files:** \`e2e/booking-flow.spec.ts\`, \`e2e/helpers/booking-helpers.ts\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 03:50 UTC

**Planning** — Critic approved plan
- 6 stories covering the end-to-end public booking flow

**Story 0: ICS Utility & Event Type Card** — completed by frontend_developer
- RFC 5545 ICS calendar file generation
- Event type card component with duration, location badges
- Google Calendar link generation

**Story 1: Public Profile Page** — completed by frontend_developer
- Username-based public page (/[username])
- Event type grid with availability indicators
- Responsive layout with user avatar and bio

**Story 2: Calendar Date Picker** — completed by frontend_developer
- Interactive calendar component for date selection
- Timezone selector with auto-detection
- Available/unavailable day indicators

**Story 3: Time Slot Selection** — completed by frontend_developer
- Slot list for selected date with timezone conversion
- Loading states and empty state handling
- Smooth transitions between date and time selection

**Story 4: Booking Confirmation** — completed by frontend_developer
- Form with name, email, and custom questions
- Zod validation on client and server
- Confirmation page with ICS download and Google Calendar link

**Story 5: API Integration** — completed by backend_developer
- Public API routes for profile and availability lookup
- Booking creation endpoint for unauthenticated users
- Rate limiting on public booking endpoints

✅ **Approved** (9/10) — Clean component architecture, proper server/client separation`,
  },
  {
    id: "cm-4",
    title: "CM-4: Dashboard & Management UI",
    priority: "high",
    storyCount: 8,
    duration: "~89 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 5,
    prUrl: "https://github.com/workermill-examples/calmill/pull/5",
    commentCount: 100,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `# CM-4: Dashboard & Management UI

---

## Epic Overview

Build the authenticated dashboard — the management interface where users create and configure event types, view and manage bookings, edit their availability schedules visually, update profile settings, and view analytics. All pages require authentication via NextAuth.

**Deliverables:**

1. Event type list with create dialog and quick actions
2. Event type editor with multi-tab configuration form
3. Bookings list with status tabs, filters, and bulk actions
4. Booking detail view with accept/reject/cancel actions
5. Visual availability schedule editor (weekly grid)
6. Profile and account settings page
7. Dashboard home with analytics charts and upcoming bookings
8. E2E tests for dashboard flows

---

## Technical Specification

### Event Type List Page

**\`src/app/(dashboard)/event-types/page.tsx\`** — Server component.

**Layout:**
- Page title: "Event Types" with "New Event Type" button (top-right)
- List of event type cards (not a table — cards provide richer display)
- Each card shows:
  - Color bar (left edge, 4px wide, event type color)
  - Title and slug (\`/demo/30min\` preview URL)
  - Duration badge, location icons
  - Active/inactive toggle switch (PATCH to \`/api/event-types/[id]/toggle\`)
  - Booking count (last 30 days)
  - Quick actions: Copy link, Edit, Duplicate, Delete
- Cards ordered by \`createdAt\` DESC
- Empty state: illustration + "Create your first event type" CTA

**Create Event Type Dialog:**
- Modal/dialog triggered by "New Event Type" button
- Quick-create form: title, duration (15/30/45/60/90/120 dropdown), location type
- Slug auto-generated from title (shown as preview)
- "Create" button → POST to \`/api/event-types\` → redirect to editor

### Event Type Editor

**\`src/app/(dashboard)/event-types/[id]/page.tsx\`** — Full-page editor.

Multi-tab form with tabs:

#### Tab 1: General
- Title (text input)
- Slug (text input with \`/username/\` prefix preview)
- Description (textarea, max 500 chars)
- Duration (number input with quick-select buttons: 15, 30, 45, 60, 90, 120 min)
- Locations (repeatable field group):
  - Type dropdown: "In Person", "Video Link", "Phone Call"
  - Value input: address, URL, or phone number
  - Add/remove buttons
- Color picker (8 preset colors + custom hex input)

#### Tab 2: Availability
- Schedule selector dropdown (list of user's schedules)
- Preview of selected schedule's availability (read-only weekly grid)
- "Edit Schedule" link → opens \`/availability\` in new tab
- Date-specific overrides section:
  - List of existing overrides for this event type's schedule
  - "Add Override" button → date picker + time range or "Unavailable all day"

#### Tab 3: Limits & Buffers
- Minimum notice: number input with unit selector (minutes/hours/days)
- Buffer before event: number input (0-120 minutes)
- Buffer after event: number input (0-120 minutes)
- Slot interval: number input (optional, defaults to duration)
- Max bookings per day: number input (optional)
- Max bookings per week: number input (optional)
- Future booking limit: number input (days, 1-365)

#### Tab 4: Booking Form
- "Require confirmation" toggle
- Custom questions builder:
  - Drag-to-reorder list of questions (simple up/down arrows, no drag library needed)
  - Each question: label, type (text/textarea/select/radio/checkbox/phone), required toggle
  - For select/radio types: options list with add/remove
  - Add new question button
  - Delete question button with confirmation
- Success redirect URL (optional text input)

#### Tab 5: Recurring (if enabled)
- "Enable recurring bookings" toggle
- Frequency: weekly / biweekly / monthly
- Max occurrences: number input (1-52)

**Save behavior:** Auto-save on field blur with debounce (500ms), or manual "Save" button. Show "Saved" indicator. Optimistic UI with error rollback.

**Header:** Event type title, active/inactive toggle, "Preview" button (opens public booking page in new tab), "Delete" button (with confirmation dialog).

### Bookings List Page

**\`src/app/(dashboard)/bookings/page.tsx\`** — Server component.

**Layout:**
- Tab bar: "Upcoming" (default), "Past", "Cancelled"
- Filters row: date range picker, event type dropdown, search by attendee name/email
- Booking cards (list layout, not table):
  - Date and time (in host's timezone)
  - Attendee name + email
  - Event type title + duration
  - Status badge (color-coded: green=accepted, yellow=pending, red=cancelled, blue=rescheduled)
  - Quick actions based on status:
    - PENDING: Accept, Reject
    - ACCEPTED: Cancel
    - CANCELLED: no actions
- Pagination (page-based, 20 per page)
- Empty state per tab

### Booking Detail View

**\`src/app/(dashboard)/bookings/[uid]/page.tsx\`:**

- Full booking details:
  - Status badge (large, top of page)
  - Date and time with timezone
  - Event type title and duration
  - Attendee: name, email, timezone, notes
  - Location / meeting URL
  - Custom question responses (if any)
  - Cancellation reason (if cancelled)
- Action buttons based on status:
  - PENDING: "Accept" (green), "Reject" (red with reason dialog)
  - ACCEPTED: "Cancel" (red with reason dialog)
  - CANCELLED/REJECTED: "Rebook" link (opens public page)
- Timeline: creation date, status changes with timestamps

### Availability Schedule Editor

**\`src/app/(dashboard)/availability/page.tsx\`:**

**Layout:**
- Schedule selector dropdown (with "Create New Schedule" option)
- Schedule name input (editable inline)
- Timezone selector dropdown
- "Set as Default" toggle

**Visual Weekly Grid:**
- 7 rows (one per day of week, starting from user's \`weekStart\`)
- Each row shows:
  - Day name (Monday, Tuesday, etc.)
  - Toggle switch (available/unavailable for this day)
  - Time range inputs when enabled: start time and end time (HH:mm select dropdowns in 15-min increments)
  - "+" button to add additional time windows for the same day (e.g., 09:00-12:00 and 13:00-17:00)
  - "×" button to remove a time window

**Date Overrides section (below weekly grid):**
- List of existing overrides with date, time range (or "Unavailable"), delete button
- "Add Date Override" button:
  - Date picker (calendar popup)
  - Toggle: "Unavailable all day" or custom time range
  - Time range inputs if custom

**Save:** PUT to \`/api/schedules/[id]\` with full availability replacement. Show success toast.

**Delete schedule:** Button at bottom with confirmation. Fails if event types reference it.

### Profile Settings Page

**\`src/app/(dashboard)/settings/page.tsx\`:**

Multi-section form:

**Profile section:**
- Name (text input)
- Username (text input with availability check on blur)
- Email (text input, readonly if OAuth-linked)
- Avatar URL (text input — no file upload for simplicity)
- Bio (textarea, max 300 chars)
- Public profile preview link

**Preferences section:**
- Timezone (searchable dropdown, same component as booking page)
- Week start day: Sunday / Monday
- Theme: Light / Dark / System
- Default schedule selector

**Password section (if credentials auth):**
- Current password
- New password
- Confirm new password
- Save password button

**Danger zone:**
- "Delete Account" button with type-to-confirm dialog (type username)
- Deletes user and all associated data

### Dashboard Home

**\`src/app/(dashboard)/page.tsx\`** (redirected from \`/(dashboard)/dashboard/page.tsx\`):

**Summary cards row (4 cards):**
1. "Upcoming" — count of ACCEPTED bookings in the next 7 days
2. "Pending" — count of PENDING bookings requiring action
3. "This Month" — total bookings created this calendar month
4. "Popular" — most-booked event type name + count

**Upcoming bookings list (below cards):**
- Next 5 upcoming ACCEPTED bookings
- Each shows: date/time, attendee name, event type, join button (if video link)
- "View All" link to bookings page

**Charts section (Recharts 3):**
- **Bookings over time** — Line chart showing bookings per day for the last 30 days
- **Bookings by event type** — Horizontal bar chart showing distribution across event types
- **Bookings by status** — Donut chart showing ACCEPTED/PENDING/CANCELLED distribution

**API endpoint for dashboard data:**
- \`src/app/api/dashboard/route.ts\` — GET, authenticated. Returns:
  \`\`\`json
  {
    "upcomingCount": 12,
    "pendingCount": 3,
    "monthlyCount": 45,
    "popularEventType": { "title": "30 Minute Meeting", "count": 28 },
    "upcomingBookings": [...],
    "bookingsByDay": [{ "date": "2026-02-01", "count": 3 }, ...],
    "bookingsByEventType": [{ "title": "30min", "count": 28 }, ...],
    "bookingsByStatus": { "ACCEPTED": 35, "PENDING": 5, "CANCELLED": 5 }
  }
  \`\`\`

---

## Worker Stories

### Story 1: Event Type List Page and Create Dialog
**Persona:** \`frontend_developer\`

Build the event type management list:
- \`src/app/(dashboard)/event-types/page.tsx\` — Server component fetching event types
- \`src/components/event-types/event-type-card.tsx\` — Card with color bar, title, slug, duration, toggle, quick actions
- \`src/components/event-types/create-dialog.tsx\` — Modal with quick-create form (title, duration, location type)
- Toggle switch calls PATCH \`/api/event-types/[id]/toggle\`
- Copy link copies public booking URL to clipboard
- Delete with confirmation dialog
- Empty state with CTA

**Target files:** \`src/app/(dashboard)/event-types/page.tsx\`, \`src/components/event-types/event-type-card.tsx\`, \`src/components/event-types/create-dialog.tsx\`

---

### Story 2: Event Type Editor (Multi-Tab Form)
**Persona:** \`frontend_developer\`

Build the full event type configuration editor:
- \`src/app/(dashboard)/event-types/[id]/page.tsx\` — Server component loading event type
- \`src/components/event-types/editor.tsx\` — Client component with tab navigation
- \`src/components/event-types/general-tab.tsx\` — Title, slug, description, duration, locations, color
- \`src/components/event-types/availability-tab.tsx\` — Schedule selector with preview grid
- \`src/components/event-types/limits-tab.tsx\` — Minimum notice, buffers, slot interval, booking limits
- \`src/components/event-types/booking-tab.tsx\` — Confirmation toggle, custom questions builder, success redirect
- \`src/components/event-types/recurring-tab.tsx\` — Recurring enable, frequency, max occurrences
- Auto-save with debounce on field blur, or manual save button
- Header with title, toggle, preview link, delete

**Target files:** \`src/app/(dashboard)/event-types/[id]/page.tsx\`, \`src/components/event-types/editor.tsx\`, plus 5 tab components

---

### Story 3: Bookings List Page
**Persona:** \`frontend_developer\`

Build the bookings management interface:
- \`src/app/(dashboard)/bookings/page.tsx\` — Server component with initial data
- \`src/components/bookings/bookings-list.tsx\` — Client component with tab switching (Upcoming/Past/Cancelled), filters (date range, event type, search), pagination
- \`src/components/bookings/booking-card.tsx\` — Card showing date/time, attendee, event type, status badge, quick actions
- Accept/reject/cancel actions call PATCH \`/api/bookings/[uid]\`
- Status filter maps to API query params
- Empty states per tab

**Target files:** \`src/app/(dashboard)/bookings/page.tsx\`, \`src/components/bookings/bookings-list.tsx\`, \`src/components/bookings/booking-card.tsx\`

---

### Story 4: Booking Detail View
**Persona:** \`frontend_developer\`

Build the booking detail page:
- \`src/app/(dashboard)/bookings/[uid]/page.tsx\` — Full booking details with status badge, attendee info, event type details, custom question responses, meeting link
- Action buttons based on booking status (accept, reject with reason dialog, cancel with reason dialog)
- Status timeline showing creation and changes
- "Rebook" link for cancelled bookings

**Target files:** \`src/app/(dashboard)/bookings/[uid]/page.tsx\`, \`src/components/bookings/booking-actions.tsx\`, \`src/components/bookings/status-timeline.tsx\`

---

### Story 5: Availability Schedule Editor
**Persona:** \`frontend_developer\`

Build the visual schedule editor:
- \`src/app/(dashboard)/availability/page.tsx\` — Schedule selector, inline name editing, timezone dropdown
- \`src/components/availability/weekly-grid.tsx\` — 7 day rows with toggle, time range inputs (HH:mm dropdowns in 15-min increments), add/remove time windows
- \`src/components/availability/date-overrides.tsx\` — Override list with date picker, unavailable toggle, custom time range, delete button
- Save: full availability replacement PUT to \`/api/schedules/[id]\`
- Create new schedule flow
- Delete schedule with reference check handling (show error if event types use it)

**Target files:** \`src/app/(dashboard)/availability/page.tsx\`, \`src/components/availability/weekly-grid.tsx\`, \`src/components/availability/date-overrides.tsx\`

---

### Story 6: Profile Settings Page
**Persona:** \`frontend_developer\`

Build the settings page:
- \`src/app/(dashboard)/settings/page.tsx\` — Multi-section form
- Profile section: name, username (with availability check), email, avatar URL, bio
- Preferences: timezone selector, week start, theme toggle
- Password change section (conditional on credentials auth)
- Danger zone: delete account with type-to-confirm
- All fields save individually on blur or via section save buttons
- API routes:
  - \`src/app/api/user/route.ts\` — GET (current user), PATCH (update profile)
  - \`src/app/api/user/password/route.ts\` — PUT (change password with current password verification)

**Target files:** \`src/app/(dashboard)/settings/page.tsx\`, \`src/app/api/user/route.ts\`, \`src/app/api/user/password/route.ts\`

---

### Story 7: Dashboard Home with Analytics
**Persona:** \`frontend_developer\`

Build the dashboard home page:
- \`src/app/(dashboard)/page.tsx\` — Server component redirecting to dashboard or rendering directly
- \`src/components/dashboard/stat-cards.tsx\` — 4 summary cards (upcoming, pending, monthly, popular)
- \`src/components/dashboard/upcoming-list.tsx\` — Next 5 bookings with join button
- \`src/components/dashboard/charts.tsx\` — 3 Recharts visualizations (line, bar, donut)
- \`src/app/api/dashboard/route.ts\` — Dashboard data aggregation endpoint
- Responsive layout: cards in 2x2 grid on mobile, 4-col on desktop

**Target files:** \`src/app/(dashboard)/page.tsx\`, \`src/components/dashboard/stat-cards.tsx\`, \`src/components/dashboard/upcoming-list.tsx\`, \`src/components/dashboard/charts.tsx\`, \`src/app/api/dashboard/route.ts\`

---

### Story 8: E2E Tests — Dashboard Flows
**Persona:** \`qa_engineer\`

End-to-end tests:
- \`e2e/dashboard.spec.ts\` — 15+ tests:
  - Login and verify dashboard renders with stat cards and charts
  - Navigate to event types, verify list displays
  - Create new event type via dialog, verify it appears
  - Open event type editor, modify fields, verify save
  - Toggle event type active/inactive
  - Delete event type with confirmation
  - Navigate to bookings, verify tabs work (upcoming/past/cancelled)
  - Accept a pending booking, verify status changes
  - Cancel an accepted booking with reason
  - Navigate to availability, modify schedule, save
  - Add date override, verify it appears
  - Update profile settings, verify persistence
  - Verify responsive layout on mobile viewport

**Target files:** \`e2e/dashboard.spec.ts\`, \`e2e/helpers/dashboard-helpers.ts\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 06:53 UTC

**Planning** — Critic approved plan
- 8 stories — largest epic in the CalMill series

**Story 0: Dashboard API Routes & Navigation** — completed by backend_developer
- Stats aggregation endpoints (bookings today, this week, conversion rate)
- Dashboard navigation with active route highlighting

**Story 1: Dashboard Overview Page** — completed by frontend_developer
- Stat cards with booking counts and trends
- Upcoming meetings list with join/cancel actions
- Quick-action buttons for creating event types

**Story 2: Event Type Management** — completed by frontend_developer
- Create/edit event type forms with live preview
- Toggle active/inactive with confirmation
- Drag-and-drop reordering

**Story 3: Booking List** — completed by frontend_developer
- Paginated booking table with status badges
- Filter by date range, status, event type
- Search by attendee name/email

**Story 4: Schedule Editor** — completed by frontend_developer
- Visual weekly availability grid
- Click-to-toggle time blocks
- Date override calendar for exceptions

**Story 5: Booking Detail** — completed by frontend_developer
- Full booking detail view with attendee info
- Cancel/reschedule actions
- Meeting notes and custom question responses

**Story 6: Settings Page** — completed by frontend_developer
- Profile settings (name, timezone, avatar)
- Booking preferences (buffer time, min notice)

**Story 7: API Refinements** — completed by backend_developer
- Booking stats aggregation queries
- Chart data endpoints for dashboard widgets

✅ **Approved** (9/10) — Comprehensive dashboard with proper auth guards`,
  },
  {
    id: "cm-5",
    title: "CM-5: Calendar Integration & Email Notifications",
    priority: "high",
    storyCount: 6,
    duration: "~37 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 6,
    prUrl: "https://github.com/workermill-examples/calmill/pull/6",
    commentCount: 62,
    personas: [
      "backend_developer",
      "frontend_developer",
    ],
    description: `# CM-5: Calendar Integration & Email Notifications

---

## Epic Overview

Add Google Calendar integration (OAuth, busy time fetching, event creation) and transactional email notifications (booking confirmation, cancellation, reminders) using Resend and React Email. This epic connects CalMill to the real world — checking actual calendar availability and sending professional emails.

**Deliverables:**

1. Google Calendar OAuth connection flow
2. Busy time fetching integrated into slot calculation
3. Booking-to-calendar event creation (write events to connected calendar)
4. React Email templates for all booking lifecycle events
5. Email sending via Resend for confirmations, cancellations, and reminders
6. Calendar settings UI in dashboard
7. Integration tests for calendar and email flows

---

## Technical Specification

### Google Calendar OAuth Flow

**Setup required (env vars):**
\`\`\`bash
GOOGLE_CLIENT_ID="****"
GOOGLE_CLIENT_SECRET="****"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/integrations/google/callback"
\`\`\`

**Scopes requested:**
\`\`\`
https://www.googleapis.com/auth/calendar.readonly    # Read busy times
https://www.googleapis.com/auth/calendar.events       # Create/update/delete events
\`\`\`

**OAuth endpoints:**

**\`src/app/api/integrations/google/connect/route.ts\`:**
- \`GET /api/integrations/google/connect\` — Authenticated. Generates Google OAuth URL with state parameter (user ID encrypted), scopes, and redirect URI. Returns \`{ url: "https://accounts.google.com/o/oauth2/v2/auth?..." }\`.

**\`src/app/api/integrations/google/callback/route.ts\`:**
- \`GET /api/integrations/google/callback?code=xxx&state=xxx\` — Exchanges code for tokens. Creates \`CalendarConnection\` record with:
  - \`provider: "google"\`
  - \`accessToken\` (encrypted at rest)
  - \`refreshToken\`
  - \`expiresAt\` (from token response)
  - \`email\` (from Google userinfo endpoint)
  - \`isPrimary: true\` if first connection
- Redirects to \`/settings/calendars\` with \`?connected=true\` query param.

**\`src/app/api/integrations/google/disconnect/route.ts\`:**
- \`DELETE /api/integrations/google/disconnect\` — Authenticated. Revokes token with Google, deletes \`CalendarConnection\` record.

**Token refresh utility:**

**\`src/lib/google-calendar.ts\`:**
\`\`\`typescript
export class GoogleCalendarService {
  private connection: CalendarConnection;

  constructor(connection: CalendarConnection) {
    this.connection = connection;
  }

  // Refresh token if expired (within 5 min of expiry)
  async getValidAccessToken(): Promise<string> {
    if (this.connection.expiresAt && this.connection.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      // POST to https://oauth2.googleapis.com/token with refresh_token
      // Update CalendarConnection with new accessToken and expiresAt
    }
    return this.connection.accessToken;
  }

  // Fetch busy times for a date range
  async getBusyTimes(startDate: Date, endDate: Date): Promise<BusyTime[]> {
    // POST to https://www.googleapis.com/calendar/v3/freeBusy
    // Body: { timeMin, timeMax, items: [{ id: "primary" }] }
    // Returns array of { start, end } busy periods
  }

  // Create calendar event for a booking
  async createEvent(booking: BookingWithDetails): Promise<string> {
    // POST to https://www.googleapis.com/calendar/v3/calendars/primary/events
    // Body: { summary, description, start, end, attendees, location }
    // Returns event ID (store as calendarEventId on Booking)
  }

  // Update calendar event (for reschedule)
  async updateEvent(eventId: string, booking: BookingWithDetails): Promise<void> {
    // PATCH to https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}
  }

  // Delete calendar event (for cancellation)
  async deleteEvent(eventId: string): Promise<void> {
    // DELETE to https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}
  }
}

type BusyTime = {
  start: Date;
  end: Date;
};
\`\`\`

### Busy Time Integration with Slot Calculation

**Modify \`src/lib/slots.ts\`** to include Google Calendar busy times:

In \`getAvailableSlots()\`, after loading existing bookings (step 2), add:

\`\`\`
2b. If user has CalendarConnection(s):
    - For each connection, call getBusyTimes(startDate, endDate)
    - Merge busy times into the booking conflicts array
    - Treat busy times exactly like existing bookings for conflict detection
\`\`\`

This means the slot calculation now checks:
- Internal CalMill bookings
- External Google Calendar events
- Buffer times around both

### Email Templates (React Email)

**Template directory:** \`src/emails/\`

All templates use \`@react-email/components\` for cross-client compatible HTML emails.

**Shared layout:** \`src/emails/components/email-layout.tsx\`
- CalMill logo header
- White card container on light gray background
- Footer with "Powered by CalMill" and unsubscribe link

#### Template 1: Booking Confirmation (to attendee)
**\`src/emails/booking-confirmed.tsx\`:**
- Subject: "Your meeting with {hostName} is confirmed"
- Body:
  - Green checkmark icon
  - "Your meeting has been scheduled"
  - Event type title and duration
  - Date and time in attendee's timezone
  - Host name
  - Location / meeting link
  - "Add to Calendar" button (Google Calendar link)
  - "Reschedule" and "Cancel" links (to public booking pages)

#### Template 2: Booking Notification (to host)
**\`src/emails/booking-notification.tsx\`:**
- Subject: "New booking: {attendeeName} - {eventTypeTitle}"
- Body:
  - "You have a new booking"
  - Event type title and duration
  - Date and time in host's timezone
  - Attendee name and email
  - Attendee notes (if any)
  - Custom question responses (if any)
  - "Accept" and "Reject" buttons (link to dashboard booking detail)

#### Template 3: Booking Accepted (to attendee)
**\`src/emails/booking-accepted.tsx\`:**
- Subject: "Meeting confirmed: {eventTypeTitle} with {hostName}"
- Body: similar to confirmation but with "confirmed by host" messaging

#### Template 4: Booking Cancelled (to both parties)
**\`src/emails/booking-cancelled.tsx\`:**
- Subject: "Meeting cancelled: {eventTypeTitle}"
- Body:
  - Red X icon
  - "Your meeting has been cancelled"
  - Original date and time
  - Cancellation reason (if provided)
  - "Rebook" button (link to public booking page)

#### Template 5: Booking Reminder (to both parties)
**\`src/emails/booking-reminder.tsx\`:**
- Subject: "Reminder: {eventTypeTitle} in {timeUntil}"
- Body:
  - Clock icon
  - "Your meeting is coming up"
  - Event details, time, location
  - "Join Meeting" button (if video link)
  - "Reschedule" and "Cancel" links

### Email Sending Service

**\`src/lib/email.ts\`:**
\`\`\`typescript
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail<T>(params: {
  to: string;
  subject: string;
  template: React.ReactElement;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(\`[Email] Skipping send to \${params.to}: No RESEND_API_KEY\`);
    return; // Graceful degradation in dev
  }

  await resend.emails.send({
    from: process.env.EMAIL_FROM || "CalMill <noreply@calmill.workermill.com>",
    to: params.to,
    subject: params.subject,
    react: params.template,
  });
}
\`\`\`

### Email Trigger Points

Integrate email sending into existing booking routes:

| Event | Recipients | Template | Trigger Location |
|-------|-----------|----------|-----------------|
| Booking created (no confirmation required) | Attendee + Host | booking-confirmed + booking-notification | POST \`/api/bookings\` |
| Booking created (confirmation required) | Host only | booking-notification | POST \`/api/bookings\` |
| Booking accepted | Attendee | booking-accepted | PATCH \`/api/bookings/[uid]\` (accept action) |
| Booking cancelled | Both parties | booking-cancelled | PATCH \`/api/bookings/[uid]\` (cancel action) |
| Booking rejected | Attendee | booking-cancelled (with "rejected" variant) | PATCH \`/api/bookings/[uid]\` (reject action) |

**Reminders** are handled separately — they would need a cron job or scheduled task. For the showcase, implement the email template but wire up sending as a TODO/stretch goal (document the cron approach in comments).

### Calendar Settings UI

**\`src/app/(dashboard)/settings/calendars/page.tsx\`:**
- Connected calendars list:
  - Google Calendar card with email, connected date, "Disconnect" button
  - Primary calendar indicator
- "Connect Google Calendar" button → calls \`/api/integrations/google/connect\`, opens OAuth popup
- Success message when \`?connected=true\` query param present
- Explanation text: "CalMill checks your connected calendars for conflicts when calculating available time slots."

### Calendar Event Management

When a booking is created/updated/cancelled, sync to Google Calendar:

**On booking creation (status ACCEPTED):**
- If host has CalendarConnection, create event via \`GoogleCalendarService.createEvent()\`
- Store returned event ID as \`booking.calendarEventId\`

**On booking cancellation:**
- If \`booking.calendarEventId\` exists, delete event via \`GoogleCalendarService.deleteEvent()\`

**On booking reschedule:**
- Delete old calendar event, create new one for the new booking

Wrap all calendar operations in try/catch — calendar sync failures should log errors but NOT fail the booking operation. Calendar sync is best-effort.

---

## Worker Stories

### Story 1: Google Calendar OAuth Routes
**Persona:** \`backend_developer\`

Build the OAuth connection flow:
- \`src/app/api/integrations/google/connect/route.ts\` — Generate OAuth URL
- \`src/app/api/integrations/google/callback/route.ts\` — Exchange code for tokens, create CalendarConnection
- \`src/app/api/integrations/google/disconnect/route.ts\` — Revoke token, delete connection
- \`src/app/api/integrations/google/calendars/route.ts\` — GET list of connected calendars

**Target files:** \`src/app/api/integrations/google/connect/route.ts\`, \`callback/route.ts\`, \`disconnect/route.ts\`, \`calendars/route.ts\`

---

### Story 2: Google Calendar Service
**Persona:** \`backend_developer\`

Build the Google Calendar client:
- \`src/lib/google-calendar.ts\` — \`GoogleCalendarService\` class with token refresh, busy time fetching, event CRUD
- Uses native \`fetch\` (no Google SDK dependency to keep bundle small)
- Token refresh handles expiry with 5-minute buffer
- Error handling with typed errors for quota limits, auth failures, network issues

**Target files:** \`src/lib/google-calendar.ts\`

---

### Story 3: Busy Time Integration in Slot Calculator
**Persona:** \`backend_developer\`

Modify slot calculation to include calendar conflicts:
- Update \`src/lib/slots.ts\` — After loading bookings, fetch busy times from all CalendarConnections
- Merge busy times into conflict array
- Handle calendar fetch failures gracefully (log warning, continue without external conflicts)
- Add \`includeBusyTimes: boolean\` parameter (default true) for testing

**Target files:** \`src/lib/slots.ts\` (modify)

---

### Story 4: Email Templates (React Email)
**Persona:** \`frontend_developer\`

Build all 5 email templates:
- \`src/emails/components/email-layout.tsx\` — Shared layout with logo, card, footer
- \`src/emails/booking-confirmed.tsx\` — Attendee confirmation
- \`src/emails/booking-notification.tsx\` — Host notification
- \`src/emails/booking-accepted.tsx\` — Attendee acceptance
- \`src/emails/booking-cancelled.tsx\` — Cancellation (both parties)
- \`src/emails/booking-reminder.tsx\` — Reminder (both parties)
- All templates accept typed props and render cross-client HTML

**Target files:** \`src/emails/components/email-layout.tsx\`, plus 5 template files

---

### Story 5: Email Sending Service and Integration
**Persona:** \`backend_developer\`

Wire up email sending:
- \`src/lib/email.ts\` — \`sendEmail()\` function using Resend with graceful degradation
- Modify \`src/app/api/bookings/route.ts\` — Send confirmation/notification emails on booking creation
- Modify \`src/app/api/bookings/[uid]/route.ts\` — Send accepted/cancelled/rejected emails on status change
- All email sends are fire-and-forget (don't await in the request path, or use \`Promise.allSettled\`)
- Log email send results for debugging

**Target files:** \`src/lib/email.ts\`, \`src/app/api/bookings/route.ts\` (modify), \`src/app/api/bookings/[uid]/route.ts\` (modify)

---

### Story 6: Calendar Settings UI and Event Sync
**Persona:** \`frontend_developer\`

Build the calendar management UI and booking-to-calendar sync:
- \`src/app/(dashboard)/settings/calendars/page.tsx\` — Connected calendars list, connect/disconnect buttons, OAuth popup flow
- Modify booking API routes to create/delete Google Calendar events on booking create/cancel
- Calendar sync is best-effort — wrap in try/catch, log errors, never fail the booking
- Add link to calendar settings from main settings page

**Target files:** \`src/app/(dashboard)/settings/calendars/page.tsx\`, modify booking routes for calendar sync

---

### Story 7: Integration Tests
**Persona:** \`qa_engineer\`

Test calendar and email flows:
- \`tests/unit/google-calendar.test.ts\` — 8+ tests: token refresh, busy time parsing, event creation, error handling, token expiry
- \`tests/unit/slots-with-calendar.test.ts\` — 5+ tests: slot calculation with busy times, graceful fallback on calendar error
- \`tests/unit/email.test.ts\` — 5+ tests: email sending (mock Resend), graceful skip without API key, correct template selection per booking action
- Mock Google Calendar API responses and Resend API

**Target files:** \`tests/unit/google-calendar.test.ts\`, \`tests/unit/slots-with-calendar.test.ts\`, \`tests/unit/email.test.ts\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 13:50 UTC

**Planning** — Critic approved plan
- 6 stories covering OAuth, email, and calendar sync

**Story 0: Google Calendar OAuth Routes** — completed by backend_developer
- OAuth 2.0 authorization flow with PKCE
- Token storage and refresh handling
- Connect/disconnect endpoints

**Story 1: Calendar Sync Service** — completed by backend_developer
- Fetch busy/free data from Google Calendar API
- Merge external calendar events with local availability
- Automatic event creation on booking confirmation

**Story 2: Email Service** — completed by backend_developer
- Resend integration for transactional emails
- Booking confirmation template with ICS attachment
- Cancellation and reminder email templates

**Story 3: Calendar Connection UI** — completed by frontend_developer
- Settings page with Google Calendar connect button
- Connected calendar list with sync status
- Disconnect with confirmation dialog

**Story 4: Webhook Endpoints** — completed by backend_developer
- Calendar change notification webhooks
- Booking status change webhooks for integrations

**Story 5: Integration Tests** — completed by backend_developer
- OAuth flow tests with mocked Google API
- Email sending tests with Resend mock

✅ **Approved** (9/10) — Clean OAuth implementation, proper token refresh handling`,
  },
  {
    id: "cm-6",
    title: "CM-6: Team Scheduling",
    priority: "high",
    storyCount: 5,
    duration: "~38 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 7,
    prUrl: "https://github.com/workermill-examples/calmill/pull/7",
    commentCount: 79,
    personas: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
    ],
    description: `# CM-6: Team Scheduling

---

## Epic Overview

Add team scheduling capabilities — team creation and management, round-robin event types (distribute bookings across team members cyclically), collective event types (require all team members to be available), team booking pages, and team availability calculation. This is Cal.com's most popular team feature and demonstrates complex scheduling logic.

**Deliverables:**

1. Team CRUD routes with slug, logo, bio
2. Team member invitation, acceptance, and role management
3. Round-robin event type scheduling logic
4. Collective event type scheduling logic
5. Team public booking page
6. Team management dashboard UI
7. Team availability calculation (intersection and union)
8. Unit tests for team scheduling algorithms

---

## Technical Specification

### Team CRUD Routes

**\`src/app/api/teams/route.ts\`:**
- \`GET /api/teams\` — List teams the authenticated user belongs to. Include member count and user's role.
- \`POST /api/teams\` — Create team. Creator becomes OWNER. Auto-generate slug from name (same dedup logic as event type slugs). Create a team record and a TeamMember record for the creator.

**\`src/app/api/teams/[slug]/route.ts\`:**
- \`GET /api/teams/[slug]\` — Team details with members (names, roles, avatars) and event types. Requires membership.
- \`PUT /api/teams/[slug]\` — Update team name, slug, logo, bio. Requires ADMIN or OWNER role.
- \`DELETE /api/teams/[slug]\` — Delete team. OWNER only. Cascade-delete TeamMembers and team EventTypes.

### Team Member Management Routes

**\`src/app/api/teams/[slug]/members/route.ts\`:**
- \`GET /api/teams/[slug]/members\` — List team members with user details (name, email, avatar, timezone), role, and accepted status. Requires membership.
- \`POST /api/teams/[slug]/members\` — Invite member by email. ADMIN+ required. Creates TeamMember with \`accepted: false\`. If user doesn't exist, return 404 (no auto-registration for simplicity). Send notification (or log it).

**\`src/app/api/teams/[slug]/members/[memberId]/route.ts\`:**
- \`PUT /api/teams/[slug]/members/[memberId]\` — Update member role. OWNER only. Cannot change own role. Cannot have zero OWNERs (protect last OWNER).
- \`DELETE /api/teams/[slug]/members/[memberId]\` — Remove member. ADMIN+ to remove others, anyone can self-remove. Cannot remove last OWNER. Reassign any team event types that had this member as sole host.

**\`src/app/api/teams/invitations/route.ts\`:**
- \`GET /api/teams/invitations\` — List pending invitations for the authenticated user.
- \`POST /api/teams/invitations/[memberId]/accept\` — Accept invitation. Set \`accepted: true\`.
- \`POST /api/teams/invitations/[memberId]/reject\` — Reject invitation. Delete TeamMember record.

### Team Event Type Routes

**\`src/app/api/teams/[slug]/event-types/route.ts\`:**
- \`GET /api/teams/[slug]/event-types\` — List team event types.
- \`POST /api/teams/[slug]/event-types\` — Create team event type. ADMIN+ required. Must specify \`schedulingType\`: \`ROUND_ROBIN\` or \`COLLECTIVE\`. Assign \`teamId\` on the EventType.

Team event types use the same EventType model but with:
- \`teamId\` set (non-null)
- \`schedulingType\` set (ROUND_ROBIN or COLLECTIVE)
- \`userId\` set to the creating user (administrative owner)

### Round-Robin Scheduling Algorithm

**Purpose:** Distribute bookings evenly across team members. When someone books, the system picks the team member with the fewest recent bookings who is available at the requested time.

**Algorithm in \`src/lib/team-slots.ts\`:**

\`\`\`typescript
export async function getRoundRobinSlots(params: {
  eventTypeId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}): Promise<AvailableSlot[]>
\`\`\`

**Steps:**

1. **Load team event type** with team and accepted members.

2. **For each member**, compute their available slots using the existing \`getAvailableSlots()\` function (which already handles schedules, bookings, calendar conflicts, buffers).

3. **Union all member slots** — a time slot is available if ANY team member is free at that time.

4. **For each available slot, determine the assigned host:**
   a. Find all members who are free at this slot time.
   b. Among those, pick the member with the **fewest bookings in the last 30 days** for this event type.
   c. If tied, pick the member who was assigned least recently (by last booking date).
   d. Store the assignment: \`{ time, assignedUserId, assignedUserName }\`.

5. **Return slots** with assignment info (the attendee doesn't see who they'll meet — assignment happens at booking time, not display time).

**On booking creation for round-robin:**
- Re-evaluate the assignment at booking time (not at slot display time) to handle races
- The booking's \`userId\` is set to the assigned team member
- Send notification email to the assigned member, not all members

### Collective Scheduling Algorithm

**Purpose:** Find times when ALL team members are available simultaneously. Used for group meetings where every team member must attend.

**Algorithm in \`src/lib/team-slots.ts\`:**

\`\`\`typescript
export async function getCollectiveSlots(params: {
  eventTypeId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}): Promise<AvailableSlot[]>
\`\`\`

**Steps:**

1. **Load team event type** with team and accepted members.

2. **For each member**, compute their available slots using \`getAvailableSlots()\`.

3. **Intersect all member slots** — a time slot is available ONLY if ALL team members are free at that time.

4. **Return intersected slots.** No assignment needed — all members attend.

**On booking creation for collective:**
- The booking's \`userId\` is set to the event type creator (administrative owner)
- Send notification email to ALL team members
- Create calendar events for ALL team members who have CalendarConnections

### Public Team Slots Endpoint

**Modify \`src/app/api/slots/route.ts\`:**

Add logic to detect if the event type has \`schedulingType\` set:
- If \`null\` (personal): use existing \`getAvailableSlots()\`
- If \`ROUND_ROBIN\`: use \`getRoundRobinSlots()\`
- If \`COLLECTIVE\`: use \`getCollectiveSlots()\`

The public booking page does NOT need to change — it still calls the same \`/api/slots\` endpoint. The backend handles the routing internally.

### Team Public Booking Page

**\`src/app/(public)/team/[slug]/page.tsx\`:**
- Team profile page showing team name, logo, bio, members (avatars in a row)
- Grid of team event types (same card format as personal event types)
- Each card links to \`/team/[slug]/[event-slug]\`

**\`src/app/(public)/team/[slug]/[eventSlug]/page.tsx\`:**
- Reuses the booking page client component from CM-3
- Only difference: the "host" section shows team info instead of individual user
- For round-robin, after booking: show "You'll be meeting with [assigned member name]"
- For collective, show "You'll be meeting with the [team name] team" and list all members

### Team Public API Routes

**\`src/app/api/teams/[slug]/public/route.ts\`:**
- \`GET /api/teams/[slug]/public\` — Public team info: name, slug, logoUrl, bio, member names and avatars (no emails). No auth required.

**\`src/app/api/teams/[slug]/public/event-types/route.ts\`:**
- \`GET /api/teams/[slug]/public/event-types\` — Active team event types. Same fields as personal public event types plus \`schedulingType\`.

### Team Dashboard UI

**\`src/app/(dashboard)/teams/page.tsx\`:**
- List of teams the user belongs to
- "Create Team" button → create dialog (name, slug)
- Each team card shows: name, slug, logo, member count, event type count, user's role badge

**\`src/app/(dashboard)/teams/[slug]/page.tsx\`:**
- Team detail/settings page with tabs:

**Tab 1: Members**
- Member list with name, email, role badge, avatar, accepted status
- "Invite Member" button → email input dialog
- Role change dropdown (OWNER only)
- Remove member button with confirmation
- Pending invitations shown with "Resend" / "Cancel" options

**Tab 2: Event Types**
- Same card layout as personal event types but filtered to this team
- "New Team Event Type" button → create dialog with scheduling type selector
- Each card shows scheduling type badge (Round Robin / Collective)

**Tab 3: Settings**
- Team name, slug, logo URL, bio
- "Delete Team" button (OWNER only, type-to-confirm)

### Seed Data for Teams

Add to \`prisma/seed.ts\`:
- **Team:** "CalMill Demo Team" (slug: \`calmill-demo-team\`)
- **Members:** Demo user as OWNER + 2 additional seeded users (Alice, Bob) as MEMBER (accepted)
- **Team event types:**
  1. "Team Standup" — 15min, ROUND_ROBIN, no confirmation
  2. "Group Demo" — 30min, COLLECTIVE, requires confirmation

---

## Worker Stories

### Story 1: Team CRUD Routes
**Persona:** \`backend_developer\`

Build team management:
- \`src/app/api/teams/route.ts\` — GET (list) and POST (create with auto-slug)
- \`src/app/api/teams/[slug]/route.ts\` — GET, PUT, DELETE with role checks
- Slug generation with deduplication
- OWNER/ADMIN role enforcement on mutations
- Cascade delete handling

**Target files:** \`src/app/api/teams/route.ts\`, \`src/app/api/teams/[slug]/route.ts\`

---

### Story 2: Team Member Management Routes
**Persona:** \`backend_developer\`

Build member invitation and management:
- \`src/app/api/teams/[slug]/members/route.ts\` — GET (list) and POST (invite by email)
- \`src/app/api/teams/[slug]/members/[memberId]/route.ts\` — PUT (role change) and DELETE (remove)
- \`src/app/api/teams/invitations/route.ts\` — GET pending invitations
- \`src/app/api/teams/invitations/[memberId]/accept/route.ts\` — POST accept
- \`src/app/api/teams/invitations/[memberId]/reject/route.ts\` — POST reject
- Last-OWNER protection, self-removal support

**Target files:** 5 route files under \`src/app/api/teams/\`

---

### Story 3: Round-Robin Scheduling Algorithm
**Persona:** \`backend_developer\`

Implement round-robin slot calculation:
- \`src/lib/team-slots.ts\` — \`getRoundRobinSlots()\` function
- Union of all member availability
- Assignment based on fewest recent bookings (30-day window), then least-recently-assigned tiebreaker
- Integration with existing \`getAvailableSlots()\` for per-member calculation
- Modify booking creation to re-evaluate assignment at booking time
- Helper: \`getBookingCountByMember(eventTypeId, memberIds, days)\` for load balancing

**Target files:** \`src/lib/team-slots.ts\`, modify \`src/app/api/bookings/route.ts\`

---

### Story 4: Collective Scheduling Algorithm
**Persona:** \`backend_developer\`

Implement collective slot calculation:
- Add \`getCollectiveSlots()\` to \`src/lib/team-slots.ts\`
- Intersection of all member availability
- Modify booking creation for collective: set booking userId to event type creator, notify all members
- Calendar event creation for all members with CalendarConnections
- Update \`/api/slots\` route to detect scheduling type and dispatch to correct algorithm

**Target files:** \`src/lib/team-slots.ts\` (extend), modify \`src/app/api/slots/route.ts\`, modify \`src/app/api/bookings/route.ts\`

---

### Story 5: Team Public Pages
**Persona:** \`frontend_developer\`

Build team booking pages:
- \`src/app/(public)/team/[slug]/page.tsx\` — Team profile with name, logo, bio, member avatars, event type grid
- \`src/app/(public)/team/[slug]/[eventSlug]/page.tsx\` — Reuses booking-page-client from CM-3, adapted for team context (show team info, assigned member after booking)
- \`src/app/api/teams/[slug]/public/route.ts\` — Public team info endpoint
- \`src/app/api/teams/[slug]/public/event-types/route.ts\` — Public team event types

**Target files:** 2 page files under \`src/app/(public)/team/\`, 2 API routes

---

### Story 6: Team Dashboard UI
**Persona:** \`frontend_developer\`

Build the team management dashboard:
- \`src/app/(dashboard)/teams/page.tsx\` — Team list with create dialog
- \`src/app/(dashboard)/teams/[slug]/page.tsx\` — Team detail with 3 tabs (Members, Event Types, Settings)
- \`src/components/teams/member-list.tsx\` — Member table with role badges, actions
- \`src/components/teams/invite-dialog.tsx\` — Email input invitation dialog
- \`src/components/teams/team-event-type-card.tsx\` — Event type card with scheduling type badge
- Team invitation pending banner (if user has pending invitations)

**Target files:** 2 dashboard pages, 3 components

---

### Story 7: Seed Data Expansion
**Persona:** \`backend_developer\`

Expand seed data with team scenarios:
- Create 2 additional users (Alice, Bob) with separate schedules
- Create team, add all 3 users
- Create round-robin and collective event types
- Create 5 team bookings (mix of round-robin assigned and collective)

**Target files:** \`prisma/seed.ts\` (modify)

---

### Story 8: Unit Tests for Team Scheduling
**Persona:** \`qa_engineer\`

Comprehensive test coverage:
- \`tests/unit/round-robin.test.ts\` — 10+ tests: slot union, load balancing, assignment fairness, handling member with no availability, re-evaluation at booking time, tiebreaker logic
- \`tests/unit/collective.test.ts\` — 8+ tests: slot intersection, all-members-required, single member unavailable blocks slot, empty result when no overlap, multiple availability windows
- \`tests/unit/team-routes.test.ts\` — 8+ tests: team CRUD, member invitation, role changes, last-owner protection, self-removal

**Target files:** \`tests/unit/round-robin.test.ts\`, \`tests/unit/collective.test.ts\`, \`tests/unit/team-routes.test.ts\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 14:38 UTC

**Planning** — Critic approved plan
- 5 stories covering team management and scheduling modes

**Story 0: Team CRUD API Routes** — completed by backend_developer
- Team creation with invite flow
- Member management (add, remove, update role)
- Team-level settings and preferences

**Story 1: Round-Robin Scheduling** — completed by backend_developer
- Even distribution algorithm across team members
- Weighted round-robin support
- Respect individual availability schedules

**Story 2: Collective Scheduling** — completed by backend_developer
- Find overlapping availability across all team members
- Aggregate busy/free data from connected calendars
- Slot generation for collective meetings

**Story 3: Team Event Types** — completed by backend_developer
- Link event types to teams
- Configure scheduling mode (round-robin vs collective)
- Team-specific duration and buffer settings

**Story 4: Team Management UI** — completed by frontend_developer
- Team list and creation form
- Member management with role assignment
- Team event type configuration page

✅ **Approved** (9/10) — Good separation of scheduling algorithms`,
  },
  {
    id: "cm-7",
    title: "CM-7: Embeds, Webhooks & Production",
    priority: "high",
    storyCount: 4,
    duration: "~43 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 8,
    prUrl: "https://github.com/workermill-examples/calmill/pull/8",
    commentCount: 82,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `# CM-7: Embeds, Webhooks & Production

---

## Epic Overview

The final epic — add embeddable booking widgets (inline and popup), a webhook system for booking events, recurring booking support, a comprehensive E2E test suite, and production deployment validation. This epic makes CalMill distributable (embeds), programmable (webhooks), and production-ready.

**Deliverables:**

1. Inline embed widget (renders booking page inside an iframe)
2. Popup embed widget (floating button that opens booking overlay)
3. Webhook CRUD and event delivery system
4. Recurring booking creation and management
5. Comprehensive E2E test suite covering all features
6. Production deployment to Vercel with health checks
7. Final demo data seeding and documentation
8. Embed code generator in dashboard

---

## Technical Specification

### Embed Widget System

CalMill embeds allow website owners to add scheduling directly to their pages without visitors leaving the site. Two modes: inline (rendered in-page) and popup (floating button).

#### Inline Embed

**How it works:** An iframe pointing to the CalMill booking page, styled to blend into the host page.

**Embed script:** \`src/app/embed/calmill-embed.js\` — A lightweight (<3KB) vanilla JavaScript file that:
1. Finds all \`<div data-calmill-embed="username/slug"></div>\` elements on the page
2. Creates an iframe for each, pointing to \`{CALMILL_URL}/embed/[username]/[slug]\`
3. Handles iframe resizing via \`postMessage\` (the embedded page sends its content height)
4. Applies default styles (no border, rounded corners, width: 100%)

**Embed pages:** Specialized versions of the booking page optimized for iframe embedding:

**\`src/app/embed/[username]/[slug]/page.tsx\`:**
- Same booking flow as \`/(public)/[username]/[slug]\` but:
  - No header/footer (clean, borderless)
  - Background transparent
  - Sends \`postMessage({ type: "calmill:resize", height: N })\` on content change
  - Sends \`postMessage({ type: "calmill:booked", booking: { uid, title, startTime } })\` on successful booking
  - Accepts query params: \`?theme=light|dark\`, \`?hideEventDetails=true\`, \`?timezone=America/New_York\`

**Embed page layout:** \`src/app/embed/layout.tsx\` — Minimal layout, no navigation, transparent background.

**Usage (on external site):**
\`\`\`html
<!-- Inline embed -->
<div data-calmill-embed="demo/30min" data-calmill-theme="light"></div>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
\`\`\`

#### Popup Embed

**How it works:** A floating button that, when clicked, opens the booking page as a modal overlay.

**Extended embed script** (same \`calmill-embed.js\`):
1. Also finds \`<button data-calmill-popup="username/slug">\` elements
2. On click, creates a full-screen overlay with the booking iframe centered
3. Close button in top-right corner
4. Escape key closes the popup
5. Click outside the iframe closes the popup
6. Prevents body scroll when popup is open

**Usage (on external site):**
\`\`\`html
<!-- Popup embed -->
<button data-calmill-popup="demo/30min">Book a Meeting</button>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
\`\`\`

#### Element Click Embed

A variant where clicking any element opens the popup:
\`\`\`html
<a href="#" data-calmill-popup="demo/30min">Schedule a call with us</a>
\`\`\`

### Embed Code Generator (Dashboard)

**\`src/app/(dashboard)/event-types/[id]/embed/page.tsx\`:**

UI for generating embed code:
- Tab selection: "Inline", "Popup", "Element Click"
- Live preview showing the embed in action (inside an iframe on the page)
- Configuration options:
  - Theme: Light / Dark
  - Hide event details: checkbox
  - Pre-set timezone: dropdown (optional)
- Generated code display (read-only textarea with copy button):
  \`\`\`html
  <!-- CalMill Inline Embed -->
  <div data-calmill-embed="demo/30min" data-calmill-theme="light"></div>
  <script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
  \`\`\`
- "Copy Code" button that copies to clipboard

### Webhook System

Webhooks allow external systems to react to CalMill events (booking created, cancelled, etc.).

#### Webhook CRUD Routes

**\`src/app/api/webhooks/route.ts\`:**
- \`GET /api/webhooks\` — List user's webhooks with last delivery status.
- \`POST /api/webhooks\` — Create webhook. Validate URL is HTTPS (except localhost for dev). Generate \`secret\` for payload signing (HMAC-SHA256). Validate \`eventTriggers\` is a non-empty array of valid trigger names.

**\`src/app/api/webhooks/[id]/route.ts\`:**
- \`GET /api/webhooks/[id]\` — Webhook details with recent delivery history (last 10).
- \`PUT /api/webhooks/[id]\` — Update URL, triggers, active status.
- \`DELETE /api/webhooks/[id]\` — Delete webhook and delivery history.

**Zod schema:**
\`\`\`typescript
export const webhookCreateSchema = z.object({
  url: z.string().url(),
  eventTriggers: z.array(z.enum([
    "BOOKING_CREATED",
    "BOOKING_CANCELLED",
    "BOOKING_RESCHEDULED",
    "BOOKING_ACCEPTED",
    "BOOKING_REJECTED",
  ])).min(1),
  active: z.boolean().optional(),
});
\`\`\`

#### Webhook Event Delivery

**\`src/lib/webhooks.ts\`:**

\`\`\`typescript
export async function deliverWebhookEvent(params: {
  userId: string;
  eventType: string; // "BOOKING_CREATED" etc.
  payload: Record<string, unknown>;
}): Promise<void> {
  // 1. Find all active webhooks for this user that subscribe to this event type
  // 2. For each webhook:
  //    a. Create HMAC-SHA256 signature: HMAC(secret, JSON.stringify(payload))
  //    b. POST to webhook URL with headers:
  //       - Content-Type: application/json
  //       - X-CalMill-Signature: sha256=<signature>
  //       - X-CalMill-Event: <eventType>
  //       - X-CalMill-Delivery: <unique delivery ID>
  //    c. Timeout: 10 seconds
  //    d. Log delivery result (status code, success/failure)
  // 3. Fire-and-forget (don't block the booking flow)
}
\`\`\`

**Webhook payload format:**
\`\`\`json
{
  "event": "BOOKING_CREATED",
  "createdAt": "2026-02-20T15:00:00Z",
  "data": {
    "booking": {
      "uid": "clxyz...",
      "title": "30 Minute Meeting",
      "startTime": "2026-02-25T15:00:00Z",
      "endTime": "2026-02-25T15:30:00Z",
      "status": "ACCEPTED",
      "attendee": {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "timezone": "Europe/London"
      },
      "eventType": {
        "title": "30 Minute Meeting",
        "slug": "30min",
        "duration": 30
      }
    }
  }
}
\`\`\`

**Integration points:** Add \`deliverWebhookEvent()\` calls to:
- \`POST /api/bookings\` → \`BOOKING_CREATED\`
- \`PATCH /api/bookings/[uid]\` → \`BOOKING_ACCEPTED\`, \`BOOKING_REJECTED\`, \`BOOKING_CANCELLED\`
- \`PUT /api/bookings/[uid]/reschedule\` → \`BOOKING_RESCHEDULED\`

### Webhook Management UI

**\`src/app/(dashboard)/settings/webhooks/page.tsx\`:**
- List of webhooks with URL, event triggers (badges), active toggle, last delivery status (green/red dot)
- "Add Webhook" button → dialog with URL input, event trigger checkboxes, create button
- Webhook detail view: edit URL/triggers, delivery history table (last 10: timestamp, event, status code, success/failure)
- "Test" button that sends a test payload to the webhook URL
- Secret display (show once on creation, then masked)

### Recurring Booking Support

Extend existing booking creation to support recurring bookings.

**How it works:**
- Event type has \`recurringEnabled\`, \`recurringFrequency\`, and \`recurringMaxOccurrences\`
- When a booking is created for a recurring event type, the attendee specifies \`recurringCount\` (how many occurrences)
- The system creates N individual bookings, each with the same \`recurringEventId\` (shared UUID linking them)
- Each recurring booking is at the same time on subsequent weeks/biweeks/months

**Modification to \`POST /api/bookings\`:**

If \`recurringCount > 1\` and event type has \`recurringEnabled\`:
1. Validate all N slot times are available
2. Generate a \`recurringEventId\` (shared UUID)
3. Create N booking records, each with incrementing dates:
   - \`weekly\`: +7 days per occurrence
   - \`biweekly\`: +14 days per occurrence
   - \`monthly\`: +1 month per occurrence (using \`date-fns addMonths\`)
4. Return array of booking UIDs

**Recurring booking management:**
- \`GET /api/bookings?recurringEventId=xxx\` — List all bookings in a recurring series
- Cancelling a single occurrence: normal cancel on that booking
- Cancelling all future: \`PATCH /api/bookings/[uid]?cancelFuture=true\` — cancels this and all future bookings with the same \`recurringEventId\` and \`startTime > this.startTime\`

**UI updates:**
- On booking confirmation page, show "This is a recurring event (X occurrences)" with list of all dates
- In dashboard bookings list, recurring bookings show a "recurring" badge and "X of Y" indicator
- Cancel dialog for recurring: "Cancel this occurrence" or "Cancel this and all future"

### Comprehensive E2E Test Suite

**\`e2e/\` directory structure:**
\`\`\`
e2e/
├── helpers/
│   ├── auth-helpers.ts        # Login, signup utilities
│   ├── booking-helpers.ts     # Create bookings, navigate flows
│   └── seed-helpers.ts        # Database seeding for test isolation
├── auth.spec.ts               # Authentication flows
├── booking-flow.spec.ts       # Complete booking journey (from CM-3)
├── dashboard.spec.ts          # Dashboard management (from CM-4)
├── event-types.spec.ts        # Event type CRUD + editor
├── availability.spec.ts       # Schedule editing
├── team-scheduling.spec.ts    # Team booking flows
├── embeds.spec.ts             # Embed widget rendering
├── webhooks.spec.ts           # Webhook management
├── recurring.spec.ts          # Recurring booking flows
└── mobile.spec.ts             # Mobile responsive tests
\`\`\`

**Test counts by file:**
- \`auth.spec.ts\` — 8 tests (login, signup, demo login, logout, session persistence, invalid credentials, redirect after login, protected route redirect)
- \`booking-flow.spec.ts\` — 15 tests (from CM-3, extended)
- \`dashboard.spec.ts\` — 10 tests (stat cards, charts, upcoming bookings, navigation)
- \`event-types.spec.ts\` — 12 tests (list, create, edit tabs, toggle, delete, slug preview, custom questions)
- \`availability.spec.ts\` — 8 tests (view schedule, toggle days, change times, add override, delete schedule)
- \`team-scheduling.spec.ts\` — 10 tests (create team, invite member, round-robin booking, collective booking, team page)
- \`embeds.spec.ts\` — 6 tests (inline render, popup open/close, theme param, postMessage resize, booking in embed)
- \`webhooks.spec.ts\` — 5 tests (create webhook, edit, toggle, test delivery, delete)
- \`recurring.spec.ts\` — 6 tests (create recurring, view series, cancel single, cancel future, date progression)
- \`mobile.spec.ts\` — 8 tests (responsive layout, sidebar collapse, touch interactions, calendar on mobile)

**Total: 88 E2E tests**

### Production Deployment

**Vercel configuration (\`vercel.json\`):**
\`\`\`json
{
  "framework": "nextjs",
  "buildCommand": "npx prisma generate && npm run build",
  "env": {
    "DATABASE_URL": "@calmill-database-url",
    "AUTH_SECRET": "@calmill-auth-secret"
  },
  "headers": [
    {
      "source": "/embed/calmill-embed.js",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/embed/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "ALLOWALL" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors *" }
      ]
    }
  ]
}
\`\`\`

**Critical headers for embeds:**
- \`/embed/calmill-embed.js\` needs \`Access-Control-Allow-Origin: *\` (loaded from external sites)
- \`/embed/*\` pages need \`X-Frame-Options: ALLOWALL\` and \`frame-ancestors *\` CSP (rendered in iframes on external sites)
- All other pages keep default security headers

**Deployment checklist:**
1. Database migration applied to Neon production
2. Environment variables set in Vercel (DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, etc.)
3. Demo data seeded
4. Health check passing at \`/api/health\`
5. Public booking page accessible at \`/demo/30min\`
6. Embed script accessible at \`/embed/calmill-embed.js\`
7. Email delivery working (test booking triggers confirmation email)

---

## Worker Stories

### Story 1: Inline Embed Widget
**Persona:** \`frontend_developer\`

Build the inline embed system:
- \`src/app/embed/layout.tsx\` — Minimal layout (no nav, transparent bg)
- \`src/app/embed/[username]/[slug]/page.tsx\` — Booking page variant for embeds (no header/footer, postMessage for resize and booking events, query param support for theme/timezone)
- \`public/embed/calmill-embed.js\` — Lightweight vanilla JS embed loader for inline mode (finds \`data-calmill-embed\` divs, creates iframes, handles resize messages)

**Target files:** \`src/app/embed/layout.tsx\`, \`src/app/embed/[username]/[slug]/page.tsx\`, \`public/embed/calmill-embed.js\`

---

### Story 2: Popup Embed Widget
**Persona:** \`frontend_developer\`

Extend the embed script with popup mode:
- Add popup handling to \`public/embed/calmill-embed.js\` — finds \`data-calmill-popup\` elements, creates overlay on click, close on Escape/outside click, scroll lock
- Popup overlay styling (full-screen semi-transparent backdrop, centered white container, close button)
- Element click variant: any element with \`data-calmill-popup\` attribute triggers popup
- Smooth open/close animations (CSS transitions)

**Target files:** \`public/embed/calmill-embed.js\` (extend)

---

### Story 3: Webhook System (Backend)
**Persona:** \`backend_developer\`

Build webhook CRUD and delivery:
- \`src/app/api/webhooks/route.ts\` — GET (list) and POST (create with secret generation)
- \`src/app/api/webhooks/[id]/route.ts\` — GET, PUT, DELETE
- \`src/app/api/webhooks/[id]/test/route.ts\` — POST (send test payload)
- \`src/lib/webhooks.ts\` — \`deliverWebhookEvent()\` with HMAC signing, timeout, logging
- Integrate delivery into booking routes (BOOKING_CREATED, CANCELLED, ACCEPTED, REJECTED, RESCHEDULED)
- Webhook delivery is fire-and-forget (non-blocking)

**Target files:** \`src/app/api/webhooks/route.ts\`, \`src/app/api/webhooks/[id]/route.ts\`, \`src/app/api/webhooks/[id]/test/route.ts\`, \`src/lib/webhooks.ts\`, modify booking routes

---

### Story 4: Recurring Booking Support
**Persona:** \`backend_developer\`

Add recurring booking creation and management:
- Modify \`POST /api/bookings\` — Handle \`recurringCount\` parameter, validate all N slots, create linked bookings with shared \`recurringEventId\`
- Modify \`PATCH /api/bookings/[uid]\` — Add \`cancelFuture=true\` query param for cancelling future occurrences
- Modify \`GET /api/bookings\` — Include \`recurringEventId\` grouping info
- Date progression logic: weekly (+7d), biweekly (+14d), monthly (addMonths)

**Target files:** Modify \`src/app/api/bookings/route.ts\`, \`src/app/api/bookings/[uid]/route.ts\`

---

### Story 5: Webhook and Embed Dashboard UI
**Persona:** \`frontend_developer\`

Build management UIs:
- \`src/app/(dashboard)/settings/webhooks/page.tsx\` — Webhook list, create dialog, detail view with delivery history, test button
- \`src/app/(dashboard)/event-types/[id]/embed/page.tsx\` — Embed code generator with inline/popup tabs, live preview, config options, copy button
- Recurring booking UI updates: recurring badge on booking cards, "cancel future" option in cancel dialog, series view on confirmation page

**Target files:** \`src/app/(dashboard)/settings/webhooks/page.tsx\`, \`src/app/(dashboard)/event-types/[id]/embed/page.tsx\`, modify booking components

---

### Story 6: Comprehensive E2E Test Suite
**Persona:** \`qa_engineer\`

Build the full E2E test suite (88 tests across 10 spec files):
- \`e2e/helpers/\` — Shared utilities for auth, booking creation, seeding
- \`e2e/auth.spec.ts\` — 8 authentication tests
- \`e2e/event-types.spec.ts\` — 12 event type management tests
- \`e2e/availability.spec.ts\` — 8 schedule editing tests
- \`e2e/team-scheduling.spec.ts\` — 10 team booking tests
- \`e2e/embeds.spec.ts\` — 6 embed rendering tests
- \`e2e/webhooks.spec.ts\` — 5 webhook management tests
- \`e2e/recurring.spec.ts\` — 6 recurring booking tests
- \`e2e/mobile.spec.ts\` — 8 mobile responsive tests
- Extend \`e2e/booking-flow.spec.ts\` and \`e2e/dashboard.spec.ts\` from earlier epics

**Target files:** 10 spec files + 3 helper files in \`e2e/\`

---

### Story 7: Production Deploy Configuration and Documentation
**Persona:** \`devops_engineer\`

Production deployment setup:
- \`vercel.json\` — Framework config, build command, CORS headers for embeds, iframe security headers
- Update \`.github/workflows/deploy.yml\` — Add production env vars, post-deploy health check, embed script accessibility check
- Update \`README.md\` — Production setup guide, environment variable documentation, embed usage instructions
- Update \`CLAUDE.md\` — Add embed conventions, webhook testing commands

**Target files:** \`vercel.json\`, \`.github/workflows/deploy.yml\` (modify), \`README.md\` (modify), \`CLAUDE.md\` (modify)

---

### Story 8: Final Seed Data and Demo Polish
**Persona:** \`backend_developer\`

Production-ready demo data:
- Expand \`prisma/seed.ts\` with:
  - 2 webhooks (one active pointing to httpbin.org/post for demo, one inactive)
  - 3 recurring bookings (weekly series of 4)
  - Date overrides showing a blocked day and a modified-hours day
  - Realistic attendee names and emails across all bookings
- Verify all seeded data renders correctly in dashboard and public pages
- Add \`calmill-embed-demo.html\` in \`public/\` — Static page demonstrating both inline and popup embeds using the demo user's event types

**Target files:** \`prisma/seed.ts\` (modify), \`public/calmill-embed-demo.html\`

---`,
    buildLog: `**WorkerMill** — 2026-02-17 18:57 UTC

**Planning** — Critic approved plan
- 4 stories — production readiness and testing

**Story 0: Comprehensive Test Suite** — completed by qa_engineer
- 202 unit tests covering all services and utilities
- Slot calculation edge cases (DST transitions, timezone boundaries)
- API route tests with mocked auth
- E2E booking flow tests with Playwright

**Story 1: Responsive Polish** — completed by frontend_developer
- Mobile-first responsive layout fixes
- Color theme consistency across dark mode
- Loading states and skeleton screens
- Error boundary components

**Story 2: Production Config** — completed by devops_engineer
- Vercel deployment configuration
- Environment variable documentation
- Health check and monitoring setup
- CI pipeline optimization

**Story 3: Documentation** — completed by devops_engineer
- Updated README with full feature list
- API documentation
- Contributing guide and architecture overview

✅ **Approved** (9/10) — 202 tests passing, comprehensive coverage`,
  },
  {
    id: "cm-8",
    title: "CM-8: Fix CI Pipeline and Deploy",
    priority: "high",
    storyCount: 3,
    duration: "~29 min",
    status: "deployed",
    techLeadScore: "9/10",
    prNumber: 9,
    prUrl: "https://github.com/workermill-examples/calmill/pull/9",
    commentCount: 57,
    personas: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
    ],
    description: `# CM-8: Fix CI Pipeline — All 5 Jobs Failing

All 5 CI jobs (Lint, TypeCheck, Unit Tests, Build, E2E) are failing on main. Fix every issue so CI is green and Vercel deploy succeeds.

**Repo:** https://github.com/workermill-examples/calmill
**Branch:** work directly on main

---

## 1. Build Failure — Null Safety in Dashboard Route

**File:** \`src/app/api/dashboard/route.ts\` line 131

\`bookingsByEventType[0]\` is accessed without a null check. The ternary checks \`.length > 0\` but TypeScript still sees the index access as possibly undefined.

**Fix:** Add non-null assertion after the length guard:


---

## 2. TypeScript Errors in Source Code (~15 errors)

All are \`string | undefined\` not assignable to \`string\` in Next.js dynamic route params. Next.js 16 types route params as \`Promise<{ slug?: string }>\`.

**Files to fix (same pattern in each — add an early guard or assert after await):**
- \`src/app/api/teams/[slug]/route.ts\` (lines 15, 60, 157)
- \`src/app/api/teams/[slug]/event-types/route.ts\` (lines 22, 55)
- \`src/app/api/teams/[slug]/event-types/[eventTypeId]/route.ts\` (line 11)
- \`src/app/api/teams/[slug]/members/route.ts\` (line 61)
- \`src/app/api/teams/[slug]/members/[memberId]/route.ts\` (lines 17, 119)
- \`src/components/bookings/bookings-list.tsx\` (line 233)

**Fix pattern for route handlers:**


**Additional source errors:**
- \`src/lib/team-slots.ts\` lines 72, 75, 80 — \`firstSlots\` is possibly undefined. Add a guard after the \`.has()\` check or use \`!\`.
- \`src/lib/team-slots.ts\` lines 136, 146 — \`string | undefined\` assigned to \`string | null\`. Use \`?? null\`.
- \`src/components/bookings/bookings-list.tsx\` line 320 — \`handleSearch\` declared but never used. Delete it.

---

## 3. TypeScript Errors in Test Files (~31 errors)

All \`TS6133\` — variables declared but never read.

**Files:**
- \`e2e/auth.spec.ts\` lines 21-22: \`fillSignupForm\`, \`submitSignup\` — prefix with \`_\`
- \`e2e/availability.spec.ts\` line 202: \`overridesList\` — prefix with \`_\`
- \`e2e/booking-flow.spec.ts\` line 485: \`bookingUid\` — prefix with \`_\`
- \`tests/e2e/dashboard.spec.ts\` lines 33-34, 37-38, 448: multiple unused vars — prefix with \`_\`
- \`tests/unit/collective.test.ts\` lines 195, 240, 241: possibly undefined array access — add \`!\` or optional chaining

---

## 4. Lint Errors (16 errors)

**\`tests/unit/round-robin.test.ts\` line 64:**
- \`creatorId\` and \`otherIds\` defined but never used → rename to \`_creatorId\`, \`_otherIds\`

**\`tests/unit/team-routes.test.ts\`:**
- Line 48: \`updateTeam\` → \`_updateTeam\`
- Line 52: \`listMembers\` → \`_listMembers\`
- Line 304: \`data\` → \`_data\`

---

## 5. Vitest Picking Up Playwright E2E Files

Unit test job fails because \`tests/e2e/booking-flow.spec.ts\` and \`tests/e2e/dashboard.spec.ts\` are loaded by Vitest, which chokes on Playwright's \`test.describe()\`.

**Fix:** In \`vitest.config.ts\`, add an exclude for E2E specs:


---

## 6. Deploy Workflow Missing CI Gate

In \`.github/workflows/deploy.yml\`, the deploy job has \`needs: []\` — it deploys even when CI fails.

**Fix:** Either remove the \`needs\` key entirely (so it depends on nothing but doesn't skip CI), or better: add a build + typecheck step directly in the deploy job before the Vercel build. The simplest safe fix is to add a typecheck step before the Vercel build step:


---

## Verification Checklist

After all fixes, confirm:
- [ ] \`npm run typecheck\` passes with 0 errors
- [ ] \`npm run lint\` passes with 0 errors (warnings OK)
- [ ] \`npm run test\` — all test files pass, no Playwright-in-Vitest errors
- [ ] \`npm run build\` completes successfully
- [ ] No functional/behavioral changes — strictly type safety and config fixes`,
    buildLog: `**WorkerMill** — 2026-02-17 23:51 UTC

**Planning** — Critic approved plan
- 3 stories targeting CI fixes and deploy verification

**Story 0: TypeScript & ESLint Fixes** — completed by backend_developer
- Fixed type errors in booking components and API routes
- Resolved ESLint warnings across the codebase
- Updated type imports for Prisma 7 generated client

**Story 1: Frontend TypeScript Fixes** — completed by frontend_developer
- Fixed bookings list component type errors
- Resolved search handler dead code
- Non-null assertion fixes for filtered arrays

**Story 2: Build & Deploy** — completed by devops_engineer
- All 5 CI jobs passing (lint, typecheck, tests, build, E2E)
- Vercel deploy succeeded
- Health check verified at calmill.workermill.com

✅ **Approved** (9/10) — CI green, Vercel deploy live, all quality gates passing`,
  },
];
