# TP-1: Project Setup & Dev Environment

> **TaskPulse Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/taskpulse`](https://github.com/workermill-examples/taskpulse)
> Architecture: [README.md](./README.md)

---

## What This Ticket Delivers

A fully scaffolded Next.js 16 project with:
1. Project structure and all dependencies installed
2. Neon PostgreSQL connected via Prisma 7 with driver adapter, full schema, and initial migration
3. NextAuth v5 authentication (credentials provider, demo user seed)
4. Dark-theme root layout with Tailwind CSS v4 (CSS-first config)
5. GitHub Actions CI pipeline (lint, typecheck, test)
6. GitHub Actions deploy pipeline (migrations, seed, smoke test)
7. Health check endpoint responding at production URL
8. Page stubs for all routes (replaced by TP-3)

## Scope Boundary

> **TP-1 creates ONLY the files listed in the file tree below.** Do NOT create:
> - `vercel.json` — Vercel auto-detects Next.js (vercel.json is TP-5)
> - `tailwind.config.ts` / `tailwind.config.js` — Tailwind v4 uses CSS-first config (no JS config file)
> - `components.json` — No shadcn/ui CLI config needed
> - `.gitkeep` files in empty directories
> - Any component files beyond the shared components listed below
> - Any API routes beyond auth, health, and seed

## Prerequisites

None — this is the first ticket.

---

## Tech Stack (pinned versions)

> **CRITICAL: Workers MUST use these exact versions. Do NOT change.**

```json
{
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@prisma/adapter-neon": "^7.2.0",
    "@neondatabase/serverless": "^1.0.0",
    "next-auth": "5.0.0-beta.30",
    "bcrypt": "^6.0.0",
    "zod": "^3.23.0",
    "recharts": "^3.7.0",
    "@headlessui/react": "^2.2.0",
    "date-fns": "^4.1.0",
    "cron-parser": "^4.9.0",
    "cronstrue": "^3.9.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0",
    "@types/bcrypt": "^6.0.0",
    "prisma": "^7.2.0",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/postcss": "^4.1.0",
    "postcss": "^8.4.0",
    "eslint": "^9.0.0",
    "@eslint/eslintrc": "^3.3.0",
    "eslint-config-next": "^16.1.0",
    "prettier": "^3.3.0",
    "vitest": "^4.0.0",
    "@vitest/coverage-v8": "^4.0.0",
    "@playwright/test": "^1.58.0",
    "tsx": "^4.19.0"
  }
}
```

> **Pinned versions — do NOT change:**
> - `"next": "^16.1.0"` — Next.js 16 (Turbopack default, async params enforced, `next lint` removed)
> - `"eslint-config-next": "^16.1.0"` — MUST match Next.js major
> - `"react": "^19.0.0"` + `"react-dom": "^19.0.0"` — Next.js 16 ships React 19.2
> - `"next-auth": "5.0.0-beta.30"` — exact pin (latest non-vulnerable beta), not ^5
> - `"prisma": "^7.2.0"` + `"@prisma/adapter-neon": "^7.2.0"` + `"@neondatabase/serverless": "^1.0.0"` — Prisma 7 requires driver adapters; adapter-neon requires @neondatabase/serverless as peer dep
> - `"bcrypt": "^6.0.0"` — bcrypt 5.x has vulnerable `tar`
> - `"tailwindcss": "^4.1.0"` — Tailwind v4, CSS-first config (NO tailwind.config.ts)
> - `"recharts": "^3.7.0"` — Recharts 3 (NOT 2.x — breaking API changes)
> - `"vitest": "^4.0.0"` — Vitest 4 (NOT 2.x)
> - No `@prisma/client` in deps — Prisma 7 generates client locally
> - No `autoprefixer` — Tailwind v4 handles autoprefixing internally
> - No `@auth/prisma-adapter` — using Credentials provider only (manual user lookup)
> - `"@eslint/eslintrc": "^3.3.0"` — FlatCompat adapter for using eslint-config-next in ESLint 9 flat config
> - `"cronstrue": "^3.9.0"` — Human-readable cron descriptions (NOT cron-parser, which only parses)
> - `"tailwind-merge": "^3.4.0"` — Used in `cn()` helper to resolve conflicting Tailwind classes
> - Node version in CI: `22`

---

## package.json Scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:headed": "playwright test --headed",
  "format": "prettier --write .",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```

> Workers MUST use these EXACT scripts. Key rules:
> - `"test"` = `"vitest run"` (NOT `"vitest"` — watch mode hangs CI)
> - `"build"` = `"next build"` (NOT `"prisma generate && next build"`)
> - `"postinstall"` = `"prisma generate"` (runs after `npm ci` in CI)

