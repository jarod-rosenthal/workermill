# WorkerMill Mobile App — Product Requirements Document

## Product Overview

Build a React Native mobile app (iOS + Android) that serves as a monitoring and control plane for WorkerMill's AI coding agents. Users can monitor active tasks, manage Kanban boards, receive push notifications for critical events, and take action — all from their phone.

**The mobile app does NOT run AI agents.** It is a thin client over the existing WorkerMill REST + SSE API at `https://api.workermill.com`. No new business logic is needed on the server beyond push notification registration and delivery.

**Target repository:** `workermill/workermill` (this monorepo)
**App location:** `mobile/` (top-level, parallel to `frontend/`, `api/`, `agent/`)
**Framework:** Expo SDK 52, managed workflow
**Platforms:** Android first (iOS added later when Apple Developer account is available)

---

## Tech Stack

| Category | Library | Purpose |
|----------|---------|---------|
| Framework | `expo` (SDK 52) | Managed workflow, OTA updates, native builds |
| Navigation | `expo-router` | File-based routing with deep linking |
| State management | `zustand` | Same patterns as web frontend (`frontend/src/store/`) |
| HTTP client | `axios` | API calls with interceptor pattern (auth, refresh, error handling) |
| SSE | `react-native-sse` | EventSource polyfill for real-time streaming |
| Token storage | `expo-secure-store` | Encrypted credential storage (iOS Keychain / Android Keystore) |
| Biometric auth | `expo-local-authentication` | Face ID, Touch ID, fingerprint unlock |
| Push notifications | `expo-notifications` | FCM (Android) + APNS (iOS) via Expo Push service |
| OAuth | `expo-auth-session` | GitHub SSO with PKCE flow |
| UI styling | `nativewind` v4 | TailwindCSS for React Native (matches web frontend conventions) |
| Icons | `@expo/vector-icons` | Built into Expo SDK |
| Code display | `react-native-syntax-highlighter` | Syntax-highlighted log and diff views |
| Async storage | `@react-native-async-storage/async-storage` | Zustand persistence layer |

---

## Architecture

### System Diagram

```
┌─────────────────────────────┐
│     WorkerMill Mobile App    │
│     (Expo / React Native)    │
├─────────────────────────────┤
│  Screens (expo-router)       │
│  ├── (auth)/ sign-in, bio   │
│  ├── (tabs)/ dashboard,     │
│  │   boards, settings        │
│  ├── task/[id]              │
│  ├── board/[id]             │
│  └── board/[id]/card/[cId]  │
├─────────────────────────────┤
│  Zustand Stores              │
│  ├── auth-store (secure)     │
│  ├── tasks-store (SSE)       │
│  ├── boards-store (REST)     │
│  ├── coordination-store(SSE) │
│  └── notifications-store     │
├─────────────────────────────┤
│  Services                    │
│  ├── api-client (axios)      │
│  ├── sse-client (reconnect)  │
│  ├── push-service            │
│  └── biometric-service       │
└──────────────┬──────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────┐
│    WorkerMill API (existing) │
│    api.workermill.com        │
├─────────────────────────────┤
│  Existing endpoints:         │
│  - POST /api/auth/login      │
│  - GET  /api/auth/me         │
│  - GET  /api/auth/github/*   │
│  - GET  /api/control-center/*│
│  - GET  /api/boards/*        │
│  - POST /api/boards/*        │
│  - GET  /api/tasks/*         │
│  - POST /api/tasks/:id/*     │
│  - GET  /api/coordination/*  │
├─────────────────────────────┤
│  NEW endpoints (push only):  │
│  - POST   /api/push/register │
│  - DELETE  /api/push/register│
│  - GET    /api/push/prefs    │
│  - PUT    /api/push/prefs    │
└─────────────────────────────┘
```

### API Client Pattern

The mobile API client mirrors the web frontend's `frontend/src/lib/api-client.ts`:
- Base URL: `https://api.workermill.com/api` (not relative `/api` like web)
- Request interceptor: reads JWT from `expo-secure-store`, adds `Authorization: Bearer <token>` header
- Response interceptor: on 401, attempt silent token refresh via Cognito `refreshToken`; if refresh fails, redirect to sign-in screen
- Same axios instance pattern, same error extraction logic

### SSE Client Pattern

The mobile SSE client mirrors the web's Zustand store SSE patterns:
- Uses `react-native-sse` (EventSource polyfill compatible with React Native)
- Connects on screen focus, disconnects on screen blur or app background
- Exponential backoff reconnect on network errors (1s, 2s, 4s, 8s, max 30s)
- Auth token passed as query parameter: `?token=<jwt>` (same as web dashboard SSE)
- Three SSE channels:
  1. `GET /api/control-center/stream` — dashboard task updates (connected when Dashboard tab is active)
  2. `GET /api/coordination/context/:parentTaskId/stream` — coordination feed (connected on task detail screen)
  3. `GET /api/control-center/logs/:taskId` — log streaming (connected on task detail screen)

