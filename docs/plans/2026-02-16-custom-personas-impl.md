# Dynamic Expert Registry — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded worker expert configs with a dynamic API-driven registry so custom personas become first-class workers.

**Architecture:** New API endpoint returns all enabled personas with their expert configs. Worker fetches at startup, planner prompt built dynamically. Frontend reads persona metadata from API instead of hardcoded maps.

**Tech Stack:** TypeScript, Express, TypeORM, React, Zustand

---

### Task 1: API Endpoint — Expert Registry

**Files:**
- Modify: `api/src/routes/personas.ts` (after line 819, the worker bundle section)
- Modify: `api/src/services/persona.ts` (add `getExpertRegistry` function)

**Step 1: Add service function `getExpertRegistry`**

In `api/src/services/persona.ts`, add after the `getPersonaBundle` function (~line 630):

```typescript
/**
 * Get all enabled personas as expert registry entries for workers.
 * Returns system personas + org-specific, with org overrides hiding system originals.
 */
export async function getExpertRegistry(orgId: string): Promise<Array<{
  slug: string;
  name: string;
  emoji: string | null;
  color: string | null;
  description: string | null;
  systemPrompt: string;
  specialties: string[];
  tools: string[];
  reviewOnly: boolean;
}>> {
  const personas = await listPersonas(orgId);
  const enabledPersonas = personas.filter((p) => p.enabled);

  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const STANDARD_TOOLS = [
    "Read", "Write", "Edit", "Glob", "Grep", "Bash",
    "post_context", "ask_siblings", "check_sibling_questions", "answer_sibling",
  ];

  const REVIEW_ONLY_SLUGS = new Set(["tech_lead", "manager"]);

  const entries = await Promise.all(
    enabledPersonas.map(async (persona) => {
      // Fetch active readme directive for system prompt
      const readmeDirective = await directiveRepo.findOne({
        where: { personaId: persona.id, type: "readme", isActive: true },
      });

      const systemPrompt = readmeDirective?.content
        || `You are a ${persona.name}. ${persona.description || ""}`;

      return {
        slug: persona.slug,
        name: persona.name,
        emoji: persona.emoji,
        color: persona.color,
        description: persona.description,
        systemPrompt,
        specialties: persona.skills || [],
        tools: STANDARD_TOOLS,
        reviewOnly: REVIEW_ONLY_SLUGS.has(persona.slug),
      };
    })
  );

  return entries;
}
```

**Step 2: Add API route**

In `api/src/routes/personas.ts`, after the `GET /worker/:slug/bundle` route (~line 819), add:

```typescript
/**
 * GET /api/personas/worker/experts
 * Get all enabled personas as expert configs for worker startup.
 * Uses API key authentication (for workers).
 */
router.get(
  "/worker/experts",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const experts = await personaService.getExpertRegistry(orgId);
      res.json({ experts });
    } catch (error) {
      logger.error("Error getting expert registry", { error });
      res.status(500).json({ error: "Failed to get expert registry" });
    }
  }
);
```

**IMPORTANT:** This route MUST be registered BEFORE the `/worker/:slug/bundle` route, otherwise Express will match `experts` as a `:slug` parameter. Move the new route above line 798.

**Step 3: Add import**

Add `getExpertRegistry` to the persona service imports at the top of `personas.ts`.

**Step 4: Typecheck**

Run: `cd api && npm run typecheck`
Expected: Pass

**Step 5: Smoke test**

Run: `curl -H "x-api-key: <test-key>" http://localhost:3001/api/personas/worker/experts | jq '.experts | length'`
Expected: Number matching enabled personas (14+)

**Step 6: Commit**

```bash
git add api/src/routes/personas.ts api/src/services/persona.ts
git commit -m "feat: add GET /api/personas/worker/experts endpoint for dynamic expert registry"
```

---

### Task 2: Worker Types — Make ExpertPersona Dynamic

**Files:**
- Modify: `worker/epic/types.ts:11-25`

**Step 1: Change `ExpertPersona` from union to string**

Replace the union type at lines 11-25 with:

```typescript
/**
 * Expert persona identifier — dynamically loaded from API.
 * System defaults: frontend_developer, backend_developer, security_engineer, etc.
 * Custom personas: any slug created in PersonaStudio.
 */
export type ExpertPersona = string;
```

