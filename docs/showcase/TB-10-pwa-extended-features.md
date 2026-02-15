# TB-10: PWA & Extended Features

> **TeamBoard Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/teamboard`](https://github.com/workermill-examples/teamboard)
> Live: [teamboard.workermill.com](https://teamboard.workermill.com)

---

## Epic Overview

Transform TeamBoard into a Progressive Web App with offline support, mobile-native UX, card comments and checklists, board filtering/search, keyboard shortcuts, and comprehensive tests. This epic adds the polish and power-user features that make TeamBoard feel like a native application.

**Deliverables:**

1. PWA foundation (manifest, service worker, icons)
2. Offline infrastructure (IndexedDB, sync manager, offline UI)
3. Mobile-native UX (bottom nav, bottom sheet, gestures)
4. Schema changes for comments and checklists
5. Card enhancement APIs and UI
6. Board filtering, search, WIP limits, and templates
7. Keyboard shortcuts and workspace features
8. Comprehensive unit tests

**Pre-execution refinement:** Ticket was updated based on TB-8 analysis — replaced PNG icons with SVG (AI workers can't create binary files), moved CardDetail modification to same story as its dependencies, removed impossible verification steps (Lighthouse, network disconnect tests), added per-work-group typecheck gates.

---

## Execution Summary

| Metric | Value |
|--------|-------|
| **Executed** | February 15, 2026 |
| **Duration** | ~58 minutes (06:18 - 07:16 UTC) |
| **Stories** | 8 work groups |
| **Personas** | `frontend_developer`, `backend_developer`, `database_administrator`, `qa_engineer` |
| **Tech Lead Review** | Escalated for human review (1 remaining TS error) |
| **Revision Cycles** | 1 (missing @heroicons/react dependency, 60 TS errors) |
| **Pull Request** | [#66](https://github.com/workermill-examples/teamboard/pull/66) |

---

## Worker Stories

### Work Group 1: PWA Foundation — Manifest, Service Worker, Icons
**Persona:** `frontend_developer` | **Completed:** 06:19 UTC (initial), 06:24 UTC (post-review)

Progressive Web App infrastructure:
- **`public/manifest.json`** — PWA metadata, theme color (#3B82F6), standalone display, icon references
- **`public/sw.js`** — Service worker with tiered cache strategies:
  - App shell: cache-first with deploy-triggered revalidation
  - API responses: network-first with 5-minute fallback cache
  - Board detail: stale-while-revalidate with 1-minute freshness
  - Static assets: cache-first with 30-day expiration
- **`public/icons/icon-192.svg`** and **`icon-512.svg`** — SVG icons with "TB" branding in blue theme
- **`src/lib/pwa-icons.ts`** — Programmatic icon generator script
- **Updated `layout.tsx`** — Manifest link, Apple Web App meta tags, theme color, service worker registration

**Post-review fix:** Resolved immutable Response headers bug — created new Response objects with modified headers instead of trying to mutate existing ones.

---

### Work Group 2: Offline Infrastructure — IndexedDB, Sync Manager, Offline UI
**Persona:** `frontend_developer` | **Completed:** 06:30 UTC

Offline-first architecture:
- **`offline-store.ts`** — IndexedDB wrapper for:
  - Queuing card moves while offline (with original state for conflict resolution)
  - Caching board data for offline access
  - Tracking offline activities with cleanup
  - Singleton pattern for consistent access
- **`sync-manager.ts`** — Comprehensive synchronization:
  - Batch processing to avoid server overload
  - Conflict detection with detailed error categorization
  - Permanent vs. retryable failure distinction
  - Progress callbacks and abort functionality
  - Full sync and board-specific sync modes
- **`OfflineBanner.tsx`** — Shows offline/online states with smooth transitions, auto-hide after reconnection, ARIA labels
- **`SyncBadge.tsx`** — Pending sync count with status indicators (idle, syncing, error), multiple sizes
- **`useOfflineSync.ts`** — React hook providing complete offline/online management, auto-sync with configurable intervals

---

### Work Group 3: Mobile-Native UX — Bottom Nav, Bottom Sheet, Gestures
**Persona:** `frontend_developer` | **Completed:** 06:36 UTC

Native mobile experience:
- **`BottomNav.tsx`** — 4-tab mobile navigation (Workspaces, Boards, Activity, Profile). 44px+ touch targets. Active/inactive states. Workspace-aware routing. Only visible on screens < 768px.
- **`BottomSheet.tsx`** — Replaces modals on mobile with drag-to-dismiss gesture. iOS safe area handling. Desktop modal fallback above 768px.
- **`usePullToRefresh.ts`** — Pull-to-refresh gesture hook with configurable threshold, resistance, and progress tracking
- **`useLongPress.ts`** — Long-press gesture for initiating card drag on touch devices. Movement cancellation and configurable timing.
- **Updated workspace layout** — BottomNav integration, bottom padding, iOS safe area CSS classes
- **Updated `tailwind.config.ts`** — iOS safe area utilities using `env(safe-area-inset-*)` CSS variables

---

### Work Group 4a: Schema Changes — Comment and ChecklistItem Models
**Persona:** `database_administrator` | **Completed:** 06:18 UTC

Database schema extensions:
- **Comment model** — id (cuid), cardId (FK), userId (FK), content (Text), createdAt. Cascade delete when card is removed.
- **ChecklistItem model** — id (cuid), cardId (FK), title, checked (default false), position (default 0), createdAt. Cascade delete when card is removed.
- **Card relations** — Added `comments Comment[]` and `checklist ChecklistItem[]`
- **User relation** — Added `comments Comment[]`
- Verified: `npx prisma generate` succeeds, `npm run typecheck` passes with 0 errors

---

### Work Group 4b: Card Enhancement APIs — Comments and Checklist Routes
**Persona:** `backend_developer` | **Completed:** 06:21 UTC

New API endpoints:
- **`GET/POST /api/cards/[id]/comments`** — List and create comments. Authentication required. MEMBER+ for writes. Comments limited to 2,000 characters. Returned in descending chronological order.
- **`GET/POST/PUT /api/cards/[id]/checklist`** — List, create, and toggle checklist items. PUT toggles completion via `itemId` query parameter. Automatic position assignment. Items returned in position order.

Activity tracking:
- `card.comment_added` on new comment
- `card.checklist_item_added` on new item
- `card.checklist_item_completed` / `card.checklist_item_uncompleted` on toggle

All routes follow Next.js 15 async params pattern with proper Zod validation.

---

### Work Group 4c: Card Comments, Checklist UI + CardDetail Modification
**Persona:** `frontend_developer` | **Completed:** 06:43 UTC

Rich card interactions:
- **CardComments.tsx** — Comment list with avatars and timestamps, add form with validation, real-time updates, keyboard shortcut (Cmd/Ctrl+Enter to submit), loading and empty states
- **CardChecklist.tsx** — Checkbox list with progress tracking, progress bar with color coding (gray → blue → green), completion percentage, per-item loading states
- **Enhanced CardDetail.tsx** — Tabbed interface (Details, Comments, Checklist), due date warning banner for overdue cards, cover image URL field, preserved all existing functionality

---

### Work Group 5: Board Filtering + Search — Filter Bar, WIP Limits, Templates
**Persona:** `frontend_developer` | **Completed:** 06:50 UTC (initial), 07:01 UTC (post-review)

Power-user board features:
- **BoardFilter.tsx** — Dropdown filters for assignee (with avatars), priority (color-coded badges), labels (with colors), due date (overdue/today/this week/next week/no date). Clear all filters. Active filter count.
- **BoardSearch.tsx** — Real-time search by card title and description. Keyboard shortcuts (Ctrl/Cmd+K, /, Escape). Clear search. Results indicator.
- **WipLimit.tsx** — Progress bar with color coding, warning indicators when approaching/exceeding limits, configuration component, recommended limits by column type
- **BoardTemplates.tsx** — 3 presets (Kanban, Scrum Sprint, Bug Tracking) with pre-configured columns and WIP limits. Sample cards. Blank board option.
- **Updated board page** — Filter bar and search integration above the board, client-side filtering logic, filtered results counter

**Post-review fix:** Integrated WipLimit component directly into Column component header — added progress bars and warnings showing card count vs. limit.

---

### Work Group 6: Keyboard Shortcuts + Workspace Features
**Persona:** `frontend_developer` | **Completed:** 06:56 UTC

Productivity shortcuts and workspace tools:
- **`useKeyboardShortcuts.ts`** — Global keyboard handler:
  - **N** — Create new card
  - **E** — Edit selected card
  - **Delete/Backspace** — Delete with confirmation
  - **Esc** — Close modal/overlay
  - **Arrow keys** — Navigate between cards
  - **/** — Focus search
  - **F** — Focus filters
  - **?** — Show shortcuts help
  - Smart input detection (disabled when typing in inputs/textareas except Esc)
- **WorkspaceSearch.tsx** — Cross-board search with debounced queries (300ms), recent searches in localStorage, keyboard navigation, Ctrl/Cmd+K trigger, rich results with board/column context
- **StarredBoards.tsx** — Star/unstar boards with localStorage persistence per workspace+user, starred boards pinned at top of sidebar

---

### Work Group 7: Tests
**Persona:** `qa_engineer` | **Completed:** 07:14 UTC

Comprehensive unit test coverage:
- **useKeyboardShortcuts** — 37 tests covering shortcuts, input detection, modifier handling, edge cases
- **usePullToRefresh** — 18 tests covering touch gestures, thresholds, refresh triggers, error handling
- **useLongPress** — 25 tests covering both hook variants, touch/mouse events, movement detection, cleanup
- **Comments API** — Tests for GET/POST operations, authentication, permissions, validation, errors
- **Checklist API** — Tests for GET/POST/PUT, item toggling, position management, edge cases
- **offline-store** — 28 tests covering IndexedDB operations, data management, error handling, cleanup
- **sync-manager** — Tests for sync operations, conflict resolution, batching, error recovery

---

## Tech Lead Review

### Revision 1

Key feedback:
- **Missing `@heroicons/react` dependency** — caused build failures in 6 components
- **60 TypeScript errors** — test response type assertions, implicit `any` types, property mismatches, `StarredBoards` field reference (`updatedAt` → `createdAt`), `useRef` initialization
- WipLimit component created but not integrated into Column component

**Fixes applied:**
- Installed `@heroicons/react` dependency
- Fixed all 60 TypeScript errors across components, hooks, and test files
- WipLimit integrated into `Column.tsx` header with progress bars and warnings
- Fixed `StarredBoards` field reference and `useRef` initialization
- ESLint passes with 0 errors

### Final Status — Escalated for Human Review

> Epic escalated: one remaining TypeScript error in `PullIndicator` component / `usePullToRefresh` hook. Build otherwise compiles successfully. PR created for human intervention.

PR: [#66](https://github.com/workermill-examples/teamboard/pull/66)

---

## Result

All 8 work groups completed with 1 remaining TypeScript error escalated to human review. The TB-10 epic added substantial feature depth to TeamBoard:

**New capabilities:**
- Installable PWA with service worker caching
- Full offline support with IndexedDB queueing and sync
- Mobile-native bottom navigation and gestures
- Card comments and checklists with real-time UI
- Board filtering by assignee, priority, label, and due date
- Full-text search across cards
- WIP limits with visual indicators
- Board templates (Kanban, Scrum, Bug Tracking)
- 10+ keyboard shortcuts
- Workspace-wide search
- Starred/pinned boards

**New files:** ~20 components, hooks, and utilities
**New tests:** 100+ unit tests across hooks, API routes, and utilities
**New API routes:** Comments and checklist CRUD

**Quality gates:**
- TypeScript: 1 remaining error (PullIndicator/usePullToRefresh) — escalated
- ESLint: passes
- Build: compiles successfully