### State Persistence

- **Auth tokens**: `expo-secure-store` (encrypted, survives app kills)
- **Zustand stores**: `AsyncStorage` via `zustand/middleware` persist (tasks, boards cached for instant load)
- **Push token**: `expo-secure-store` (needed for unregister on logout)

---

## Authentication

### First Launch — Sign In

1. User sees sign-in screen with two options:
   - **"Sign in with GitHub"** button — uses web callback redirect pattern (see "GitHub SSO on Mobile" below)
     - Mobile opens GitHub auth via `expo-web-browser`
     - Uses existing web callback URL `https://workermill.com/auth/github/callback`
     - Frontend callback page detects mobile `state` prefix → redirects to `workermill://auth/callback?code=XXX`
     - Mobile captures the deep link, sends code to `POST /api/auth/github/callback`
     - Returns JWT tokens + user/org info
   - **Email + password form** — calls `POST /api/auth/login`
     - Handles MFA challenge if enabled (TOTP code input screen)
     - Returns JWT tokens

2. On successful auth:
   - Store `accessToken`, `refreshToken`, `idToken` in `expo-secure-store`
   - Register Expo push token via `POST /api/push/register`
   - Prompt user to enable biometric unlock: "Use Face ID / fingerprint to unlock WorkerMill?"
   - Navigate to Dashboard tab

### Subsequent Launches — Biometric Unlock

1. App launches → check `expo-secure-store` for stored tokens
2. If tokens exist → show biometric prompt via `expo-local-authentication`
3. Biometric success → read tokens from secure store → refresh token in background → navigate to Dashboard
4. Biometric failure (3 attempts) → fall back to full sign-in screen
5. No stored tokens → show sign-in screen

### Session Management

- Token refresh: intercept 401 responses, call Cognito token refresh endpoint with `refreshToken`, retry original request
- If refresh fails (token expired/revoked): clear secure store, navigate to sign-in
- Organization switch: `POST /api/settings/organizations/switch` — updates tokens, refreshes all stores
- Sign out: clear `expo-secure-store`, call `DELETE /api/push/register` to unregister push token, navigate to sign-in

---

## Screen Specifications

### 1. Dashboard Tab (Home)

**Route:** `(tabs)/index.tsx`

**Layout:**
- Top: Stats bar — active workers count, queue depth, period cost, period completed (from SSE stream)
- Middle: Scrollable task list grouped by status:
  - **Active** (executing, consolidating, deploying) — shown first, with live status
  - **Queued** (queued, claimed, environment_setup, planning) — shown second
  - **Recent** (completed, failed, cancelled in last 24h) — shown third, collapsible
- Bottom: Tab bar

**Task list item shows:**
- Task issue key (e.g., "WM-42") and summary (truncated to 2 lines)
- Status badge with color (green=active, yellow=queued, blue=completed, red=failed)
- Worker persona emoji + name
- Elapsed time (live counter for active tasks)
- Cost so far (for active) or total cost (for completed)
- Tap → push to Task Detail screen

**Data source:** SSE stream at `GET /api/control-center/stream`
- Parse `data` events, update Zustand tasks-store
- Disconnect SSE when app backgrounds, reconnect on foreground

**Actions:**
- Pull-to-refresh: reconnects SSE and fetches fresh dashboard data
- Tap task → navigates to task detail

### 2. Task Detail Screen

**Route:** `task/[id].tsx`

**Layout:**
- Header: issue key, summary, status badge, persona
- Metadata section: started at, elapsed time, cost, retry count, workflow mode
- **Logs tab**: streaming terminal-style log viewer
  - Monospace font, dark background, auto-scrolls to bottom
  - SSE stream from `GET /api/control-center/logs/:taskId`
  - Shows log entries with timestamps and type indicators (stdout, stderr, system)
- **Coordination tab**: worker communication feed
  - Shows decisions, questions, blockers, completions from other workers
  - SSE stream from `GET /api/coordination/context/:parentTaskId/stream`
  - Messages show persona emoji, type badge, content, timestamp
- **Code tab**: live code changes (files modified by worker)
  - List of files on left (horizontal scroll), diff view on right
  - Uses same client-side accumulation as web: Write events = new file (all green), Edit events = oldStr→newStr diff
  - Data from `GET /api/control-center/logs/:taskId?type=code_event`

**Actions:**
- Cancel task: `POST /api/tasks/:id/cancel` (with confirmation alert)
- Retry task: `POST /api/tasks/:id/retry` (with confirmation alert)

### 3. Boards Tab

**Route:** `(tabs)/boards.tsx`

**Layout:**
- Search bar at top (filter boards by name)
- List of boards:
  - Board name + prefix (e.g., "WM — WorkerMill Mobile")
  - Card count, column count
  - Star toggle (starred boards sort to top)
  - Tap → push to Board Detail screen