**Step 2: Typecheck**

Run: `cd worker/epic && npx tsc --noEmit`
Expected: Pass (string is compatible everywhere ExpertPersona was used)

**Step 3: Commit**

```bash
git add worker/epic/types.ts
git commit -m "refactor: change ExpertPersona from union type to string for dynamic personas"
```

---

### Task 3: Worker Experts — Dynamic Registry with Fallback

**Files:**
- Modify: `worker/epic/experts.ts`

**Step 1: Rename and add registry**

At the top of the file (after imports, before `COORDINATION_INSTRUCTIONS`), add:

```typescript
import axios from "axios";
```

Rename `EXPERT_CONFIGS` (line 74) to `DEFAULT_EXPERT_CONFIGS`:

```typescript
export const DEFAULT_EXPERT_CONFIGS: Record<string, ExpertConfig> = {
```

Add the mutable registry after the defaults (~after the closing `}` of DEFAULT_EXPERT_CONFIGS, before `getExpertConfig`):

```typescript
/**
 * Runtime expert registry — populated from API at startup, falls back to defaults.
 */
let expertRegistry: Map<string, ExpertConfig> | null = null;

/**
 * Load expert configs from the API. Called once at coordinator startup.
 * Falls back to DEFAULT_EXPERT_CONFIGS on failure.
 */
export async function loadExpertRegistry(
  apiBaseUrl: string,
  apiKey: string,
): Promise<void> {
  try {
    const response = await axios.get(`${apiBaseUrl}/api/personas/worker/experts`, {
      headers: { "x-api-key": apiKey },
      timeout: 10000,
    });

    const entries = response.data.experts as Array<{
      slug: string;
      name: string;
      emoji: string | null;
      color: string | null;
      description: string | null;
      systemPrompt: string;
      specialties: string[];
      tools: string[];
      reviewOnly: boolean;
    }>;

    expertRegistry = new Map();
    for (const entry of entries) {
      expertRegistry.set(entry.slug, {
        persona: entry.slug,
        description: entry.description || entry.name,
        systemPrompt: entry.systemPrompt,
        specialties: entry.specialties,
        tools: entry.tools,
        model: "", // Set at runtime from EpicConfig
      });
    }

    // Track which are review-only
    const reviewOnlySlugs = entries.filter((e) => e.reviewOnly).map((e) => e.slug);
    REVIEW_ONLY_PERSONAS.clear();
    for (const slug of reviewOnlySlugs) {
      REVIEW_ONLY_PERSONAS.add(slug);
    }

    console.log(`[Epic] Expert registry loaded: ${expertRegistry.size} personas (${reviewOnlySlugs.length} review-only)`);
  } catch (err) {
    console.log(`[Epic] Failed to load expert registry, using defaults: ${(err as Error).message}`);
    expertRegistry = null; // Will fall back to defaults
  }
}

function getRegistry(): Record<string, ExpertConfig> | Map<string, ExpertConfig> {
  return expertRegistry || DEFAULT_EXPERT_CONFIGS;
}
```

**Step 2: Update `REVIEW_ONLY_PERSONAS` to be mutable**

Change line 685 from:
```typescript
const REVIEW_ONLY_PERSONAS: Set<ExpertPersona> = new Set(["tech_lead", "manager"]);
```
to:
```typescript
const REVIEW_ONLY_PERSONAS: Set<string> = new Set(["tech_lead", "manager"]);
```

**Step 3: Update `getExpertConfig` (line 678)**

```typescript
export function getExpertConfig(persona: string): ExpertConfig {
  const registry = getRegistry();
  if (registry instanceof Map) {
    return registry.get(persona) || DEFAULT_EXPERT_CONFIGS[persona];
  }
  return registry[persona];
}
```

**Step 4: Update `getAvailableExperts` (line 690)**

```typescript
export function getAvailableExperts(): string[] {
  const registry = getRegistry();
  if (registry instanceof Map) {
    return Array.from(registry.keys()).filter((p) => !REVIEW_ONLY_PERSONAS.has(p));
  }
  return Object.keys(registry).filter((p) => !REVIEW_ONLY_PERSONAS.has(p));
}
```

**Step 5: Update `findExpertForQuestion` (line 699)**

