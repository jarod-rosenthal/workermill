# Persona Customization Plan

## Overview

Enable organizations to customize worker personas and create new ones from scratch, with full integration into the task assignment and execution pipeline.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Database as Source of Truth | ✅ Complete |
| Phase 2 | Dynamic Persona Assignment | ✅ Complete |
| Phase 3 | Full Customization UI | ✅ Complete |
| Phase 4 | Testing & Validation | ✅ Complete |
| E2E Testing | End-to-end validation | ⏳ Pending |

---

## What's Been Completed

### Phase 1: Database as Source of Truth ✅

- [x] Seed script reads filesystem directives and populates database (`npm run seed:personas`)
- [x] "Customize" copies directives and scripts to org persona
- [x] Workers fetch directives from API (with filesystem fallback)
- [x] Keyword patterns stored in database for each persona
- [x] Label shortcuts for persona assignment

### Phase 2: Dynamic Persona Assignment ✅

- [x] Custom personas can be assigned to tasks via keyword patterns
- [x] Inference rules query personas from DB (not hardcoded)
- [x] Planning agent dynamically fetches available personas
- [x] `WorkerPersona` type changed to `string` for flexibility
- [x] Custom personas get 1.5x weight in keyword matching

### Phase 3: Full Customization UI ✅

- [x] **Unified persona view** - All personas (system and custom) show actual content from DB
- [x] **Read-only mode for system personas** - Content visible with "Read-only" badge
- [x] **One-click customization** - "Edit (Customize)" button creates org copy and navigates to it
- [x] **Split-pane markdown editor** - Toggle preview on/off with live rendering
- [x] **Template selector** - Choose from Backend, Frontend, DevOps, or Minimal templates
- [x] **AI-assisted generation** - "Generate with AI" button creates directive content
- [x] **Inline validation** - Errors (red) and warnings (yellow) shown below editor
- [x] Removed GitHub links - All content served from database

### Phase 4: Testing & Validation ✅

- [x] **Directive validation service** - Size limits (50KB), required sections, forbidden patterns
- [x] **Test persona endpoint** - Preview rendered directive with variable interpolation
- [x] **Test modal in UI** - Shows size, variables, validation status, rendered preview
- [x] **Diff tab** - Compare customized persona against original system version
- [x] **Variable extraction** - Detects `{{variable}}` interpolations
- [x] **Markdown structure validation** - Unclosed code blocks, heading hierarchy, long lines

---

## What Remains

### E2E Testing ⏳

The following end-to-end test should be performed:

1. **Create custom persona flow:**
   - Go to Persona Studio
   - Click on a system persona (e.g., Backend Developer)
   - View the directive content (read-only)
   - Click "Edit (Customize)" or the banner button
   - Verify navigation to the new org-specific copy
   - Edit the directive content
   - Save changes
   - Verify changes persist

2. **Task assignment flow:**
   - Create a Jira ticket with keywords matching your custom persona
   - Verify the custom persona is assigned via inference
   - Run a task and verify the worker uses the custom directive

3. **Template and AI generation:**
   - Create a new persona from scratch
   - Select a template
   - Use "Generate with AI" to create content
   - Save and verify

---

## Architecture (Final)