- FAB (floating action button): "New Board" → modal with name input

**Data source:** `GET /api/boards` (REST, not SSE)
- Load on tab focus, cache in Zustand boards-store with AsyncStorage persistence

**Actions:**
- Create board: `POST /api/boards { name, description }`
- Star/unstar board: `PUT /api/boards/:id { isStarred }`
- Pull-to-refresh

### 4. Board Detail Screen

**Route:** `board/[id].tsx`

**Layout:**
- Header: board name, prefix, card count
- Horizontal scrollable columns (To Do, In Progress, Review, Approved, Deployed)
- Each column is a vertical scrollable list of cards
- Card item shows: issue key (PREFIX-N), title (2 lines), priority color bar, label chips, worker status indicator

**Actions:**
- Tap card → push to Card Detail screen
- Add card to column: "+" button at bottom of each column → modal with title + description
- Long-press card → action sheet: move to column (picker), run as AI task, cancel task, edit, delete

### 5. Card Detail Screen

**Route:** `board/[id]/card/[cardId].tsx` (presented as modal)

**Layout:**
- Card title (editable inline)
- Description (editable, markdown rendered)
- Priority selector (urgent/high/medium/low)
- Labels (chips, tap to manage)
- Checklist items (toggleable checkboxes)
- Dependencies section (list of blocking/blocked cards)
- Worker status: if card has a linked task, show status + link to task detail
- Activity log: card history (created, moved, edited)

**Actions:**
- Edit card: `PUT /api/boards/:boardId/cards/:cardId { title, description, priority }`
- Run as AI task: `POST /api/boards/:boardId/cards/:cardId/run` (with confirmation)
- Cancel task: `POST /api/boards/:boardId/cards/:cardId/cancel-run`
- Move to column: `PUT /api/boards/:boardId/cards/:cardId { columnId }`
- Delete card: `DELETE /api/boards/:boardId/cards/:cardId` (with confirmation)
- Add/remove labels: `POST/DELETE /api/boards/:boardId/cards/:cardId/labels`
- Add checklist item: `POST /api/boards/:boardId/cards/:cardId/checklist`
- Toggle checklist item: `PUT /api/boards/:boardId/cards/:cardId/checklist/:itemId`

### 6. Settings Tab

**Route:** `(tabs)/settings.tsx`

**Layout (scrollable sections):**

**Profile section:**
- User name, email (read-only display)
- MFA status indicator

**Organization section:**
- Current org name + plan tier
- "Switch Organization" → picker/modal showing all orgs from `GET /api/settings/organizations`
- Tap org → `POST /api/settings/organizations/switch`

**Notifications section:**
- Toggle switches for each push notification category:
  - Task completions (default: on)
  - Task failures (default: on)
  - Blocker escalations (default: on)
  - Plan approvals (default: on)
- Stored via `PUT /api/push/prefs`

**App section:**
- Biometric unlock toggle (enable/disable Face ID / fingerprint)
- App version display
- "Sign Out" button → clear tokens, unregister push, navigate to sign-in

---

## Push Notifications (New Server-Side Work)

### Database Model

New `PushSubscription` entity:

```
Table: push_subscriptions
- id: uuid (PK, default gen_random_uuid())
- user_id: uuid (FK → users.id, NOT NULL)
- org_id: uuid (FK → organizations.id, NOT NULL)
- expo_push_token: varchar(255) (UNIQUE, NOT NULL)
- platform: varchar(10) ('ios' | 'android', NOT NULL)
- device_name: varchar(255) (nullable, for display in settings)
- created_at: timestamptz (default now())
- updated_at: timestamptz (default now())
```

New `notification_preferences` JSON column on `User` model (or separate table):

```json
{
  "push_completions": true,
  "push_failures": true,
  "push_blockers": true,
  "push_plan_approvals": true
}
```

### API Endpoints

**POST /api/push/register**
- Auth: JWT (authenticateUser)
- Body: `{ expoPushToken: string, platform: "ios" | "android", deviceName?: string }`
- Upserts push subscription for user+org
- Returns: `{ id, expoPushToken, platform }`

**DELETE /api/push/register**
- Auth: JWT (authenticateUser)
- Body: `{ expoPushToken: string }`
- Removes subscription
- Returns: `{ success: true }`

**GET /api/push/prefs**
- Auth: JWT (authenticateUser)
- Returns: `{ push_completions, push_failures, push_blockers, push_plan_approvals }`

**PUT /api/push/prefs**
- Auth: JWT (authenticateUser)
- Body: partial prefs object
- Returns: updated prefs

### Push Delivery Service

New service `api/src/services/push-notifications.ts`:

