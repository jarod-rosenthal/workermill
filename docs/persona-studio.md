# Persona Studio

Create and configure AI worker personas that specialize in different types of development work. Control which personas are available and how issues are automatically assigned to the right expert.

## Overview

WorkerMill includes multiple specialized AI personas out of the box, and you can create your own. Each persona has expertise in a specific development domain. The Persona Studio lets you:

- View and manage all available personas
- Enable/disable personas based on your team's needs
- Create custom personas for specialized tasks
- Configure inference rules for automatic persona assignment
- Test how tickets will be routed to personas

## Creating a Custom Persona

1. Go to **Settings → Persona Studio**
2. Click **New Persona**
3. Fill in the persona details:
   - **Name** — Display name (e.g., "iOS Developer")
   - **Slug** — Machine identifier (e.g., `ios_developer`)
   - **Emoji** — Visual identifier
   - **Description** — What this persona specializes in
   - **System Prompt** — Instructions that guide the worker's behavior
   - **Skills** — Tags describing capabilities
   - **Risk Level** — `low`, `medium`, or `high` (affects queueing priority)

## Persona Fields

| Field | Description |
|-------|-------------|
| **Name** | Human-readable display name |
| **Slug** | Machine identifier used in API and labels |
| **Emoji** | Visual identifier in logs and UI |
| **Short Label** | Compact display in notifications |
| **Description** | What tasks this persona handles |
| **System Prompt** | Core instructions for the AI worker |
| **Skills** | Capability tags for routing |
| **Risk Level** | `low` / `medium` / `high` |
| **Enabled** | Toggle to make persona available for new tasks |

## Inference Rules

Configure automatic persona assignment without requiring manual label selection:

- **Label matching** — `label:backend` → assign `backend_developer`
- **Keyword matching** — ticket contains "database" → assign `data_engineer`
- **Project matching** — Jira project `FE-*` → assign `frontend_developer`
- **Default fallback** — when no rules match, use the default persona

## Testing Routing

Use the **Route Test** feature in Persona Studio to verify your inference rules:

1. Paste a sample ticket title or description
2. Click **Test Routing**
3. See which persona would be assigned and why

## Managing Built-in Personas

Built-in personas can be:
- **Enabled/disabled** — Control which personas are available in your org
- **Customized** — Override the system prompt to adjust behavior
- **Cloned** — Create a variant of a built-in persona as a starting point

Disabling a persona prevents it from being assigned to new tasks, but doesn't affect running tasks.
