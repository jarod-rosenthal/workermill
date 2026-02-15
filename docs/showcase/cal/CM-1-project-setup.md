# CM-1: Project Setup & Dev Environment

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Scaffold a complete Next.js 16 project from scratch — Prisma 7 ORM with a 13-model scheduling schema, PostgreSQL (Neon), TailwindCSS 4 CSS-first configuration, CI/CD pipelines, and a working Vercel deploy. This is the **first ticket** in the CalMill series, creating the project skeleton that all subsequent epics build on.

**Deliverables:**

1. Project config and dependencies (Next.js 16, React 19.2, TypeScript)
2. Prisma 7 schema with 13 models, 3 enums, applied to Neon PostgreSQL
3. TailwindCSS 4 CSS-first configuration (NO `tailwind.config.js`)
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

```json
{
  "engines": { "node": ">=24.0.0" },
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "next-auth": "5.0.0-beta.25",
    "@auth/prisma-adapter": "latest",
    "zod": "^4.3.0",
    "date-fns": "^4.1.0",
    "@date-fns/tz": "latest",
    "bcryptjs": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "prisma": "^7.2.0",
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
```

### Prisma 7 Configuration (CRITICAL — new patterns)

**`prisma.config.ts`** (root of project):
```typescript
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
});
```

**Schema generator block** — Prisma 7 still uses generator in schema.prisma but the client output path should be explicit:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}
```

**Import the generated client from the output path:**
```typescript
import { PrismaClient } from "@/generated/prisma";
```

**NOT** from `@prisma/client` (Prisma 7 moves generated code outside node_modules).

### Prisma Schema (13 models, 3 enums)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
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
```

### TailwindCSS 4 Configuration (CRITICAL — new patterns)

**NO `tailwind.config.js` or `tailwind.config.ts`**. TailwindCSS 4 uses CSS-first configuration.

**`postcss.config.js`:**
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

**`src/app/globals.css`:**
```css
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
```

### NextAuth v5 Configuration

**`src/lib/auth.ts`:**
```typescript
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
```

### Project Structure

```
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
```

### Seed Data

Create demo user with predictable credentials:
- **Email:** `demo@workermill.com`
- **Password:** `demo1234`
- **Username:** `demo`
- **Name:** "Alex Demo"
- **Timezone:** `America/New_York`

Create one default schedule ("Business Hours"):
- Monday-Friday: 09:00-17:00
- Saturday-Sunday: unavailable

Create two stub event types:
- "30 Minute Meeting" (slug: `30min`, duration: 30)
- "60 Minute Consultation" (slug: `60min`, duration: 60)

### Landing Page

The landing page is the **public entry point** — visible without authentication.

**Hero section:**
- Headline: "Open Scheduling for Everyone"
- Subheadline: "Create booking pages, manage availability, and let people schedule time with you — no back-and-forth emails."
- CTA button: "Get Started" → `/signup`
- Secondary CTA: "Try the Demo" → calls `signIn()` with demo credentials

**Features section (3 cards):**
1. "Event Types" — Create different meeting types with custom durations, locations, and questions
2. "Smart Scheduling" — Timezone-aware availability with calendar conflict detection
3. "Team Booking" — Round-robin and collective scheduling for your team

**Footer:** "Built by WorkerMill" with link to workermill.com

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://..."
DIRECT_DATABASE_URL="postgresql://..."