---

## CRITICAL — Next.js 16 Async Params Pattern

Every route handler and page component MUST use this pattern:

**API route handler:**
```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // ...
}
```

**Page component:**
```typescript
export default async function Page({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  // ...
}
```

**Using `useSearchParams()`:** Must wrap in `<Suspense>`:
```tsx
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function SearchParamsReader() {
  const searchParams = useSearchParams();
  return <div>{searchParams.get("q")}</div>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SearchParamsReader />
    </Suspense>
  );
}
```

---

## CRITICAL — Prisma 7 Client Singleton

```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

> **Import `PrismaClient` from `"@/generated/prisma"` — NOT `"@prisma/client"`.**
> The `@/` alias resolves to `src/` via tsconfig paths (Next.js default).
> The `@prisma/adapter-neon` provides the Neon serverless driver for pooled connections.
> The `PrismaNeon({ connectionString })` constructor is the modern Neon adapter API — no `Pool` or `ws` import needed.

---

## CRITICAL — NextAuth v5 Pattern

```typescript
// src/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

**SessionProvider wrapper (client component):**
```tsx
// src/components/shared/SessionProvider.tsx
"use client";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
```

---

## CRITICAL — Auth Route Protection Pattern

There is NO `src/middleware.ts` (Next.js middleware file) for route protection. Instead, **every server component page** that requires auth must check the session at the top:

```typescript
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProtectedPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // ... render page
}
```

**All pages under `/projects` and `/[project]/**` MUST include this check.** The landing page (`/`), login, and signup pages are public.

---

## Work Groups

### Work Group 1: Repository Scaffolding (9 files)

**Files:**
- `package.json`
- `tsconfig.json`
- `next.config.ts`
- `postcss.config.mjs`
- `eslint.config.mjs`
- `.prettierrc`
- `.env.example`
- `.gitignore`
- `prisma.config.ts`

**`package.json` MUST include `"type": "module"`:**
```json
{
  "name": "taskpulse",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  ...
}
```

> **CRITICAL:** `"type": "module"` is required for ESM imports in `.ts` and `.js` files. Without it, `next.config.ts` and other config files may fail with syntax errors. Next.js 16 `create-next-app` includes this by default.

**`tsconfig.json`** (Next.js 16 generates this, but workers MUST match):
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

> **CRITICAL:** The `"paths": { "@/*": ["./src/*"] }` mapping is what makes `import { prisma } from "@/lib/prisma"` work. Without it, all `@/` imports fail. This is also what `vitest.config.ts` and seed scripts need to be aware of — the `@/` alias only works inside Next.js and tools that read `tsconfig.json`.

**`next.config.ts` MUST be minimal for TP-1:**
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};
export default nextConfig;
```
Do NOT add `output`, `poweredByHeader`, `compress`, or other production options (those are TP-5).

**`postcss.config.mjs`** (Tailwind v4 PostCSS plugin):
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

> **CRITICAL:** Tailwind v4 has NO `tailwind.config.ts`. All theme configuration is done via `@theme` in CSS. See the root layout globals.css below.

**`eslint.config.mjs`** (ESLint flat config — `next lint` is removed in Next.js 16):
```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/", "out/", "build/", "next-env.d.ts", "src/generated/"],
  },
];

export default eslintConfig;
```

> **CRITICAL:** Do NOT create `.eslintrc.json` — Next.js 16 uses ESLint flat config. The `next lint` command no longer exists; use `eslint .` directly. The `FlatCompat` adapter from `@eslint/eslintrc` is required because `eslint-config-next` exports a legacy config format, not native flat config.

**`prisma.config.ts`** (Prisma 7 CLI configuration):
```typescript
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || "",
  },
});
```

> **CRITICAL:** In Prisma 7, the datasource `url` is NOT in `schema.prisma` — it's in `prisma.config.ts`. The `DIRECT_DATABASE_URL` (non-pooled) is used for CLI operations (migrations, push). The pooled `DATABASE_URL` is used at runtime via `@prisma/adapter-neon`.
> The `|| ""` fallback is required because `prisma generate` loads this config but does NOT need a database connection. Without the fallback, `generate` would fail in CI environments where only build-time env vars are available (no database secrets).

**`.gitignore` must include:**
```
node_modules/
.next/
out/
build/
.env
.env.local
src/generated/
*.tsbuildinfo
```

> **CRITICAL:** `src/generated/` MUST be in `.gitignore` — Prisma 7 generates the client there via `prisma generate`. Generated code should not be committed. The `postinstall` script runs `prisma generate` after `npm ci` in CI.

**`.env.example`:**
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DIRECT_DATABASE_URL=postgresql://user:pass@host:5432/dbname
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
SEED_TOKEN=your-seed-token
```

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 2: Database Schema & Seed (2 files)

