# FlagDeck Spec Retrospective — Preventable Failures Analysis

**Date:** 2026-02-28
**Build:** FlagDeck Full Build (board `e884167d-6d0b-489a-a926-d6e4f4a3e23d`)
**Target repo:** `workermill-examples/flagdeck` (GitHub)
**Total cards:** 12 (11 completed + 1 executing)
**Total PRs:** 11 merged

---

## 1. Executive Summary

- **Svelte 5 testing was the #1 preventable failure.** The PRD specified `@testing-library/svelte` and Vitest but said nothing about Svelte 5 SSR vs client-side rendering configuration. Card 11 burned 4 revisions fighting `mount(...) is not available on the server` — a well-known Svelte 5 + Vitest issue that required a specific `vite.config.ts` resolution alias.
- **Cross-card interface contracts were undefined.** Card 6 (API Handlers) failed quality gates because the `environments.go` handler called `h.auditService.LogAction()` with positional args instead of the `AuditEntryInput` struct defined in Card 5 (Auth). The PRD never specified the `AuditService` interface signature.
- **The deploy workflow hallucinated a `--environment production` flag.** Card 2 added `railway up --service flagdeck-api --environment production --detach` even though the PRD spec explicitly showed `railway up --service flagdeck-api --detach`. This was caught by tech lead review and fixed in 1 revision.
- **TypeScript strictness and linting standards were implied, not specified.** Cards 8 and 11 both had revisions caused by `any` types, unused imports, and implicit parameter types — issues that a spec-level `strict: true` requirement and lint rule list would have prevented.
- **No Svelte 5 component prop contract existed.** Card 11 tests used a non-existent `onValueChange` prop on `RolloutSlider` because no component interface was specified in the PRD. Workers guessed the API.

---

## 2. Card-by-Card Failure Analysis

### Card 2: CI/CD Pipeline & Quality Gates (1 revision)

**What went wrong:**
The devops_engineer added `--environment production` to both Railway deploy commands (`railway up --service flagdeck-api --environment production --detach`). The tech lead caught this during inline review and requested a revision. The worker removed the flags and was approved on revision 1.

**What the spec said:**
The PRD explicitly included the exact deploy commands (lines 1468-1487):
```yaml
run: railway up --service flagdeck-api --detach
run: railway up --service flagdeck-web --detach
```
And had a warning: "Railway service names are EXACT."

**What the spec SHOULD have said:**
The spec was actually correct here — the commands were explicit and complete. The worker hallucinated an extra flag despite the spec saying the exact command. This is a **worker compliance issue**, not a spec gap. However, the spec could have added:

> **Do NOT add flags not shown here.** The Railway commands are exact — use only the flags specified. Adding `--environment`, `--build`, or other flags will cause deployment failures.

**Verdict:** Minor spec gap. The spec had the right commands but could have been more explicit about "nothing else."

---

### Card 6: API Handlers & Router (0 revisions on DB, but quality gate failures during execution)

**What went wrong:**
During execution, the `backend_developer` expert writing `environments.go` called `h.auditService.LogAction()` with 9 positional arguments:
```go
have (context.Context, string, string, models.AuditAction, string, string, map[string]interface{}, string, string)
want (context.Context, services.AuditEntryInput)
```
The `AuditService` interface was defined in Card 5 (Auth) with a struct-based `AuditEntryInput` parameter, but Card 6's worker assumed a different signature with positional arguments. This caused `go vet` failures that the worker had to fix within the execution loop.

A separate `qa_engineer` expert also had repeated `go test` failures while writing handler tests — 3 consecutive quality gate failures for the same test compilation errors (Flag handler tests).

**What the spec said:**
The PRD defined the `AuditService` interface at a high level ("audit logging for all mutations") but never specified the function signature. The Go test model construction section (lines 1280-1287) warned about struct field mismatches but only for domain models, not service interfaces.

**What the spec SHOULD have said:**
```
### Service Interface Contracts

The following interfaces MUST be consistent across all cards:

**AuditService** (defined in Card 5, consumed by Cards 6+):
```go
type AuditEntryInput struct {
    UserID     string
    EntityType string
    Action     models.AuditAction
    EntityID   string
    EntityName string
    Details    map[string]interface{}
    OrgID      string
    IP         string
}

func (s *AuditService) LogAction(ctx context.Context, input AuditEntryInput) error
```

Card 6 MUST use the struct-based signature, NOT positional arguments.
```

---

### Card 8: Frontend Feature Pages — Flags, Segments & Environments (1 revision)

**What went wrong:**
The tech lead requested a revision for three issues:
1. **30 TypeScript errors** — type mismatches, implicit `any` types, incorrect error handling
2. **7 ESLint violations** — improper `any` usage, unused variables
3. **Incorrect Svelte 5 syntax** — using `onsubmit|preventDefault` (Svelte 4 syntax) instead of `onsubmit` with manual `preventDefault()` (Svelte 5 syntax)