# Auth
AUTH_SECRET="openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Email (Resend)
RESEND_API_KEY=""
EMAIL_FROM="CalMill <noreply@calmill.workermill.com>"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
SEED_TOKEN="calmill-seed-token-dev"
```

---

## Worker Stories

### Story 1: Core Project Config
**Persona:** `backend_developer`

Create foundational configuration:
- `package.json` with all dependencies at exact versions specified above
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `postinstall` (prisma generate)
- `tsconfig.json` with ES2022/ESNext, strict mode, path alias `@/*` → `./src/*`
- `next.config.ts` with minimal config (empty object)
- `prisma.config.ts` with Prisma 7 configuration pointing to `prisma/schema.prisma`

**Target files:** `package.json`, `tsconfig.json`, `next.config.ts`, `prisma.config.ts`

---

### Story 2: Tooling and TailwindCSS 4 Configuration
**Persona:** `frontend_developer`

Configure linting, formatting, and TailwindCSS 4 CSS-first setup:
- `.eslintrc.json` — ESLint 9 extending next/core-web-vitals and TypeScript
- `.prettierrc` — Single quotes, trailing commas, 100 char width, tab width 2
- `postcss.config.js` — `@tailwindcss/postcss` plugin (NOT `tailwindcss` directly)
- `src/app/globals.css` — `@import "tailwindcss"` with `@theme` block defining custom colors (primary blue scale), fonts (Inter, JetBrains Mono), and border-radius tokens
- `.gitignore` — node_modules, .next, .env, coverage, src/generated
- `.env.example` — Full template with all env vars

**CRITICAL:** No `tailwind.config.js` or `tailwind.config.ts`. TailwindCSS 4 does not use JavaScript config files. All customization goes in the CSS `@theme` block.

**Target files:** `.eslintrc.json`, `.prettierrc`, `postcss.config.js`, `src/app/globals.css`, `.gitignore`, `.env.example`

---

### Story 3: Prisma 7 Schema and Seed Script
**Persona:** `backend_developer`

Database foundation:
- `prisma/schema.prisma` — Complete schema with all 13 models and 3 enums as specified above
- `prisma/seed.ts` — Creates demo user (bcryptjs hash), default schedule with availability, and two event types
- Ensure `prisma.seed` is configured in `package.json` for `tsx` execution

**Data relationships to enforce:**
- User 1:N EventType, Booking, Schedule, TeamMember, Webhook, CalendarConnection, Account, Session
- Schedule 1:N Availability, DateOverride, EventType
- EventType 1:N Booking
- Team 1:N TeamMember, EventType
- Cascade deletes on: User→Account, User→Session, User→Schedule, Schedule→Availability, Schedule→DateOverride, User→TeamMember, Team→TeamMember

**Target files:** `prisma/schema.prisma`, `prisma/seed.ts`

---

### Story 4: Lib Utilities, Auth, and Types
**Persona:** `backend_developer`

Core application libraries:
- `src/lib/auth.ts` — NextAuth v5 config with Credentials + Google providers, PrismaAdapter, JWT strategy, custom callbacks exposing `id`, `username`, `timezone` on session
- `src/lib/prisma.ts` — PrismaClient singleton imported from `@/generated/prisma` (Prisma 7 pattern). Use global cache in development to prevent connection exhaustion.
- `src/lib/utils.ts` — `cn()` (clsx + twMerge), `formatDate()`, `generateSlug()`, `generateUsername()` (from email), `debounce()`
- `src/lib/validations.ts` — Zod 4 schemas: `loginSchema`, `signupSchema`, `eventTypeSchema`, `bookingSchema`, `scheduleSchema`
- `src/types/index.ts` — TypeScript types with Prisma relations, API response types `ApiResponse<T>`, `PaginatedResponse<T>`
- `src/types/next-auth.d.ts` — Module augmentation adding `id`, `username`, `timezone` to `session.user`

**Target files:** `src/lib/auth.ts`, `src/lib/prisma.ts`, `src/lib/utils.ts`, `src/lib/validations.ts`, `src/types/index.ts`, `src/types/next-auth.d.ts`

---

### Story 5: Test Configuration
**Persona:** `qa_engineer`

Testing infrastructure:
- `vitest.config.ts` — Node environment, path alias support (`@/*` → `./src/*`), v8 coverage targeting `src/**/*.ts`, global test APIs, exclude `e2e/` and `node_modules/`
- `playwright.config.ts` — Chromium-only for speed, CI-optimized retries (2 in CI, 0 local), HTML reporter, `baseURL: http://localhost:3000`, web server integration for local dev
- `tests/helpers/setup.ts` — Global test setup: Prisma mock (all models), NextAuth mock (session with demo user), automatic mock reset between tests

**Target files:** `vitest.config.ts`, `playwright.config.ts`, `tests/helpers/setup.ts`, `tests/unit/health.test.ts`

---

### Story 6: App Shell — Landing, Login, Signup Pages
**Persona:** `frontend_developer`

User-facing public pages:
- `src/app/layout.tsx` — Root layout with Inter font (next/font/google), TailwindCSS globals, metadata (title: "CalMill — Open Scheduling"), SessionProvider wrapper
- `src/app/page.tsx` — Landing page as specified above (hero, features, footer). No auth required.
- `src/app/login/page.tsx` — Email/password form, "Try Demo" button (auto-fills demo credentials), link to signup, Suspense wrapper for `useSearchParams()`, calls `signIn("credentials")`, redirects to `/event-types` on success
- `src/app/signup/page.tsx` — Name, email, username, password form with Zod validation. POST to `/api/auth/signup`, auto-login after success, redirect to `/getting-started`
- `src/app/getting-started/page.tsx` — Simple onboarding stub: "Welcome! Set up your availability to get started." with link to `/availability`
- `src/components/providers.tsx` — Client component wrapping `SessionProvider`