- `sendPushNotification(userId, orgId, notification)` — looks up user's Expo push tokens, sends via Expo Push API (`https://exp.host/--/api/v2/push/send`)
- Respects user's notification preferences (skip if category disabled)
- Handles Expo push receipts for token invalidation (remove invalid tokens)
- Fire-and-forget from callers (non-blocking)

### Trigger Points (hooks into existing code)

| Event | Where to add hook | Notification content |
|-------|-------------------|---------------------|
| Task completed | `api/src/services/task-monitor.ts` (status → completed) | "✓ {issueKey} completed — {summary}" |
| Task failed | `api/src/services/task-monitor.ts` (status → failed) | "✗ {issueKey} failed — {reason}" |
| Blocker escalated | `api/src/routes/coordination.ts` (messageType = blocker) | "⚠ Blocker on {issueKey} — {summary}" |
| Plan ready | `api/src/routes/remote-agent.ts` (plan-result received) | "📋 Plan ready for {issueKey} — review and approve" |

### Deep Linking

Expo Router deep link scheme: `workermill://`

| Notification type | Deep link | Target screen |
|-------------------|-----------|---------------|
| Task completed | `workermill://task/{taskId}` | Task Detail |
| Task failed | `workermill://task/{taskId}` | Task Detail |
| Blocker | `workermill://task/{taskId}` | Task Detail (coordination tab) |
| Plan ready | `workermill://task/{taskId}` | Task Detail |

Configure in `app.json`:
```json
{
  "expo": {
    "scheme": "workermill",
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#6366f1"
    }
  }
}
```

---

## Project Structure

```
mobile/
├── app/                          # Expo Router file-based routes
│   ├── _layout.tsx               # Root layout: auth gate, font loading, providers
│   ├── (auth)/
│   │   ├── _layout.tsx           # Auth stack layout (no tabs)
│   │   ├── sign-in.tsx           # Email/password + GitHub SSO
│   │   └── biometric.tsx         # Biometric unlock prompt
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Bottom tab navigator config
│   │   ├── index.tsx             # Dashboard tab
│   │   ├── boards.tsx            # Boards list tab
│   │   └── settings.tsx          # Settings tab
│   ├── task/
│   │   └── [id].tsx              # Task detail (push screen)
│   └── board/
│       ├── [id].tsx              # Board detail (push screen)
│       └── [id]/
│           └── card/
│               └── [cardId].tsx  # Card detail (modal)
├── components/
│   ├── ui/                       # Reusable UI primitives
│   │   ├── Badge.tsx             # Status/priority badge
│   │   ├── Button.tsx            # Styled button
│   │   ├── Card.tsx              # Card container
│   │   ├── Modal.tsx             # Bottom sheet modal
│   │   └── Spinner.tsx           # Loading indicator
│   ├── TaskListItem.tsx          # Task in dashboard list
│   ├── TaskLogStream.tsx         # Streaming monospace log viewer
│   ├── CoordinationMessage.tsx   # Single coordination message
│   ├── CoordinationFeed.tsx      # Scrollable coordination feed
│   ├── DiffView.tsx              # Code diff renderer with syntax highlighting
│   ├── BoardCard.tsx             # Card item in Kanban column
│   ├── BoardColumn.tsx           # Single Kanban column (vertical scroll)
│   ├── StatsBar.tsx              # Dashboard stats row
│   └── StatusBadge.tsx           # Task status colored pill
├── stores/
│   ├── auth-store.ts             # Auth state, token management via expo-secure-store
│   ├── tasks-store.ts            # Active/queued/completed tasks from SSE
│   ├── boards-store.ts           # Boards + cards from REST
│   ├── coordination-store.ts     # Worker coordination messages from SSE
│   └── notifications-store.ts    # Push notification preferences
├── lib/
│   ├── api-client.ts             # Axios instance, interceptors, base URL config
│   ├── sse-client.ts             # SSE connection manager with reconnect logic
│   ├── push.ts                   # Expo push token registration/unregistration
│   ├── biometric.ts              # Biometric auth helpers (check availability, prompt)
│   └── deep-linking.ts           # Notification tap → screen navigation
├── types/
│   ├── tasks.ts                  # WorkerTask, TaskLog, TaskStep, WorkerTaskStatus
│   ├── boards.ts                 # Board, Card, Column, Label, ChecklistItem
│   └── coordination.ts           # ContextMessage, ContextMessageType
├── constants/
│   ├── colors.ts                 # Brand colors, status colors
│   └── config.ts                 # API base URL, SSE endpoints
├── assets/
│   ├── icon.png                  # App icon (1024x1024)
│   ├── splash.png                # Splash screen
│   ├── adaptive-icon.png         # Android adaptive icon
│   └── notification-icon.png     # Push notification icon
├── app.json                      # Expo configuration
├── eas.json                      # EAS Build profiles (dev, preview, production)
├── babel.config.js               # Babel config (nativewind preset)
├── tailwind.config.js            # TailwindCSS config for nativewind
├── metro.config.js               # Metro bundler config
├── nativewind-env.d.ts           # NativeWind type declarations
├── package.json
└── tsconfig.json
```

