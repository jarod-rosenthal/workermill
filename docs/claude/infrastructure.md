# Infrastructure

## Environment Configuration

**Production** (`environments/prod/`) - workermill.com — AWS account AWS_ACCOUNT_ID, us-east-1. ECS cluster is `workermill-dev` (historical naming).

## Terraform Commands

```bash
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan && terraform apply
```

No `-var` flags needed — defaults in `variables.tf`. **Dev environment is NOT running** (see Critical Rules).

## SES Email Configuration

**Cross-region:** Outbound email uses **us-east-2** SES (production sending access). Inbound uses us-east-1. Do not change this. Templates in `api/src/services/email.ts`.