**Files:**
- `prisma/schema.prisma` — Full schema from README.md (10 models, 4 enums)
- `prisma/seed.ts` — Demo user seed only (full data seed is TP-2)

**`prisma/schema.prisma` datasource block (Prisma 7):**
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

> **CRITICAL Prisma 7 changes:**
> - Generator is `"prisma-client"` (NOT `"prisma-client-js"`)
> - `output = "../src/generated/prisma"` puts the generated client at `src/generated/prisma/`
> - Datasource has NO `url` or `directUrl` — those are in `prisma.config.ts` (Work Group 1)
> - Add `src/generated/` to `.gitignore` — generated code should not be committed

**`prisma/seed.ts` for TP-1 — demo user only:**
```typescript
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcrypt";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("demo1234", 12);

  await prisma.user.upsert({
    where: { email: "demo@workermill.com" },
    update: {},
    create: {
      email: "demo@workermill.com",
      name: "Demo User",
      passwordHash,
    },
  });

  console.log("Seed complete: demo user created");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

> **The email is `demo@workermill.com` — NOT `demo@taskpulse.com` or any other domain.**
> **Import from `"../src/generated/prisma"` — NOT `"@prisma/client"` (that's Prisma 6).**

**After completing, run:**
1. `npx prisma generate` — generates the Prisma client to `src/generated/prisma/`
2. Create the initial migration (does NOT require a database connection):
   ```bash
   mkdir -p prisma/migrations/0001_init
   npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0001_init/migration.sql
   ```
3. `npm run typecheck` — must pass with 0 errors.

> **CRITICAL:** The initial migration MUST be created and committed. The CI deploy workflow runs `prisma migrate deploy` which requires existing migration files. Without this step, CI will fail on first push.
> **IMPORTANT:** Do NOT use `prisma migrate dev` — it requires a live database connection that workers don't have. Use `prisma migrate diff --from-empty` instead, which generates the SQL from the schema alone.

---

### Work Group 3: Auth, Layout & Page Stubs (12 files)

**Files:**
- `src/lib/auth.ts` — NextAuth config (exact pattern above)
- `src/lib/prisma.ts` — Prisma 7 client singleton with Neon adapter (exact pattern above)
- `src/lib/utils.ts` — `cn()` classname helper, `formatDuration()`, `formatRelativeTime()`
- `src/types/next-auth.d.ts` — NextAuth session type augmentation
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/auth/signup/route.ts` — POST with bcrypt (12 rounds min), 409 on duplicate
- `src/app/layout.tsx` — Root layout with dark theme, SessionProvider, Inter + JetBrains Mono fonts
- `src/app/globals.css` — Tailwind v4 CSS-first config (`@import "tailwindcss"` + `@theme`)
- `src/app/page.tsx` — Landing page (dark theme, hero, "Try the Demo" button, "Built by WorkerMill" footer)
- `src/app/login/page.tsx` — Login with NextAuth `signIn()`, Suspense wrapper for searchParams
- `src/app/signup/page.tsx` — Signup calling `/api/auth/signup`, auto-login after registration
- `src/components/shared/SessionProvider.tsx` — Client wrapper

**`src/types/next-auth.d.ts` — REQUIRED for typecheck to pass:**
```typescript
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
    };
  }
}

import "next-auth/jwt";

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
  }
}
```

> **CRITICAL:** Without this file, every usage of `session.user.id` will fail typecheck. This is NOT optional.

**`src/lib/utils.ts` — `cn()` helper uses clsx + tailwind-merge:**
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

**Root layout (`src/app/layout.tsx`) — font loading with `next/font`:**
```typescript
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});
```
Use in layout:
```tsx
<html lang="en" className={`dark ${inter.className} ${jetbrainsMono.variable}`}>
  <body className="bg-gray-950 text-gray-100">
    <SessionProvider>{children}</SessionProvider>
  </body>
</html>
```

**Root layout details:**
- `<html lang="en" className="dark">` with `bg-gray-950 text-gray-100`
- Inter font for body (via `next/font/google`), JetBrains Mono as CSS variable `--font-mono`
- SessionProvider wrapping children
- Viewport configuration: `width=device-width, initial-scale=1`