---

## Non-Functional Requirements

### Performance
- App launch to dashboard visible: < 2 seconds (with cached data)
- SSE reconnect after network loss: < 5 seconds
- Task list scroll: 60fps (virtualized FlatList)
- Board column scroll: 60fps

### Security
- All tokens stored in `expo-secure-store` (hardware-backed encryption)
- Never store tokens in AsyncStorage or plaintext
- Biometric check required before reading tokens from secure store
- HTTPS only (no HTTP fallback)
- OAuth PKCE for GitHub SSO (no implicit flow)

### Offline Behavior
- Cached dashboard and board data available offline (read-only)
- SSE streams gracefully disconnect and show "offline" indicator
- Actions (cancel, retry, create) show error toast when offline
- Auto-reconnect when network returns

### App Store Requirements
- iOS: minimum deployment target iOS 15
- Android: minimum API level 24 (Android 7.0)
- App icons, splash screen, and store screenshots required
- Privacy policy URL required (link to workermill.com/privacy)

---

## Project Bootstrap & Configuration

This section contains everything needed to scaffold the Expo project from scratch. Workers MUST follow these steps exactly.

### Step 1: Expo Project (ALREADY CREATED)

The `mobile/` directory already exists with `app.json` containing the EAS project ID (`98e60e26-13c4-421e-b114-96a7b2523f35`). Do NOT run `create-expo-app` again. Build on the existing scaffolding.

The `app.json` will be overwritten with the full configuration in Step 3 — ensure the `extra.eas.projectId` value is preserved.

### Step 2: Install Dependencies

```bash
# Core navigation & routing
npx expo install expo-router expo-linking expo-constants expo-status-bar

# State management & HTTP
npm install zustand axios

# SSE for real-time streaming
npm install react-native-sse

# Authentication & security
npx expo install expo-auth-session expo-crypto expo-web-browser
npx expo install expo-secure-store expo-local-authentication

# Push notifications
npx expo install expo-notifications expo-device

# UI framework (TailwindCSS for React Native)
npm install nativewind tailwindcss
npx expo install react-native-reanimated react-native-gesture-handler react-native-safe-area-context react-native-screens

# Async storage for Zustand persistence
npx expo install @react-native-async-storage/async-storage

# Code/log display
npm install react-native-syntax-highlighter react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter

# App lifecycle
npx expo install expo-splash-screen expo-font
```

### Step 3: app.json (Complete Configuration)

```json
{
  "expo": {
    "name": "WorkerMill",
    "slug": "workermill",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "scheme": "workermill",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#0f172a"
    },
    "assetBundlePatterns": ["**/*"],
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.workermill.mobile",
      "infoPlist": {
        "NSFaceIDUsageDescription": "Use Face ID to unlock WorkerMill",
        "NSCameraUsageDescription": "Not used"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0f172a"
      },
      "package": "com.workermill.mobile",
      "permissions": ["USE_BIOMETRIC", "USE_FINGERPRINT"]
    },
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#6366f1",
      "androidMode": "default"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-notifications",
      [
        "expo-local-authentication",
        {
          "faceIDPermission": "Use Face ID to unlock WorkerMill"
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "eas": {
        "projectId": "98e60e26-13c4-421e-b114-96a7b2523f35"
      },
      "router": {
        "origin": "https://workermill.com"
      }
    }
  }
}
```

### Step 4: eas.json (Build Profiles)

No App Store/Play Store submission needed for MVP. Preview builds create installable APK (Android) and ad-hoc IPA (iOS) directly.

```json
{
  "cli": {
    "version": ">= 12.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": false
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {}
}
```

### Step 5: EAS Project Setup (ALREADY DONE)

The EAS project is already initialized and linked. The project ID `98e60e26-13c4-421e-b114-96a7b2523f35` is in `app.json`. Do NOT run `eas init` again.

Workers do NOT need `EXPO_TOKEN` — builds run via GitHub Actions CI which has the token as a secret.

### Step 6: tsconfig.json

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts",
    "nativewind-env.d.ts"
  ]
}
```

### Step 7: babel.config.js

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

### Step 8: tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          900: "#312e81",
        },
        slate: {
          850: "#172033",
          950: "#0f172a",
        },
      },
    },
  },
  plugins: [],
};
```

### Step 9: metro.config.js

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

### Step 10: global.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Step 11: nativewind-env.d.ts

```ts
/// <reference types="nativewind/types" />
```

### Step 12: constants/config.ts

```ts
export const API_BASE_URL = "https://api.workermill.com/api";
export const SSE_BASE_URL = "https://api.workermill.com/api";
```

### Step 13: Assets (Placeholder Generation)