The worker also used `any` types for sort handler parameters in the Environments page (`handleSort` function).

**What the spec said:**
The PRD specified the frontend quality gate (`npm run lint`, `npm run check`, `npm run build`) but never set TypeScript strictness rules or eslint configuration expectations. The spec also didn't mention Svelte 5's breaking changes for event modifiers.

**What the spec SHOULD have said:**
```
### TypeScript & Linting Standards (ALL frontend cards)

- `tsconfig.json` MUST use `"strict": true`
- ESLint MUST be configured with `@typescript-eslint/no-explicit-any: "error"`
- NEVER use `any` type — use proper types, `unknown`, or generics
- Svelte 5 event syntax: Use `onsubmit={handler}` (NOT `onsubmit|preventDefault`)
  - Event modifiers like `|preventDefault` were removed in Svelte 5
  - Use `e.preventDefault()` inside the handler function
```

---

### Card 11: Frontend Tests — Component & Page Testing (4 revisions — worst performer)

**What went wrong — revision by revision:**

**Initial submission → Revision 1 requested:**
- Tests failing with `mount(...) is not available on the server` — Vitest was loading Svelte SSR modules instead of client modules
- 402 TypeScript errors (missing `@testing-library/jest-dom` type declarations in `app.d.ts`)
- 35 ESLint violations (unused imports, `any` types)
- The `qa_engineer` expert identified this as a "Svelte 5 + @testing-library/svelte compatibility issue" and spent ~10 minutes trying different configurations before giving up
- Affected stories: 2, 3, 4

**Revision 1 → Revision 2 requested:**
- Svelte 5 SSR config fixed in `vite.config.ts` (added `resolve.conditions: ['browser']`)
- Jest-DOM type declarations added
- Test execution improved but still had failures: TypeScript errors in `components.test.ts` (using non-existent `onValueChange` prop on RolloutSlider), unused imports, query selector issues
- Code quality score: 7 → 7

**Revision 2 → Revision 3 requested:**
- Progress made but "specific issues identified in the last review remain completely unaddressed"
- Still using `onValueChange` prop on RolloutSlider tests (lines 418, 434 of `components.test.ts`)
- Still had unused imports (`vi`, `page`, `get`, `createMockFlag`, `mockAuthStore`)
- Test query selectors finding multiple elements when expecting one
- Code quality score dropped: 7 → 6

**Revision 3 → Revision 4 (finally approved):**
- Removed non-existent `onValueChange` prop from RolloutSlider tests
- Fixed all linting violations
- TypeScript and ESLint: 0 errors
- Still 17 failing tests (query selector issues) but tech lead accepted these as "normal test implementation challenges rather than revision blockers"
- Code quality score: 6 → 8

**What the spec said:**
The PRD had a "SvelteKit Frontend Tests" section (lines 1289-1310) that specified:
- Vitest + `@testing-library/svelte` for component mounting
- Test files and what they should test
- "CRITICAL — Real Component Tests Required" with `render()` mandate
- Mock data field name requirements

But it **did NOT** specify:
- How to configure Vitest for Svelte 5 client-side rendering
- The component prop interfaces (e.g., RolloutSlider's actual props)
- ESLint/TypeScript configuration for test files
- That `@testing-library/jest-dom` types need to be declared in `app.d.ts`

**What the spec SHOULD have said:**
```
### Svelte 5 Test Configuration (CRITICAL — DO THIS FIRST)

Svelte 5 components use runes ($state, $props, $derived) which are client-only.
Vitest defaults to SSR module resolution, causing "mount(...) is not available on
the server" errors. You MUST configure the test environment:

In `vite.config.ts`:
```ts
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // CRITICAL: Force client-side module resolution for Svelte 5
    server: {
      deps: {
        inline: [/svelte/]
      }
    }
  },
  resolve: {
    conditions: ['browser']  // Force browser (client) modules, NOT server
  }
});
```

In `src/app.d.ts`, add:
```ts
import '@testing-library/jest-dom';
```

### Component Prop Interfaces (MUST match implementation)

Tests MUST only use props that exist on the component. These are the actual
prop interfaces:

**RolloutSlider**: `{ value: number, disabled?: boolean, label?: string, showPercentage?: boolean }`
  - Does NOT have an `onValueChange` prop — do not test for one

**FlagCard**: `{ flag: Flag }`

**TargetingRuleBuilder**: `{ rules: TargetingRule[], onUpdate: (rules) => void }`
```

---

## 3. Cross-Story Integration Issues