```typescript
export function findExpertForQuestion(
  questionContent: string,
  excludePersona?: string
): string | null {
  const content = questionContent.toLowerCase();
  const registry = getRegistry();
  const entries = registry instanceof Map
    ? Array.from(registry.entries())
    : Object.entries(registry);

  for (const [persona, config] of entries) {
    if (persona === excludePersona) continue;
    const matchesSpecialty = config.specialties.some(
      (specialty) => content.includes(specialty)
    );
    if (matchesSpecialty) {
      return persona;
    }
  }

  return null;
}
```

**Step 6: Update `matchPersonaToExpert` (line 722)**

```typescript
export function matchPersonaToExpert(persona: string): string | null {
  const normalized = persona.toLowerCase().replace(/[^a-z_]/g, "_");
  const registry = getRegistry();
  if (registry instanceof Map) {
    if (registry.has(normalized)) return normalized;
  } else {
    if (normalized in registry) return normalized;
  }
  return null;
}
```

**Step 7: Typecheck**

Run: `cd worker/epic && npx tsc --noEmit`
Expected: Pass

**Step 8: Commit**

```bash
git add worker/epic/experts.ts
git commit -m "feat: add dynamic expert registry with API loading and fallback defaults"
```

---

### Task 4: Coordinator — Load Registry at Startup

**Files:**
- Modify: `worker/epic/coordinator.ts`

**Step 1: Add import**

Add `loadExpertRegistry` to the import from `./experts.js` (line 19):

```typescript
import { getAvailableExperts, matchPersonaToExpert, loadExpertRegistry } from "./experts.js";
```

**Step 2: Call `loadExpertRegistry` before expert state init**

In `startMission()`, before the "Initialize expert states" block (line 200), add:

```typescript
    // Load dynamic expert registry from API
    await loadExpertRegistry(config.apiBaseUrl, config.orgApiKey);
```

**Step 3: Typecheck**

Run: `cd worker/epic && npx tsc --noEmit`
Expected: Pass

**Step 4: Commit**

```bash
git add worker/epic/coordinator.ts
git commit -m "feat: load expert registry from API at coordinator startup"
```

---

### Task 5: Planner — Dynamic Persona List in Planning Prompt

**Files:**
- Modify: `api/src/services/planning-agent-local.ts:778-793`
- Modify: `api/src/routes/remote-agent.ts:1013-1046`

**Step 1: Add `availablePersonas` param to `PlanningInput`**

In `api/src/services/planning-agent-local.ts`, find the `PlanningInput` interface and add:

```typescript
  availablePersonas?: Array<{
    slug: string;
    name: string;
    description: string | null;
    specialties: string[];
  }>;
```

**Step 2: Make the Available Personas section dynamic**

Replace lines 778-793 in `buildPlanningPrompt()` (the hardcoded persona list) with:

```typescript
## Available Personas

You MUST use one of these exact persona values for each story. Any other value will cause the story to fail:

${input.availablePersonas
  ? input.availablePersonas.map((p) =>
      `- \`${p.slug}\` — ${p.description || p.name}${p.specialties.length > 0 ? ` (${p.specialties.join(", ")})` : ""}`
    ).join("\n")
  : `- \`frontend_developer\` — React, CSS, UI components, browser APIs
- \`backend_developer\` — Server-side logic, APIs, databases, business logic
- \`api_developer\` — API design, REST/GraphQL endpoints, integrations
- \`devops_engineer\` — CI/CD, Docker, infrastructure, deployment, migrations
- \`security_engineer\` — Auth, encryption, vulnerability fixes, security audits
- \`qa_engineer\` — Tests, test infrastructure, E2E, integration tests
- \`database_administrator\` — Schema design, migrations, query optimization
- \`data_engineer\` — Data pipelines, ETL, data processing
- \`ml_engineer\` — Machine learning, model training, AI features
- \`mobile_developer_ios\` — iOS/Swift development
- \`mobile_developer_android\` — Android/Kotlin development`
}

Do NOT invent personas (e.g., "fullstack_developer" does not exist). For full-stack work, split into \`backend_developer\` and \`frontend_developer\` stories.
```

**Step 3: Pass personas from remote-agent.ts**

