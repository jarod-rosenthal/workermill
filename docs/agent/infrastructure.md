# Infrastructure

This document covers the cloud infrastructure for self-hosted or managed WorkerMill deployments.

## Environment Configuration

Production uses AWS (us-east-1) with an ECS cluster. Terraform config is in `infrastructure/terraform/environments/prod/`.

## Terraform Commands

```bash
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=<your-terraform-state-bucket>"
terraform plan && terraform apply
```

No `-var` flags needed — defaults in `variables.tf`.

## SES Email Configuration

**Cross-region:** Outbound email uses **us-east-2** SES (production sending access). Inbound uses us-east-1. Do not change this. Templates in `api/src/services/email.ts`.

## Standalone Mode

Standalone mode requires no cloud infrastructure. The agent binary runs locally with SQLite storage. See `docs/agent/agent-and-vscode.md` for setup.
