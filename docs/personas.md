# Worker Personas

WorkerMill uses specialized AI personas to handle different types of development tasks. Each persona has domain expertise and is optimized for specific work.

## Tech Lead Reviewer

The Tech Lead Reviewer is always active. It reviews all PRs created by workers, provides feedback, and approves or requests revisions.

**Responsibilities:**
- Review code changes for quality and correctness
- Ensure changes match ticket requirements
- Check for security issues and best practices
- Approve, reject, or request revisions
- Provide actionable feedback to workers

## Worker Personas

WorkerMill ships with specialized worker personas for every domain:

| Persona | Slug | Risk Level | Focus |
|---------|------|------------|-------|
| Backend Developer | `backend_developer` | medium | APIs, services, databases, business logic |
| Frontend Developer | `frontend_developer` | medium | UI components, React, CSS, client-side code |
| Full Stack Developer | `fullstack_developer` | medium | End-to-end features spanning both tiers |
| DevOps Engineer | `devops_engineer` | high | CI/CD, Docker, Kubernetes, infrastructure |
| Security Engineer | `security_engineer` | high | Auth, encryption, vulnerability fixes, audits |
| QA Engineer | `qa_engineer` | low | Tests, test suites, coverage improvements |
| Data Engineer | `data_engineer` | medium | Migrations, queries, ETL, analytics |
| Mobile Developer | `mobile_developer` | medium | React Native, iOS, Android |
| Documentation Writer | `docs_writer` | low | READMEs, API docs, inline comments |

## How Personas Are Selected

**Automatic Assignment:**
- Based on issue tracker labels
- Inferred from issue summary/description
- Default persona if uncertain

**Manual Assignment:**
- Selected when creating task
- Override via dashboard
- API parameter on task creation

## AI Models & Providers

Workers can use different AI models from multiple providers. Configure per-persona provider routing in Settings to optimize for cost, capability, or specific model strengths.

| Model Tier | Examples | Best For |
|------------|---------|---------|
| Flagship | Claude Opus 4.6, GPT-5.4-pro, Gemini 3.1 Pro | Complex reasoning, security, architecture |
| Balanced | Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Flash Lite | Most development tasks |
| Efficient | Claude Haiku 4.5, GPT-5.4-mini | Simple tasks, speed-optimized |
| Self-Hosted | Ollama (Llama, Qwen, DeepSeek) | Sensitive code, no external data sharing |

## Custom Personas

Create custom personas in the [Persona Studio](/docs/persona-studio) to match your team's specific needs. Custom personas can have:
- Custom system prompts and instructions
- Domain-specific knowledge
- Assigned model and provider
- Inference rules for automatic task routing