**`src/app/globals.css` (Tailwind v4 CSS-first config):**
```css
@import "tailwindcss";

@theme {
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
}
```

> **CRITICAL:** Tailwind v4 uses `@import "tailwindcss"` and `@theme` in CSS — NOT a `tailwind.config.ts` file. Content detection is automatic (no `content: [...]` array). All theme customization goes in `@theme` blocks.

**Landing page (`src/app/page.tsx`):**
- Dark background with gradient accent
- Hero: "Background Tasks, Monitored." + subtitle about real-time observability
- "Try the Demo" button → calls `signIn("credentials", { email: "demo@workermill.com", password: "demo1234", callbackUrl: "/projects" })`
- Feature highlights: Task Registry, Real-time Traces, Log Streaming, Scheduling
- Footer: "Built by WorkerMill"

**Login page:**
- Dark card on dark background
- Email/password form
- NextAuth `signIn("credentials", { ... })` with callback URL validation (open redirect protection)
- Link to signup
- `useSearchParams()` wrapped in `<Suspense>`

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 4: Remaining Page Stubs (10 files)

**Files:**
- `src/app/projects/page.tsx` — Stub: "Projects" heading, will be replaced in TP-3
- `src/app/[project]/layout.tsx` — Stub: simple wrapper, will be replaced in TP-3
- `src/app/[project]/page.tsx` — Redirect to `./runs`
- `src/app/[project]/runs/page.tsx` — Stub: "Runs" heading
- `src/app/[project]/runs/[id]/page.tsx` — Stub: "Run Detail" heading
- `src/app/[project]/tasks/page.tsx` — Stub: "Tasks" heading
- `src/app/[project]/tasks/[id]/page.tsx` — Stub: "Task Detail" heading
- `src/app/[project]/schedules/page.tsx` — Stub: "Schedules" heading
- `src/app/[project]/dashboard/page.tsx` — Stub: "Dashboard" heading
- `src/app/[project]/settings/page.tsx` — Stub: "Settings" heading

> **IMPORTANT:** This group creates ONLY the 10 page stub files listed above. Shared components (LoadingSpinner, ErrorBoundary, EmptyState), types, and validations are created in **Work Group 5**. Do NOT create them here.

**Each stub page follows this pattern:**
```tsx
export default async function RunsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 className="text-2xl font-semibold">Runs</h1>
      <p className="text-gray-400 mt-2">Project: {project}</p>
    </div>
  );
}
```

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 5: Shared Components, Health API & Config (8 files)

> **This group owns ALL shared components, types, and validations.** These files are NOT created by Work Group 4.

**Files:**
- `src/components/shared/LoadingSpinner.tsx` — Sizes: sm, md, lg. Spinner animation using Tailwind `animate-spin`. Skeleton variant for table/card loading states.
- `src/components/shared/ErrorBoundary.tsx` — `"use client"` — React error boundary with "Something went wrong" message + retry button. Dark theme (`bg-gray-900 text-red-400`). Must be a client component (React error boundaries require class components or client-side hooks in App Router).
- `src/components/shared/EmptyState.tsx` — Centered layout with inline SVG icon + title + description + optional CTA button. Props: `icon`, `title`, `description`, `action?`.
- `src/types/index.ts` — Shared TypeScript types (see below)
- `src/lib/validations.ts` — Base Zod schemas: `emailSchema`, `passwordSchema` (min 8 chars), `slugSchema`, `cursorPaginationSchema` (cursor + limit 1-100)
- `src/app/api/health/route.ts` — Returns `{ status: "ok", timestamp: "..." }`
- `src/app/api/seed/route.ts` — Protected by `SEED_TOKEN` header, creates demo user
- `src/hooks/useSSE.ts` — SSE subscription hook (EventSource wrapper with auto-reconnect)

**`src/types/index.ts` — key types:**
```typescript
export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type RunStatus = "QUEUED" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
}
```

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 6: CI/CD & Tests (5 files)

**Files:**
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `vitest.config.ts`
- `playwright.config.ts`
- `tests/unit/health.test.ts`

**CI Pipeline (`.github/workflows/ci.yml`):**
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Lint, Type Check & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm audit --audit-level=critical || true  # beta deps (next-auth) may trigger high-level advisories workers can't fix

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: quality
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
      NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}
      NEXTAUTH_URL: http://localhost:3000
      AUTH_TRUST_HOST: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npx playwright install --with-deps
      - run: npm run test:e2e  # Playwright webServer builds + starts the app automatically