Workers MUST create placeholder assets at minimum dimensions. Use solid color (#0f172a background, #6366f1 accent) with "WM" text centered:

| Asset | Path | Size | Format |
|-------|------|------|--------|
| App icon | `assets/icon.png` | 1024x1024 | PNG |
| Splash screen | `assets/splash.png` | 1284x2778 | PNG |
| Adaptive icon (Android) | `assets/adaptive-icon.png` | 1024x1024 | PNG (foreground only, transparent bg) |
| Notification icon | `assets/notification-icon.png` | 96x96 | PNG (white on transparent) |
| Favicon | `assets/favicon.png` | 48x48 | PNG |

Generate these programmatically or use Expo's default placeholders and customize later. The app will build with any valid PNG at these paths.

---

## Server-Side Changes (API)

These changes are in `api/` within the same monorepo. Workers handle both `mobile/` and `api/` directories.

### New Migration: PushSubscriptions

**File:** `api/src/db/migrations/1741200000000-AddPushSubscriptions.ts`

The migration timestamp follows the existing pattern (the latest existing migration is `1741100000000`).

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPushSubscriptions1741200000000 implements MigrationInterface {
  name = "AddPushSubscriptions1741200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Push subscription table for Expo push tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "expo_push_token" varchar(255) NOT NULL,
        "platform" varchar(10) NOT NULL CHECK ("platform" IN ('ios', 'android')),
        "device_name" varchar(255),
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "uq_push_subscriptions_token" UNIQUE ("expo_push_token")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_org"
      ON "push_subscriptions" ("user_id", "org_id")
    `);

    // Notification preferences column on users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb
      DEFAULT '{"push_completions": true, "push_failures": true, "push_blockers": true, "push_plan_approvals": true}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "push_subscriptions"`);
  }
}
```

**CRITICAL:** After creating the migration file, it MUST be:
1. Imported in `api/src/db/connection.ts`
2. Added to the `migrations` array in the DataSource config

### New Model: PushSubscription

**File:** `api/src/models/PushSubscription.ts`

Standard TypeORM entity matching the migration above. Export from `api/src/models/index.ts` and register in `api/src/db/connection.ts` entities array.

### New Route: Push Notifications

**File:** `api/src/routes/push.ts`

Four endpoints behind `authenticateUser` middleware:
- `POST /register` — upsert push subscription
- `DELETE /register` — remove push subscription
- `GET /prefs` — read notification preferences
- `PUT /prefs` — update notification preferences

Register in `api/src/routes/index.ts`: `app.use("/api/push", pushRouter);`

### New Service: Push Notification Delivery

**File:** `api/src/services/push-notifications.ts`

- `sendPushNotification(userId: string, orgId: string, notification: { title: string, body: string, data?: Record<string, string> })`
- Queries `push_subscriptions` for user+org
- Checks user's `notification_preferences` for the category
- Sends via Expo Push API: `POST https://exp.host/--/api/v2/push/send`
- No external dependencies (just `fetch` to Expo's API)
- Fire-and-forget (caller does not await)

### Push Trigger Integration Points

Add `sendPushNotification()` calls to existing code (non-blocking, fire-and-forget):

1. **`api/src/services/notifications.ts`** — already has `notifyTaskCompleted()` and `notifyTaskFailed()` functions. Add push delivery alongside existing Slack/email notifications.

2. **`api/src/routes/coordination.ts`** — when a `blocker` type message is posted, also send push notification.

3. **`api/src/routes/remote-agent.ts`** — when plan result is received (`POST /api/agent/plan-result`), send push notification.

### GitHub SSO on Mobile (Web Callback Redirect Pattern)

GitHub OAuth Apps only allow ONE callback URL. Instead of registering a second URL, the mobile app reuses the existing web callback flow with a state-based redirect.

**Flow:**
1. Mobile calls `GET /api/auth/github/authorize` — gets the GitHub authorize URL (redirect_uri = `https://workermill.com/auth/github/callback`)
2. Mobile opens this URL via `expo-web-browser` (`WebBrowser.openAuthSessionAsync`), adding `mobile_` prefix to the `state` param
3. User authorizes on GitHub
4. GitHub redirects to `https://workermill.com/auth/github/callback?code=XXX&state=mobile_YYY`
5. **Frontend `GitHubCallback.tsx` detects `state` starts with `mobile_`** → instead of processing the code, it redirects to `workermill://auth/callback?code=XXX&state=YYY`
6. `WebBrowser.openAuthSessionAsync` on the mobile app is watching for `workermill://` URLs — it captures the redirect and returns the code
7. Mobile app extracts `code` from the URL and sends it to `POST /api/auth/github/callback`

**No changes to the GitHub OAuth App settings needed.** The single registered callback URL (`https://workermill.com/auth/github/callback`) handles both web and mobile.

**Frontend change required** — modify `frontend/src/pages/GitHubCallback.tsx`:

Add this check at the top of the `handleCallback()` function (before the existing `authAPI.githubCallback` call):

```typescript
// If this callback was initiated from the mobile app, redirect to the
// mobile deep link with the code instead of processing it here.
// The mobile app's WebBrowser session will capture the workermill:// URL.
if (state && state.startsWith("mobile_")) {
  const mobileRedirect = `workermill://auth/callback?code=${encodeURIComponent(code)}`;
  window.location.href = mobileRedirect;
  return;
}
```

**Mobile-side implementation** (in `mobile/lib/github-auth.ts`):

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

export async function signInWithGitHub(apiBaseUrl: string) {
  // 1. Get the authorize URL from our API
  const res = await fetch(`${apiBaseUrl}/auth/github/authorize`);
  const { authorizeUrl, state } = await res.json();

  // 2. Prefix the state with "mobile_" so the web callback knows to redirect
  const mobileAuthorizeUrl = authorizeUrl.replace(
    `state=${state}`,
    `state=mobile_${state}`
  );

  // 3. Open browser and wait for workermill:// redirect
  const result = await WebBrowser.openAuthSessionAsync(
    mobileAuthorizeUrl,
    'workermill://auth/callback'
  );

  if (result.type !== 'success') {
    throw new Error('GitHub sign-in was cancelled');
  }

  // 4. Extract code from the redirect URL
  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code received');

  // 5. Exchange code for tokens via our API
  const tokenRes = await fetch(`${apiBaseUrl}/auth/github/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirectUri: 'https://workermill.com/auth/github/callback',
    }),
  });

  return tokenRes.json();
}
```

**No API changes needed.** The existing `POST /api/auth/github/callback` already accepts the code and redirectUri from the client.

---

## Build & Install on Device

No App Store or Play Store submission required. Use EAS preview builds for direct device installation.

### Android (APK — simplest)

```bash
cd mobile

