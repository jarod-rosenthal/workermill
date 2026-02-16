# Dynamic Expert Registry — Custom Personas Design

## Problem

The persona system has two disconnected layers:

1. **Database layer** (PersonaStudio) — 17 system personas + custom creation via API/UI
2. **Worker layer** (`worker/epic/experts.ts`) — hardcoded `ExpertPersona` union type + `EXPERT_CONFIGS` record

Custom personas created in PersonaStudio can never become worker experts because the worker uses hardcoded TypeScript types. Additionally, `support_agent` and `project_manager` exist in the database but are missing from the worker's expert list.

Frontend components (`LiveCodeViewer`, `BuildTerminal`, `DependencyGraph`) have hardcoded `PERSONA_EMOJIS` maps that won't include custom personas.

## Solution: Dynamic Expert Registry

Replace hardcoded expert configs with API-fetched configs at worker startup. All enabled personas (system + custom) become available as full first-class experts that the planner can assign stories to.

## Architecture

```
PersonaStudio UI → Database (Persona table)
                        ↓
            GET /api/personas/worker/experts (API key auth)
                        ↓
          ┌─────────────┼──────────────┐
          ↓             ↓              ↓
    Worker startup   Planner prompt  Frontend maps
    (ExpertConfig    (Available       (emoji/color
     registry)       Personas list)   lookups)
```

## Design Sections

### 1. API Endpoint — Expert Registry

New endpoint: `GET /api/personas/worker/experts`

- Auth: `authenticateApiKey` (same as other worker endpoints)
- Returns all enabled, non-review-only personas for the org
- Falls back to system personas if org has no customizations

Response shape:
```typescript
interface ExpertRegistryEntry {
  slug: string;           // "backend_developer" or "my_custom_persona"
  name: string;           // "Backend Developer"
  emoji: string | null;   // "⚙️"
  color: string | null;   // "#3B82F6"
  description: string;    // Short description for planner
  systemPrompt: string;   // Assembled from active readme directive
  specialties: string[];  // From persona.skills array
  tools: string[];        // Standard tool set
  reviewOnly: boolean;    // true for tech_lead, manager
}

// Response
{ experts: ExpertRegistryEntry[] }
```

The `systemPrompt` is built from the persona's active readme directive content. If no readme directive exists, a generic prompt is generated from the persona's name and description.

The `tools` array is the standard set: `["Read", "Write", "Edit", "Glob", "Grep", "Bash", "post_context", "ask_siblings", "check_sibling_questions", "answer_sibling"]`.

Location: Add to existing `api/src/routes/personas.ts` under the worker bundle section.

### 2. Worker Changes

**`worker/epic/types.ts`:**
- `ExpertPersona` type changes from union to `string`
- `ExpertConfig`, `ExpertState`, `ReadyStory` remain but use `string` for persona field

**`worker/epic/experts.ts`:**
- `EXPERT_CONFIGS` stays as fallback (renamed to `DEFAULT_EXPERT_CONFIGS`)
- New mutable `expertRegistry: Map<string, ExpertConfig>` loaded at startup
- New `loadExpertRegistry(apiBaseUrl, apiKey, orgId)` — fetches from API, populates registry
- `getAvailableExperts()` reads from registry (falls back to defaults)
- `matchPersonaToExpert()` looks up in registry (falls back to defaults)
- `getExpertConfig()` reads from registry

**`worker/epic/coordinator.ts`:**
- Call `loadExpertRegistry()` during `startMission()` before initializing expert states
- Expert states initialized from registry instead of hardcoded list

**Graceful degradation:** If API fetch fails, worker falls back to `DEFAULT_EXPERT_CONFIGS`. This ensures existing system personas always work even if the API is temporarily unreachable.

### 3. Planner Changes

**`api/src/services/planning-agent-local.ts` — `buildPlanningPrompt()`:**
- Add optional `availablePersonas: ExpertRegistryEntry[]` parameter
- Replace hardcoded "Available Personas" section with dynamic generation:
  - One bullet per enabled persona: `` `slug` — description (skills) ``
  - "Do NOT invent personas" instruction references the dynamic list
- If `availablePersonas` not provided, fall back to current hardcoded list

**`api/src/routes/remote-agent.ts` — `GET /planning-prompt`:**
- Query enabled personas from database for the org
- Pass to `buildPlanningPrompt()` as `availablePersonas`

### 4. Frontend Changes

**Shared persona metadata utility:**
- New `frontend/src/hooks/usePersonas.ts` — fetches `GET /api/personas` on mount, caches in Zustand or local state
- Exports `getPersonaEmoji(slug)`, `getPersonaColor(slug)`, `getPersonaName(slug)`
- Falls back to hardcoded defaults for offline/loading state

**Replace hardcoded maps in:**
- `frontend/src/components/LiveCodeViewer.tsx` — `PERSONA_EMOJIS`
- `frontend/src/components/BuildTerminal.tsx` — `PERSONA_EMOJIS`
- `frontend/src/components/DependencyGraph.tsx` — `PERSONA_EMOJIS`

### 5. Missing Personas Fix

Add to `DEFAULT_EXPERT_CONFIGS` (fallback):
- `support_agent` — customer support, triage, help desk
- `project_manager` — planning, coordination, agile (alias for existing `manager` behavior but as a separate expert)

Update `matchPersonaToExpert()` fallback to handle `project_manager` → maps to `project_manager` config.

Also add both to the database seed if not already present (`support_agent` exists in seed but `project_manager` may be mapped differently from `manager`).

## Data Flow

### Custom Persona Creation → Worker Usage

1. User creates persona in PersonaStudio (name, slug, emoji, skills, description)
2. User writes a readme directive (the system prompt content)
3. User enables the persona (`enabled: true`)
4. Next task: planner fetches available personas → sees custom persona in list → can assign stories to it
5. Worker startup: fetches expert registry → custom persona in registry → expert state initialized
6. Coordinator matches story persona to expert → custom persona matched → story executes

### Planner Discovery

The planner automatically sees all enabled personas because the planning prompt is built dynamically from the database. No manual configuration needed per task.

## Non-Goals

- No per-task persona selection UI (auto-discover handles this)
- No custom tool sets per persona (all experts get the same tools)
- No persona marketplace or sharing between orgs