```

**Deploy Pipeline (`.github/workflows/deploy.yml`):**
```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  post-deploy:
    name: Post-Deploy Tasks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
        run: npx prisma migrate deploy

      - name: Wait for Vercel deploy
        run: sleep 30

      - name: Seed demo data
        run: |
          response=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            https://taskpulse.workermill.com/api/seed \
            -H "Authorization: Bearer ${{ secrets.SEED_TOKEN }}")

          if [ "$response" = "200" ] || [ "$response" = "409" ]; then
            echo "Seed successful (HTTP $response)"
          else
            echo "Seed failed with HTTP $response"
            exit 1
          fi

      - name: Smoke test
        run: |
          curl -f https://taskpulse.workermill.com/api/health || exit 1
          echo "Health check passed"
```

> Workers MUST use these EXACT workflows character-for-character. Do NOT add third-party actions, health check retry loops, or extra jobs.

**`vitest.config.ts`:**
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

> **CRITICAL:** The `@` alias MUST resolve to `src/` — without this, any test importing from `@/lib/prisma` or `@/generated/prisma` will fail with "Cannot find module". The `environment: "node"` is correct for API route tests. If testing React components later, use `environment: "jsdom"` in a separate config or per-file override.

**`playwright.config.ts`:**
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

> The Playwright web server auto-builds and starts Next.js before tests. In CI, it always starts fresh. Locally, it reuses a running server if available.
>
> **Note:** CI E2E tests run against the production Neon database (via `DATABASE_URL` secret). The seed data is idempotent (upsert), so this is safe as long as tests don't create ephemeral data without cleanup. If test isolation is needed later, consider a separate Neon branch.

**After completing, run:** `npm run typecheck && npm run test` — must pass.

---

### Work Group 7: Documentation (3 files)

**Files:**
- `CLAUDE.md` — Worker instructions, project conventions, local dev setup
- `README.md` — Project overview, tech stack, setup, running locally
- `public/favicon.svg` — Simple SVG favicon with "TP" text in violet

**CLAUDE.md contents:**
- Project overview (TaskPulse — background task monitoring dashboard)
- Tech stack summary (Next.js 16, Prisma 7, Tailwind v4, Recharts 3)
- Local dev setup (`npm install`, `npx prisma generate`, `npx prisma db push`, `npm run dev`)
- Dark theme convention: all UI uses `bg-gray-950`/`bg-gray-900` backgrounds
- Tailwind v4 convention: CSS-first config, no `tailwind.config.ts` — theme in `@theme` blocks
- Prisma 7 convention: import from `@/generated/prisma`, use adapter, no `@prisma/client`
- Next.js 16 async params pattern (with examples)
- NextAuth v5 pattern (with examples)
- ESLint: flat config only (`eslint.config.mjs`), no `.eslintrc.json`, lint with `eslint .`
- Run status colors (table)
- Quality gates: `npm run typecheck` (0 errors), `npm run lint` (0 errors), `npm run test` (all pass)
- Do NOT create: vercel.json, tailwind.config.ts, .eslintrc.json, binary files

**After completing, run:** `npm run typecheck && npm run lint` — must pass with 0 errors.

---

## Definition of Done

- [ ] Repository `workermill-examples/taskpulse` has full project structure
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts locally on port 3000
- [ ] `npm run typecheck` passes (0 errors)
- [ ] `npm run lint` passes (0 errors)
- [ ] Prisma schema applied to Neon
- [ ] `GET /api/health` returns 200 locally
- [ ] CI workflow runs successfully
- [ ] Vercel deploys on push to main
- [ ] `https://taskpulse.workermill.com/api/health` returns 200
- [ ] Landing page visible with dark theme
- [ ] Login/signup functional with demo credentials
- [ ] All page stubs render with correct dark theme
- [ ] CLAUDE.md and README.md written
- [ ] `.gitignore` does NOT ignore `prisma/migrations/`

## Estimated Plan Size

5-7 stories.

---

## Mandatory Rules

### Rule 1: Prisma 7 Requires Both DATABASE_URL and DIRECT_DATABASE_URL

Neon uses connection pooling. Both environment variables MUST be set in every environment (local, CI, Vercel). `DATABASE_URL` (pooled) is used by `@prisma/adapter-neon` at runtime. `DIRECT_DATABASE_URL` (direct) is used by Prisma CLI via `prisma.config.ts`.

### Rule 2: CI E2E Environment

The E2E job needs: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `AUTH_TRUST_HOST=true`.

### Rule 3: Dark Theme Everywhere

Every page and component uses dark colors. Base: `bg-gray-950 text-gray-100`. Cards/surfaces: `bg-gray-900`. Borders: `border-gray-800`. No light mode.