In `api/src/routes/remote-agent.ts`, in the `GET /planning-prompt` handler (~line 1013-1025), add persona fetching before `buildPlanningPrompt`:

```typescript
    // Fetch available personas for dynamic planner prompt
    const { getExpertRegistry } = await import("../services/persona.js");
    const experts = await getExpertRegistry(org.id);
    const availablePersonas = experts
      .filter((e) => !e.reviewOnly)
      .map((e) => ({
        slug: e.slug,
        name: e.name,
        description: e.description,
        specialties: e.specialties,
      }));
```

Then pass it to buildPlanningPrompt:

```typescript
    const planningInput: PlanningInput = {
      // ... existing fields ...
      availablePersonas,
    };
```

**Step 4: Typecheck**

Run: `cd api && npm run typecheck`
Expected: Pass

**Step 5: Commit**

```bash
git add api/src/services/planning-agent-local.ts api/src/routes/remote-agent.ts
git commit -m "feat: build planner persona list dynamically from database"
```

---

### Task 6: Missing Personas — Add support_agent and project_manager to Worker Defaults

**Files:**
- Modify: `worker/epic/experts.ts` (add entries to `DEFAULT_EXPERT_CONFIGS`)

**Step 1: Add `support_agent` config**

In `DEFAULT_EXPERT_CONFIGS`, after the `manager` entry, add:

```typescript
  support_agent: {
    persona: "support_agent",
    description: "Customer support specialist — triage, help desk, documentation",
    systemPrompt: `You are a support agent in a multi-expert collaboration.

Your specialties:
- Customer support workflows
- Help desk and triage systems
- User-facing documentation
- Error message clarity
- Support ticket automation

Collaboration Rules:
1. Check sibling decisions before starting
2. Post decisions for support workflow changes
3. Ask backend_developer about API error codes
4. Ask tech_writer about documentation standards

Work Style:
- Focus on user-facing clarity
- Prioritize actionable error messages
- Build self-service support features
- Document common issues and solutions
`,
    tools: [
      "Read", "Write", "Edit", "Glob", "Grep", "Bash",
      "post_context", "ask_siblings", "check_sibling_questions", "answer_sibling",
    ],
    model: "",
    specialties: ["support", "customer", "triage", "help", "ticket"],
  },

  project_manager: {
    persona: "project_manager",
    description: "Project management specialist — planning, coordination, agile",
    systemPrompt: `You are a project manager in a multi-expert collaboration.

Your specialties:
- Project planning and coordination
- Agile/Scrum practices
- Jira and project tracking
- Stakeholder communication
- Release planning

Collaboration Rules:
1. Check sibling decisions before starting
2. Post decisions for project structure changes
3. Coordinate between experts on dependencies
4. Track progress and blockers

Work Style:
- Focus on clear documentation and planning
- Create actionable project artifacts
- Maintain traceability between requirements and implementation
- Post progress updates for visibility
`,
    tools: [
      "Read", "Write", "Edit", "Glob", "Grep", "Bash",
      "post_context", "ask_siblings", "check_sibling_questions", "answer_sibling",
    ],
    model: "",
    specialties: ["planning", "jira", "agile", "coordination", "requirements"],
  },
```

**Step 2: Update `ExpertPersona` union comment**

The union is now `string` (Task 2), so no change needed. The defaults just need the new entries.

**Step 3: Typecheck**

Run: `cd worker/epic && npx tsc --noEmit`
Expected: Pass

**Step 4: Commit**

```bash
git add worker/epic/experts.ts
git commit -m "feat: add support_agent and project_manager to default expert configs"
```

---

### Task 7: Frontend — Shared Persona Metadata Hook

**Files:**
- Create: `frontend/src/hooks/usePersonas.ts`

**Step 1: Create the hook**