### Single Source of Truth: Database

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATABASE                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │    personas     │  │persona_directives│  │ persona_scripts│  │
│  │ (metadata +     │  │ (versioned)      │  │ (versioned)    │  │
│  │  keyword_pattern│  │                  │  │                │  │
│  │  label_shortcuts│  │                  │  │                │  │
│  └─────────────────┘  └──────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                                           ↓
   API Endpoints                              Worker Containers
   - GET /api/personas                        - Fetch bundle on startup
   - GET /api/personas/worker/:slug/bundle    - Use DB directives
   - GET /api/personas/templates              - Filesystem fallback only
   - POST /api/personas/:id/test
   - GET /api/personas/:id/diff
```

### User Flow

```
User views system persona
        ↓
Sees directive content (read-only)
        ↓
Clicks "Edit (Customize)"
        ↓
System creates org copy with all directives/scripts
        ↓
User navigated to editable copy
        ↓
User edits with live preview + validation
        ↓
Saves changes (versioned)
        ↓
Task inference can now match custom persona
        ↓
Worker fetches custom directive from API
```

---

## API Endpoints (Complete)

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/personas` | GET | List all personas (system + org) | ✅ |
| `/api/personas` | POST | Create new persona | ✅ |
| `/api/personas/:id` | GET | Get persona with directives | ✅ |
| `/api/personas/:id` | PUT | Update persona metadata | ✅ |
| `/api/personas/:id` | DELETE | Delete persona (not system) | ✅ |
| `/api/personas/:id/customize` | POST | Copy system persona to org | ✅ |
| `/api/personas/:id/directives` | GET | List directives | ✅ |
| `/api/personas/:id/directives` | POST | Create directive version | ✅ |
| `/api/personas/:id/directives/:did/rollback` | POST | Rollback to version | ✅ |
| `/api/personas/worker/:slug/bundle` | GET | Get bundle for worker | ✅ |
| `/api/personas/templates` | GET | List starter templates | ✅ |
| `/api/personas/:id/generate-directive` | POST | AI-generate directive | ✅ |
| `/api/personas/:id/test` | POST | Test persona (render + validate) | ✅ |
| `/api/personas/:id/diff` | GET | Compare against system persona | ✅ |
| `/api/personas/validate-directive` | POST | Validate directive content | ✅ |

---

## Frontend Features (Complete)

### PersonaDetail.tsx Enhancements

| Feature | Description |
|---------|-------------|
| **Unified view** | System and custom personas use same layout |
| **Auto-load directive** | README.md content loads automatically on page view |
| **Seed persona banner** | Blue banner with "Customize" button for system personas |
| **Read-only mode** | System persona content shown with "Read-only" badge |
| **Edit (Customize)** | One-click to create and navigate to editable copy |
| **Split-pane editor** | Toggle between editor-only and editor+preview |
| **Live markdown preview** | Real-time rendering with `react-markdown` |
| **Template selector** | Dropdown in new directive modal |
| **AI generation** | "Generate with AI" button creates content |
| **Inline validation** | Errors/warnings displayed below editor |
| **Test modal** | Preview rendered directive, size, variables |
| **Diff tab** | Compare customized persona vs system original |
| **Version history** | Rollback to previous directive versions |

---

## Files Modified

### API

| File | Changes |
|------|---------|
| `api/src/models/Persona.ts` | Added `keywordPattern`, `labelShortcuts` columns |
| `api/src/db/migrations/1706688000011-AddPersonaKeywordPattern.ts` | Migration for new columns |
| `api/src/db/seeds/seed-personas.ts` | Seeds keyword patterns for all 16 personas |
| `api/src/services/persona.ts` | Added `getDirectiveTemplates`, `generateDirectiveContent`, `testPersona`, `getPersonaDiff` |
| `api/src/services/persona-inference.ts` | Queries personas from DB, supports custom patterns |
| `api/src/services/planning-agent.ts` | Dynamic persona list in prompts |
| `api/src/services/planning-types.ts` | `WorkerPersona` changed to `string` |
| `api/src/services/directive-validation.ts` | New validation service |
| `api/src/routes/personas.ts` | Added templates, test, diff, validate endpoints |

### Frontend

| File | Changes |
|------|---------|
| `frontend/src/pages/PersonaDetail.tsx` | Complete rewrite of directives/scripts tabs |
| `frontend/package.json` | Added `react-markdown` dependency |

---

## Validation Rules

| Rule | Details |
|------|---------|
| **Max size** | 50KB per directive |
| **Required sections** | `## Role`, `## Guidelines` (warnings only) |
| **Forbidden patterns** | `eval(`, `exec(`, `child_process`, env var writes |
| **Markdown structure** | Unclosed code blocks, heading hierarchy skips |
| **Long lines** | Warning if >500 characters |
| **Valid variables** | `{{task.summary}}`, `{{org.name}}`, etc. |

---

## Next Steps

1. **Run E2E test** - Manually verify the complete flow works
2. **Deploy API** - Run `./deploy.sh --api` to deploy backend changes
3. **Seed personas** - Run `cd api && npm run seed:personas` to update keyword patterns
4. **Monitor** - Watch for any issues with custom persona assignment or worker execution