# Build preview APK (no Google Play account needed)
npx eas-cli build --profile preview --platform android

# After build completes, EAS provides a download URL
# Download the .apk file and install on any Android device
# Or scan the QR code from the EAS dashboard on your phone
```

### iOS (Deferred)

iOS preview builds require an Apple Developer account ($99/year). Skipped for MVP. Add later by running `eas build --profile preview --platform ios` after account setup.

### Development (Expo Go — fastest iteration)

For development, use Expo Go on a physical device:

```bash
cd mobile
npx expo start

# Scan the QR code with:
# - Expo Go app (iOS App Store / Google Play)
# - Camera app (iOS) which opens Expo Go
```

**Limitation:** Expo Go does not support `expo-notifications` push tokens. Use preview builds for testing push notifications.

### CI/CD: GitHub Actions Workflow (CRITICAL — this is how the app gets built)

Workers do NOT run `eas build` themselves. They write code and push to git. GitHub Actions handles the actual EAS build using `EXPO_TOKEN` from GitHub Secrets.

**File:** `.github/workflows/mobile-build.yml`

```yaml
name: Mobile Build
on:
  workflow_dispatch:  # MANUAL ONLY — do not add push triggers until the app is stable

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: cd mobile && npm ci
      - name: Setup EAS
        uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - name: Build Android preview APK
        run: cd mobile && eas build --profile preview --platform android --non-interactive
```

**IMPORTANT: Manual trigger only.** Do NOT add `push:` triggers. The workflow is triggered manually from the GitHub Actions tab when the code is ready for a build. This avoids piling up failed builds during development.

**Required GitHub Secret (must be set before first manual build):**
- `EXPO_TOKEN` — Expo access token for EAS CLI authentication

**Build flow:** Workers push code → you manually trigger the workflow from GitHub Actions → EAS builds APK → download from Expo dashboard

---

## Environment Variables & Secrets

### GitHub Secrets (must be set before Full Build)

| Secret | Purpose | Where to set |
|--------|---------|--------------|
| `EXPO_TOKEN` | EAS CLI authentication for cloud builds | GitHub repo → Settings → Secrets → Actions |

### Mobile App (build-time, hardcoded)

| Variable | Value | Where |
|----------|-------|-------|
| `API_BASE_URL` | `https://api.workermill.com/api` | `mobile/constants/config.ts` |

### API Server (runtime — already set)

No new env vars needed. Push notification service uses Expo's public HTTP API which requires no API key.

### Manual Setup Status

| Step | Status | Details |
|------|--------|---------|
| Expo project created | DONE | `@jarod.rosenthal/workermill`, ID: `98e60e26-13c4-421e-b114-96a7b2523f35` |
| GitHub Secret (EXPO_TOKEN) | DONE | Set on `jarod-rosenthal/workermill` repo |
| GitHub OAuth for mobile | DONE | No OAuth App changes needed — uses web callback redirect pattern (see "GitHub SSO on Mobile" section) |
| Scaffolded `mobile/` directory | DONE | `app.json` has EAS project ID, workers build on top of this |