**Target files:** `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/getting-started/page.tsx`, `src/components/providers.tsx`

---

### Story 7: Dashboard Layout — Sidebar, Header, Navigation
**Persona:** `frontend_developer`

Authenticated layout shell:
- `src/app/(dashboard)/layout.tsx` — Server component: check `auth()`, redirect to `/login` if unauthenticated. Renders sidebar + header + main content area.
- `src/components/sidebar.tsx` — Navigation links:
  - Event Types (`/event-types`) — Calendar icon
  - Bookings (`/bookings`) — Inbox icon
  - Availability (`/availability`) — Clock icon
  - Settings (`/settings`) — Gear icon
  - Collapsible on mobile with hamburger menu
- `src/components/header.tsx` — Current page title, user avatar dropdown (profile link, sign out), timezone display
- `src/app/(dashboard)/event-types/page.tsx` — Stub: "Your event types will appear here"
- `src/app/(dashboard)/bookings/page.tsx` — Stub: "Your bookings will appear here"
- `src/app/(dashboard)/availability/page.tsx` — Stub: "Manage your availability"
- `src/app/(dashboard)/settings/page.tsx` — Stub: "Account settings"

**Target files:** `src/app/(dashboard)/layout.tsx`, `src/components/sidebar.tsx`, `src/components/header.tsx`, plus 4 stub pages

---

### Story 8: Public Booking Layout Shell
**Persona:** `frontend_developer`

Public-facing layout for booking pages (no auth required):
- `src/app/(public)/layout.tsx` — Minimal layout: CalMill logo in top-left corner, no sidebar, no auth check. Clean white background with centered content area.
- `src/app/(public)/[username]/page.tsx` — Stub: Displays "Loading {username}'s profile..." placeholder. Will show event type cards in CM-3.
- `src/app/(public)/[username]/[slug]/page.tsx` — Stub: Displays "Loading booking page..." placeholder. Will show calendar + slot picker in CM-3.

**Target files:** `src/app/(public)/layout.tsx`, `src/app/(public)/[username]/page.tsx`, `src/app/(public)/[username]/[slug]/page.tsx`

---

### Story 9: API Routes — Health, Seed, Auth
**Persona:** `backend_developer`

Three API endpoints:
- **`GET /api/health`** — Returns `{ status: "ok", timestamp, version: "1.0.0" }` with 200. On error returns 500.
- **`POST /api/seed`** — Protected by `SEED_TOKEN` via Bearer header. Creates demo user with bcryptjs hash (12 rounds), default schedule, availability rows (Mon-Fri 09:00-17:00), and two event types. Idempotent (upsert, not create).
- **`GET/POST /api/auth/[...nextauth]/route.ts`** — NextAuth v5 route handler: `export const { GET, POST } = handlers` from `src/lib/auth.ts`
- **`POST /api/auth/signup`** — Creates new user: validate with `signupSchema`, check email + username uniqueness, hash password with bcryptjs, create user + default schedule + default availability, return user object (no password). Returns 409 on duplicate email/username.

**Target files:** `src/app/api/health/route.ts`, `src/app/api/seed/route.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/signup/route.ts`

---

### Story 10: CI/CD Pipelines and Documentation
**Persona:** `devops_engineer`

Infrastructure and docs:
- **`.github/workflows/ci.yml`** — Triggered on push and PR to main. Jobs: lint, typecheck, unit tests (Vitest), build. Node.js 24. Postgres service container for tests. Parallel job execution.
- **`.github/workflows/deploy.yml`** — Triggered on push to main after CI passes. Steps: run migration (`prisma db push`), seed demo data, deploy to Vercel, health check verification.
- **`CLAUDE.md`** — Worker development guide:
  - Tech stack with versions
  - Key conventions: Prisma 7 import from `@/generated/prisma`, TailwindCSS 4 CSS-first, NextAuth v5 `auth()` pattern
  - Common commands: `npm run dev`, `npm run build`, `npx prisma db push`, `npx prisma generate`
  - File structure overview
  - Testing commands
- **`README.md`** — Project overview, local setup instructions, environment variable documentation, architecture diagram

**Target files:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `CLAUDE.md`, `README.md`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 10 |
| **Personas** | `backend_developer`, `frontend_developer`, `qa_engineer`, `devops_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | CM-2 (Core Backend) |