```typescript
import { useState, useEffect } from "react";
import axios from "axios";

interface PersonaMeta {
  slug: string;
  name: string;
  emoji: string | null;
  color: string | null;
  shortLabel: string | null;
}

// Hardcoded fallbacks for offline/loading state
const FALLBACK_PERSONAS: Record<string, PersonaMeta> = {
  frontend_developer: { slug: "frontend_developer", name: "Frontend Developer", emoji: "\u{1F3A8}", color: "#8B5CF6", shortLabel: "Frontend" },
  backend_developer: { slug: "backend_developer", name: "Backend Developer", emoji: "\u2699\uFE0F", color: "#3B82F6", shortLabel: "Backend" },
  devops_engineer: { slug: "devops_engineer", name: "DevOps Engineer", emoji: "\u{1F527}", color: "#F59E0B", shortLabel: "DevOps" },
  security_engineer: { slug: "security_engineer", name: "Security Engineer", emoji: "\u{1F512}", color: "#EF4444", shortLabel: "Security" },
  qa_engineer: { slug: "qa_engineer", name: "QA Engineer", emoji: "\u{1F9EA}", color: "#10B981", shortLabel: "QA" },
  tech_writer: { slug: "tech_writer", name: "Technical Writer", emoji: "\u{1F4DD}", color: "#6366F1", shortLabel: "Docs" },
  project_manager: { slug: "project_manager", name: "Project Manager", emoji: "\u{1F4CB}", color: "#EC4899", shortLabel: "PM" },
  api_developer: { slug: "api_developer", name: "API Developer", emoji: "\u{1F50C}", color: "#0EA5E9", shortLabel: "API" },
  database_administrator: { slug: "database_administrator", name: "Database Administrator", emoji: "\u{1F5C4}\uFE0F", color: "#8B5CF6", shortLabel: "DBA" },
  ml_engineer: { slug: "ml_engineer", name: "ML Engineer", emoji: "\u{1F9E0}", color: "#F97316", shortLabel: "ML" },
  data_engineer: { slug: "data_engineer", name: "Data Engineer", emoji: "\u{1F4CA}", color: "#14B8A6", shortLabel: "Data" },
  mobile_developer_ios: { slug: "mobile_developer_ios", name: "iOS Developer", emoji: "\u{1F4F1}", color: "#3B82F6", shortLabel: "iOS" },
  mobile_developer_android: { slug: "mobile_developer_android", name: "Android Developer", emoji: "\u{1F916}", color: "#22C55E", shortLabel: "Android" },
  tech_lead: { slug: "tech_lead", name: "Tech Lead", emoji: "\u{1F468}\u200D\u{1F4BC}", color: "#7C3AED", shortLabel: "Lead" },
  manager: { slug: "manager", name: "Manager", emoji: "\u{1F454}", color: "#6B7280", shortLabel: "Manager" },
  support_agent: { slug: "support_agent", name: "Support Agent", emoji: "\u{1F4AC}", color: "#06B6D4", shortLabel: "Support" },
};

let cachedPersonas: Record<string, PersonaMeta> | null = null;

/**
 * Hook to fetch persona metadata from API with fallback to hardcoded defaults.
 */
export function usePersonas(): Record<string, PersonaMeta> {
  const [personas, setPersonas] = useState<Record<string, PersonaMeta>>(
    cachedPersonas || FALLBACK_PERSONAS
  );

  useEffect(() => {
    if (cachedPersonas) return; // Already loaded

    axios
      .get("/api/personas")
      .then((res) => {
        const map: Record<string, PersonaMeta> = { ...FALLBACK_PERSONAS };
        for (const p of res.data) {
          map[p.slug] = {
            slug: p.slug,
            name: p.name,
            emoji: p.emoji || FALLBACK_PERSONAS[p.slug]?.emoji || null,
            color: p.color || FALLBACK_PERSONAS[p.slug]?.color || null,
            shortLabel: p.shortLabel || FALLBACK_PERSONAS[p.slug]?.shortLabel || null,
          };
        }
        cachedPersonas = map;
        setPersonas(map);
      })
      .catch(() => {
        // Silently use fallbacks
      });
  }, []);

  return personas;
}

/**
 * Static lookup helpers — use when hook is not available (non-component context).
 */
export function getPersonaEmoji(slug: string): string {
  return cachedPersonas?.[slug]?.emoji || FALLBACK_PERSONAS[slug]?.emoji || "";
}

export function getPersonaColor(slug: string): string {
  return cachedPersonas?.[slug]?.color || FALLBACK_PERSONAS[slug]?.color || "#6B7280";
}

export function getPersonaName(slug: string): string {
  return cachedPersonas?.[slug]?.name || FALLBACK_PERSONAS[slug]?.name || slug.replace(/_/g, " ");
}

export function getPersonaShortLabel(slug: string): string {
  return cachedPersonas?.[slug]?.shortLabel || FALLBACK_PERSONAS[slug]?.shortLabel || slug.replace(/_/g, " ");
}
```

**Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: Pass

**Step 3: Commit**

```bash
git add frontend/src/hooks/usePersonas.ts
git commit -m "feat: add usePersonas hook for dynamic persona metadata"
```

---

### Task 8: Frontend — Replace Hardcoded Persona Maps

**Files:**
- Modify: `frontend/src/components/LiveCodeViewer.tsx:78-93` (remove `PERSONA_EMOJIS`, use hook)
- Modify: `frontend/src/components/DependencyGraph.tsx:5-19` (remove `PERSONA_CONFIGS`, use hook)
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx` (pass persona map to LiveCodeViewer)

**Step 1: Update LiveCodeViewer**

In `LiveCodeViewer.tsx`, remove the `PERSONA_EMOJIS` constant (lines 78-93).

Add a new prop to `LiveCodeViewerProps`:

```typescript
interface LiveCodeViewerProps {
  files: Record<string, CodeFile>;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  personaEmojis: Record<string, string>; // slug → emoji
}
```

Update the component signature and replace all `PERSONA_EMOJIS[...]` references with `personaEmojis[...]`:

```typescript
export function LiveCodeViewer({
  files,
  selectedFile,
  onSelectFile,
  personaEmojis,
}: LiveCodeViewerProps) {
```

Replace line 148 (`PERSONA_EMOJIS[file.expert]`) with `personaEmojis[file.expert]`.
Replace line 203 (`PERSONA_EMOJIS[currentFile.expert]`) with `personaEmojis[currentFile.expert]`.
Replace line 242 (`PERSONA_EMOJIS[patch.expert]`) with `personaEmojis[patch.expert]`.

**Step 2: Update DependencyGraph**

In `DependencyGraph.tsx`, remove the `PERSONA_CONFIGS` constant (lines 5-19).

Add a `personaMap` prop:

```typescript
interface DependencyGraphProps {
  // ... existing props ...
  personaMap?: Record<string, { emoji: string; shortLabel: string }>;
}
```

Replace references to `PERSONA_CONFIGS[story.persona]` with `personaMap?.[story.persona]` (with same fallback logic).

**Step 3: Update MainDashboard**

In `MainDashboard.tsx`, import and use the hook:

```typescript
import { usePersonas } from "../hooks/usePersonas";
```

Inside the component:

```typescript
const personas = usePersonas();
```

Build an emoji map for LiveCodeViewer:

```typescript
const personaEmojis = Object.fromEntries(
  Object.entries(personas).map(([slug, meta]) => [slug, meta.emoji || ""])
);
```

Pass to LiveCodeViewer:

```tsx
<LiveCodeViewer
  files={codeFiles[task.id] || {}}
  selectedFile={selectedCodeFile[task.id] || null}
  onSelectFile={...}
  personaEmojis={personaEmojis}
/>
```

Pass persona map to DependencyGraph similarly (if used in MainDashboard).

**Step 4: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: Pass

**Step 5: Commit**

```bash
git add frontend/src/components/LiveCodeViewer.tsx frontend/src/components/DependencyGraph.tsx frontend/src/pages/Dashboard/MainDashboard.tsx
git commit -m "refactor: replace hardcoded persona maps with dynamic usePersonas hook"
```

---

### Task 9: Deploy and Verify

**Step 1: Typecheck all**

```bash
cd api && npm run typecheck
cd frontend && npx tsc -b
cd worker/epic && npx tsc --noEmit
```

**Step 2: Deploy API**

```bash
./deploy.sh --api
```

**Step 3: Deploy frontend**

```bash
./deploy.sh --frontend
```

**Step 4: Deploy worker**

```bash
./deploy.sh --worker
```

**Step 5: Build local worker image**

```bash
./bin/local-workermill build-worker
```

**Step 6: Verify expert registry endpoint**

```bash
curl -s -H "x-api-key: <key>" https://workermill.com/api/personas/worker/experts | jq '.experts | length'
```

Expected: 14+ personas returned

**Step 7: Commit final**

```bash
git add -A && git commit -m "chore: deploy dynamic expert registry"
```