---

## Out of Scope (v1)

These features are explicitly NOT included in the MVP:

- **Remote agent execution on mobile** — agents run on servers/desktops, not phones
- **Code editing** — mobile is for monitoring, not writing code
- **Analytics dashboards** — cost/quality/efficiency charts come in v1.1
- **Billing management** — subscription changes happen on web
- **Full Build / PRD decomposition** — complex input, better on web
- **Integration settings** — Jira/GitHub/Linear config stays on web
- **Worker persona management** — Persona Studio stays on web
- **Offline task creation** — requires sync queue, defer to v2
- **Tablet-optimized layouts** — phone-first, tablet uses phone layout initially
- **App Store / Play Store submission** — use EAS preview builds for direct device install

---

## Testing & Validation

Workers MUST validate their work at each stage. The app cannot be tested on a real device from within the worker container, so validation relies on type checking, linting, and unit tests.

### Validation Commands (run after every card)

```bash
# Type check (must pass with zero errors)
cd mobile && npx tsc --noEmit

# Lint
cd mobile && npx expo lint

# Unit tests
cd mobile && npx jest --passWithNoTests

# API type check (if API files were modified)
cd api && npm run typecheck
```

### Unit Tests

Workers MUST write unit tests using Jest + React Native Testing Library. Install test dependencies:

```bash
cd mobile
npm install --save-dev jest @testing-library/react-native @testing-library/jest-native jest-expo @types/jest
```

Add to `mobile/package.json`:
```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind)"
    ],
    "setupFilesAfterSetup": ["@testing-library/jest-native/extend-expect"]
  }
}
```

**Required test coverage:**

| Layer | What to test | Files |
|-------|-------------|-------|
| **Stores** | Auth store token management, tasks store state updates, boards store CRUD, coordination store message handling | `stores/__tests__/*.test.ts` |
| **API client** | Interceptor adds auth header, 401 triggers refresh, error extraction | `lib/__tests__/api-client.test.ts` |
| **SSE client** | Connection lifecycle, reconnect on error, disconnect on background | `lib/__tests__/sse-client.test.ts` |
| **Push service** | Token registration, unregistration, notification handling | `lib/__tests__/push.test.ts` |
| **GitHub auth** | State prefix, URL parsing, code extraction | `lib/__tests__/github-auth.test.ts` |
| **Components** | TaskListItem renders status/persona, StatusBadge colors, StatsBar formatting | `components/__tests__/*.test.tsx` |
| **API routes** (server-side) | Push register/unregister, prefs CRUD | `api/src/routes/push.test.ts` |
| **Push service** (server-side) | Notification delivery, preference filtering, token invalidation | `api/src/services/push-notifications.test.ts` |

### API Integration Tests

For the new push notification endpoints, add tests following the existing Vitest pattern in `api/`:

```bash
cd api && npx vitest run src/routes/push.test.ts
cd api && npx vitest run src/services/push-notifications.test.ts
```

---

## Build & Install (Manual Steps After Workers Complete)

Workers write all code and push to the repository. The actual build and device installation requires these manual steps:

### Step 1: Trigger the Build

Go to GitHub → `jarod-rosenthal/workermill` → Actions → "Mobile Build" → "Run workflow" → Run

This triggers `eas build --profile preview --platform android` via GitHub Actions.

### Step 2: Download the APK

After the build completes (~5-10 minutes):
- Go to https://expo.dev → Projects → workermill → Builds
- Download the `.apk` file for the preview build

### Step 3: Install on Android Device

- Transfer the APK to your phone (email, Google Drive, USB, etc.)
- Open the APK → Allow install from unknown sources → Install
- Or: scan the QR code from the Expo dashboard directly on your phone

### Iterating on Bugs

If the app crashes or has runtime issues after install:
1. Check the EAS build logs for compile errors
2. Use `npx expo start` in Expo Go for faster iteration on JS bugs (limited — no push notifications in Expo Go)
3. Fix code, push, retrigger the workflow

---

## Success Criteria

1. `mobile/` directory contains a working Expo project with zero TypeScript errors
2. All unit tests pass (`npx jest` exits 0)
3. API type check passes after server-side changes (`cd api && npm run typecheck`)
4. API push notification tests pass (`cd api && npx vitest run src/routes/push.test.ts`)
5. User can sign in via GitHub SSO or email/password
6. Dashboard shows real-time task status via SSE streaming
7. User can browse boards, view cards, and create new cards
8. User can view streaming logs on task detail screen
9. User can cancel or retry tasks from the app
10. Push notifications fire for task completions, failures, and blockers
11. Tapping a push notification deep-links to the relevant task detail
12. Biometric unlock works for subsequent app launches
13. Manual GitHub Actions trigger produces an installable Android APK
14. Frontend `GitHubCallback.tsx` correctly redirects mobile OAuth flows
