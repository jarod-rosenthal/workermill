# WorkerMill Infrastructure

Terraform configuration for deploying WorkerMill to AWS.

## Prerequisites

1. **AWS Account** with admin access
2. **Domain Name** with Route53 hosted zone already created
3. **Terraform** >= 1.0 installed
4. **AWS CLI** configured with credentials

## Directory Structure

```
infrastructure/terraform/
├── bootstrap/                    # State bucket (run first)
├── modules/
│   ├── networking/               # VPC, subnets, NAT, route tables
│   ├── database/                 # RDS PostgreSQL
│   ├── secrets/                  # Secrets Manager
│   ├── ecs-cluster/              # ECS cluster, IAM roles
│   ├── ecs-service/              # API service, ALB
│   ├── cdn/                      # CloudFront, S3
│   ├── ecr/                      # Container registries
│   └── dns/                      # Route53, ACM certificate
└── environments/
    └── dev/                      # Dev environment
        ├── main.tf               # Module composition
        ├── variables.tf          # environment, domain_name
        ├── outputs.tf
        └── backend.tf
```

## Deployment to a New AWS Account

### Step 1: Create Route53 Hosted Zone (if not exists)

```bash
aws route53 create-hosted-zone --name yourdomain.com --caller-reference $(date +%s)
```

Update your domain registrar's nameservers to point to Route53.

### Step 2: Bootstrap Terraform State

```bash
cd infrastructure/terraform/bootstrap
terraform init
terraform apply
```

Note the output `state_bucket_name` for the next step.

### Step 3: Initialize Environment

```bash
cd infrastructure/terraform/environments/dev

# Initialize with your state bucket
terraform init -backend-config="bucket=workermill-terraform-state-YOUR_ACCOUNT_ID"
```

### Step 4: Plan and Apply

```bash
# Review the plan
terraform plan -var="domain_name=yourdomain.com"

# Apply
terraform apply -var="domain_name=yourdomain.com"
```

### Step 5: Update Secrets

After deployment, update placeholder secrets:

```bash
# Anthropic API Key
aws secretsmanager put-secret-value \
  --secret-id workermill/dev/anthropic-api-key \
  --secret-string "sk-ant-..."

# GitHub Token
aws secretsmanager put-secret-value \
  --secret-id workermill/dev/github-token \
  --secret-string "ghp_..."

# Jira Credentials
aws secretsmanager put-secret-value \
  --secret-id workermill/dev/jira-credentials \
  --secret-string '{"domain":"your-org.atlassian.net","email":"you@company.com","api_token":"..."}'
```

## Variables

Only two variables are required at the environment level:

| Variable | Required | Description |
|----------|----------|-------------|
| `environment` | No | Environment name (default: "dev") |
| `domain_name` | Yes | Domain with existing Route53 hosted zone |

## Cost Optimization

This configuration uses cost-optimized settings:

| Resource | Configuration | Est. Monthly |
|----------|--------------|--------------|
| RDS | db.t4g.micro, Single-AZ | ~$12 |
| ECS | Fargate Spot | ~$5-10 |
| NAT Gateway | Single | ~$32 |
| ALB | Minimum | ~$16 |
| CloudFront | PriceClass_100, 0 TTL | ~$1-5 |
| Logs | 14-day retention | ~$1 |

**Estimated Total: ~$70-80/month**

## Deploying Application Code

### Backend (API)

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $(terraform output -raw ecr_api_repository_url | cut -d/ -f1)

# Build and push
docker build -t api ./packages/api
docker tag api:latest $(terraform output -raw ecr_api_repository_url):latest
docker push $(terraform output -raw ecr_api_repository_url):latest

# Force new deployment
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw api_service_name) \
  --force-new-deployment
```

### Frontend

```bash
# Build
cd packages/dashboard
npm run build

# Upload to S3
aws s3 sync dist/ s3://$(terraform output -raw frontend_bucket_name)/ --delete

# Invalidate CloudFront (optional with 0 TTL)
aws cloudfront create-invalidation \
  --distribution-id $(terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```

## Adding a New Environment

To deploy to a new AWS account (e.g., company production):

1. Copy `environments/dev/` to `environments/company-prod/`
2. Update `variables.tf` default for `environment` to `"company-prod"`
3. Update `backend.tf` key to `"workermill/company-prod/terraform.tfstate"`
4. Run bootstrap in new account
5. Run `terraform init` and `terraform apply` with new domain

## Destroying Infrastructure

```bash
# Disable deletion protection first
aws rds modify-db-instance \
  --db-instance-identifier workermill-dev \
  --no-deletion-protection

aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn $(aws elbv2 describe-load-balancers --names workermill-dev --query 'LoadBalancers[0].LoadBalancerArn' --output text) \
  --attributes Key=deletion_protection.enabled,Value=false

# Destroy
terraform destroy -var="domain_name=yourdomain.com"
```
