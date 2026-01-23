# WorkerMill Step 0 Templates

Pre-built project scaffolds for V2 Pipeline initialization. These templates provide:

- Working test runners
- CI/CD pipelines
- Type checking
- Linting
- Basic structure

## Available Templates

| Template | Stack | Use When |
|----------|-------|----------|
| `react-vite-typescript` | React 18 + Vite + TypeScript + Tailwind + Vitest | Frontend SPAs |
| `fastapi-python` | FastAPI + Python 3.11 + Pydantic + pytest | Python APIs |
| `express-typescript` | Express + TypeScript + Vitest | Node.js APIs |
| `nextjs-typescript` | Next.js 14 + TypeScript + Tailwind + Vitest | Full-stack React |

## Template Variables

Templates use `{{VARIABLE}}` placeholders that get replaced during injection:

- `{{PROJECT_NAME}}` - Project name from PRD
- `{{PROJECT_DESCRIPTION}}` - Project description from PRD

## Selection Logic

Templates are selected based on `TechStackV2.templateId` from the execution plan:

```typescript
// Auto-selection rules in pipeline-v2-types.ts
if (framework === "react" && buildTool === "vite" && language === "typescript") {
  return "react-vite-typescript";
}
if (framework === "fastapi" && language === "python") {
  return "fastapi-python";
}
if (framework === "express" && language === "typescript") {
  return "express-typescript";
}
if (framework === "nextjs" && language === "typescript") {
  return "nextjs-typescript";
}
```

## Injection Flow

1. Worker clones empty/existing repo
2. If greenfield + template match: Copy template files
3. Replace `{{VARIABLE}}` placeholders
4. Commit as "Initial scaffold"
5. Agent begins at Step 1 with working test runner

## Adding New Templates

1. Create directory: `worker/templates/<template-id>/`
2. Add all necessary config files with `{{VARIABLE}}` placeholders
3. Include `.github/workflows/ci.yml` for CI
4. Include `tests/` directory with at least one passing test
5. Update `TechStackV2.templateId` type in `pipeline-v2-types.ts`
6. Add selection logic in `getTemplateId()` function
