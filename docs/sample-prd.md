# Task Notification System

## Overview

Build a real-time notification system for WorkerMill that alerts users when their AI worker tasks change status (queued, running, completed, failed). Notifications should appear in-app (bell icon with badge count), via email digest, and optionally via Slack webhook.

## Problem Statement

Users currently have to manually refresh the dashboard to see if their tasks have completed or failed. There is no proactive communication when a task finishes, which means users waste time polling the dashboard or miss failures entirely. This is especially painful for long-running epic tasks that take 10-30 minutes.

## Target Users

- Individual developers using WorkerMill to run AI coding tasks
- Team leads monitoring multiple concurrent workers across an organization
- DevOps engineers who need immediate alerts on deployment task failures

## Requirements

### In-App Notifications

- Bell icon in the top navigation bar with unread badge count
- Notification dropdown panel showing the 20 most recent notifications
- Each notification shows: task title, status change, timestamp, persona icon
- Clicking a notification navigates to the task detail page
- "Mark all as read" button clears the badge count
- Notifications persist in the database (not just in-memory)
- Real-time delivery via existing SSE connection (no new WebSocket infrastructure)

### Email Digest

- Users can opt-in to email notifications in their profile settings
- Daily digest email summarizing completed and failed tasks from the last 24 hours
- Immediate email for task failures (configurable per-user: immediate vs digest-only)
- Email template uses the existing SES infrastructure (us-east-2)
- Unsubscribe link in every email that toggles the preference off
- Rate limit: maximum 10 immediate failure emails per user per hour

### Slack Integration (Optional per org)

- Organizations can configure an incoming Slack webhook URL in Settings > Integrations
- When configured, task status changes post to the Slack channel
- Message format: task title, status, duration, link to dashboard
- Only posts for final states (completed, failed, cancelled) — not intermediate states
- Respects org-level toggle to enable/disable

### Notification Preferences

- User-level preferences stored in the users table (new columns or JSON field)
- Settings: in-app (always on), email digest (opt-in), email immediate failures (opt-in)
- Org-level Slack webhook URL and enabled toggle
- API endpoints for reading and updating preferences

## Technical Constraints

- Must use the existing PostgreSQL database (no new data stores)
- Must use the existing SES email service in us-east-2 (no new email providers)
- SSE delivery must use the existing SSE infrastructure in control-center.ts
- No new npm dependencies for the notification system itself
- Slack integration uses a simple HTTP POST to the webhook URL (no Slack SDK)
- Email digest job runs as a cron-style setTimeout loop in the API process (no external job runner)

## Data Model

### notifications table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| org_id | uuid | Foreign key to organizations |
| user_id | uuid | Foreign key to users |
| task_id | uuid | Foreign key to worker_tasks |
| type | varchar | Status change type (completed, failed, cancelled, started) |
| title | varchar | Human-readable notification title |
| read | boolean | Whether the user has seen it (default false) |
| created_at | timestamp | When the notification was created |

### User preferences (new columns on users table)

| Column | Type | Default |
|--------|------|---------|
| notify_email_digest | boolean | false |
| notify_email_failures | boolean | false |

### Org settings (new columns on organizations table)

| Column | Type | Default |
|--------|------|---------|
| slack_webhook_url | varchar | null |
| slack_notifications_enabled | boolean | false |

## API Endpoints

- GET /api/notifications — list notifications for current user (paginated)
- PATCH /api/notifications/:id/read — mark single notification as read
- POST /api/notifications/mark-all-read — mark all as read for current user
- GET /api/notifications/unread-count — returns { count: number }
- GET /api/settings/notification-preferences — get current user's preferences
- PUT /api/settings/notification-preferences — update preferences

## Success Criteria

- Users see a badge count update within 3 seconds of a task status change
- Email digest sends reliably every 24 hours with accurate task summaries
- Slack messages post within 5 seconds of task completion/failure
- No performance regression on the existing SSE streaming or task orchestration
- Notification preferences UI is accessible from the user profile dropdown
