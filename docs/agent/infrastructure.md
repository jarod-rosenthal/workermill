# Infrastructure

## Standalone Mode

Standalone mode requires no cloud infrastructure. The agent binary runs locally with SQLite storage. See [Agent & VS Code](agent-and-vscode.md) for setup.

## Self-Hosted Requirements

To run the full stack (API server, web dashboard, workers), you need:

- **Node.js** 20+
- **PostgreSQL** 14+
- **Redis** 7+

Any hosting platform that supports these works — VPS, container orchestration, PaaS, etc.

### Services

| Component | What it does | Default port |
|-----------|-------------|--------------|
| API server | Task management, log streaming, webhooks | 3001 |
| Web dashboard | Monitoring UI, Kanban boards, live code view | 5173 (dev) |
| PostgreSQL | Task state, logs, coordination | 5432 |
| Redis | Real-time pub/sub, cron locks | 6379 |

### Email (Optional)

Outbound email (notifications, invites) requires an SMTP provider or SES-compatible service. Templates are in `api/src/services/email.ts`.