### Card 5 → Card 6: AuditService Interface Mismatch

Card 5 (Auth) defined `AuditService.LogAction(ctx, AuditEntryInput)` with a struct parameter. Card 6 (API Handlers) called it with 9 positional arguments. This caused compilation failures in `environments.go` lines 232 and 334.

**Root cause:** The PRD never specified the `AuditService` interface signature. Both cards were assigned to different experts who independently invented incompatible function signatures.

**Prevention pattern:** Define shared service interfaces in a "Shared Types & Interfaces" card (or in Card 1 as a types-only file), listing every function signature that will be consumed by multiple cards.

### Card 7/8 → Card 11: Component Prop Interface Unknown

Card 11 (Frontend Tests) tested `RolloutSlider` with a non-existent `onValueChange` prop because the component was built in Card 8 without a published interface contract. The test writer guessed the prop name.

**Root cause:** The PRD specified components and their visual behavior but not their TypeScript prop interfaces.

**Prevention pattern:** Each component card's deliverables should include the exact prop type (or at minimum, the prop names). Test cards should reference these.

### Card 7 → Cards 8/11: Svelte 5 vs Svelte 4 Syntax Inconsistency

The planner identified that `RolloutSlider.svelte` used Svelte 4 syntax (`export let`, `$:`) while other components used Svelte 5 runes (`$state`, `$props`, `$derived`). This inconsistency caused confusion in test writing — tests had to "handle both patterns."

**Root cause:** The PRD didn't mandate a single Svelte syntax style. Individual workers chose different patterns.

**Prevention pattern:** Add a global constraint: "ALL Svelte components MUST use Svelte 5 runes syntax. Do NOT use `export let` or `$:` — use `$props()`, `$state()`, and `$derived()` exclusively."

---

## 4. Card 11 Deep Dive

Card 11 had 4 revisions over ~2.5 hours (17:36 → 20:37 UTC). Here's the timeline:

| Time | Event | Issue |
|------|-------|-------|
| 17:36 | Planning starts | Planner notes Svelte 5 + testing-library compatibility risks |
| 17:47 | Story 0 (test utilities) approved | Clean pass — no component rendering needed |
| 17:53 | qa_engineer hits SSR error | `mount(...) is not available on the server` |
| 17:55 | qa_engineer gives up | Posts "compatibility issue" learning note |
| 17:58 | Stories 1, 2 approved | Tech lead approves despite SSR issue (pure mock tests work) |
| 18:08 | **Revision 1 requested** | SSR config, 402 TS errors, 35 lint violations |
| 18:17-18:50 | Workers fix SSR, lint, types | Added `resolve.conditions: ['browser']` |
| 18:51 | **Revision 2 requested** | Still: `onValueChange` prop, unused imports, query selectors |
| 18:57-19:37 | Workers attempt fixes | Progress but specific issues "remain unaddressed" |
| 19:37 | **Revision 3 requested** | Same `onValueChange`, same unused imports |
| 20:15 | **Revision 4 requested** | "NOT addressed issues from previous review" — score drops to 6 |
| 20:37 | **Finally approved** | `onValueChange` removed, lint clean, 17 test failures accepted |

**The same issue persisted across 3 revisions:** The `onValueChange` prop on `RolloutSlider` appeared in revisions 1, 2, and 3. The worker kept reintroducing it because:
1. No prop interface was specified in the PRD
2. The expert assumed a standard callback prop pattern
3. Each revision involved multiple experts (frontend_developer + qa_engineer), and the one writing `components.test.ts` kept using the same assumption

**The SSR configuration issue was novel but solvable:** This is a well-documented Svelte 5 + Vitest issue. A spec-level configuration snippet would have prevented the initial 30+ minutes of debugging and the first revision entirely.

**Unused imports persisted because of multi-expert editing:** Two experts (frontend_developer and qa_engineer) worked on overlapping test files. One expert's imports became stale when the other rewrote sections. The tech lead kept flagging the same files.

---

## 5. PRD Template Recommendations

### Addition 1: Shared Interface Contracts Section

Add to the decomposer system prompt, after the "Card Description Format" section:

```
## Shared Interface Contracts (CRITICAL)

When multiple cards produce and consume the same interfaces (service methods, component
props, API response shapes, database query signatures), the PRD MUST define these
contracts explicitly in a "Shared Contracts" section BEFORE the card breakdown.

For each shared interface, specify:
- The exact function/method signature (language-specific)
- Which card DEFINES it (producer)
- Which cards CONSUME it

Example:
```
AuditService.LogAction:
  Signature: LogAction(ctx context.Context, input AuditEntryInput) error
  Defined by: Card 5 (Auth)
  Consumed by: Cards 6, 7 (Handlers)

AuditEntryInput struct:
  UserID string, EntityType string, Action AuditAction, EntityID string, ...
```

Without explicit contracts, independent AI workers will invent incompatible signatures
and waste revision cycles on compilation errors.
```

### Addition 2: Framework-Specific Test Configuration

Add to the decomposer system prompt, in the CI/CD section:

```
## Test Environment Configuration

When the PRD specifies a testing stack, the decomposer MUST include framework-specific
configuration requirements in the test card's description. Common gotchas:

- **Svelte 5 + Vitest**: Requires `resolve.conditions: ['browser']` in vite.config.ts
  to prevent SSR module loading. Without this, component tests fail with "mount(...)
  is not available on the server."
- **React + Jest**: Requires `testEnvironment: 'jsdom'` and proper transform config.
- **Go + mtest**: Requires `go.mongodb.org/mongo-driver/mongo/integration/mtest` import.

The test card description MUST include a "Test Setup" section with the exact
configuration needed BEFORE any test files are written.
```

### Addition 3: Component Prop Interface Requirement

Add to the decomposer system prompt, in the Card Description Format:

```
### Component Prop Interfaces (Frontend cards)

If a card creates UI components that will be tested or consumed by other cards,
the card description MUST include the TypeScript interface for each component's props.

Example:
```ts
// RolloutSlider props
interface RolloutSliderProps {
  value: number;
  disabled?: boolean;
  label?: string;
  showPercentage?: boolean;
}
```

Test cards MUST reference these interfaces — do NOT guess prop names.
```

### Addition 4: Strict Linting Enforcement

Add to the decomposer system prompt, in the quality gates section:

```
## Lint Rules (ALL cards)

The PRD MUST specify:
1. Whether TypeScript strict mode is enabled
2. Whether `any` type is forbidden (it should be)
3. Whether unused imports/variables trigger errors (they should)

If the PRD doesn't specify, default to STRICT:
- `"strict": true` in tsconfig.json
- `@typescript-eslint/no-explicit-any: "error"`
- `@typescript-eslint/no-unused-vars: "error"`

Workers MUST run `npm run lint` after EVERY file creation and fix all violations
before moving to the next file.
```

### Addition 5: Deploy Command Exactness

Add to the decomposer system prompt:

```
## Deployment Commands

When the PRD specifies exact deployment commands, the CI/CD card description MUST
include a warning:

> EXACT COMMANDS ONLY: Use the deployment commands EXACTLY as specified in the PRD.
> Do NOT add flags, environment specifiers, or configuration that isn't in the spec.
> If a command says `railway up --service X --detach`, use exactly that — not
> `railway up --service X --environment production --detach`.
```

---

## 6. Spec Checklist

Reusable checklist for future PRD specs. Each item addresses a class of failure observed in the FlagDeck build.

### Before Writing Cards

- [ ] **Shared interfaces defined** — Every function/method/component consumed by multiple cards has an explicit signature in the PRD (not just "uses AuditService")
- [ ] **Component prop interfaces listed** — Every reusable UI component has its TypeScript props defined in the PRD
- [ ] **Framework version pinned** — Major framework versions (Svelte 5 vs 4, React 18 vs 19, Go 1.22 vs 1.21) are explicit, with migration notes for breaking changes
- [ ] **Test environment configuration included** — Framework-specific test setup (Vitest SSR config, Jest transforms, etc.) is specified as a prerequisite, not left to workers
- [ ] **TypeScript/lint strictness rules defined** — `strict: true`, `no-explicit-any`, unused variable rules are explicit
- [ ] **Deployment commands are exact and annotated** — "Use ONLY these flags" warnings on every deployment command

### Per-Card Checks

- [ ] **Scope boundaries reference specific interfaces** — "Builds on Card 5's `AuditService` interface" with the function signature, not just "builds on Card 5"
- [ ] **Test cards list the exact prop interfaces** of components they'll test
- [ ] **Quality gate commands are verified runnable** — `npm run test` requires at least one test file; `go test ./...` requires at least one `_test.go` file
- [ ] **No implicit dependencies** — If Card N reads files created by Card M, Card M is in Card N's dependency list
- [ ] **Framework syntax mandated** — "Use Svelte 5 runes ONLY" or "Use React hooks ONLY" — no ambiguity

### Integration Prevention

- [ ] **API contracts have request/response schemas** — Not just endpoint paths, but the JSON shape for every request body and response
- [ ] **Database model struct definitions are complete** — Every field name, type, and JSON tag
- [ ] **Service method signatures specified** — Not "provides audit logging" but `LogAction(ctx, AuditEntryInput) error`
- [ ] **Single syntax standard enforced** — No mixing Svelte 4/5 syntax, no mixing CommonJS/ESM, no mixing callback/Promise styles
