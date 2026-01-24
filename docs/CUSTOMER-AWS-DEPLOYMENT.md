# Secure Multi-Cloud Customer Deployments

This document describes WorkerMill's architecture for securely deploying to customer AWS accounts using cross-account IAM role assumption.

## Overview

WorkerMill workers can deploy to customer AWS infrastructure without storing long-term credentials. Instead, customers create an IAM role in their account that trusts WorkerMill, and workers assume that role temporarily for deployments.

**Benefits:**
- No long-term credentials to rotate
- Confused deputy protection via External IDs
- Customer controls their own permissions
- AWS Marketplace compliant
- Industry standard (used by Datadog, Terraform Cloud, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKERMILL PLATFORM                       │
│                                                              │
│  Settings UI → API → Secrets Manager                         │
│                       (stores roleArn + externalId)          │
│                              │                               │
│                              ▼                               │
│  Orchestrator fetches customer config                        │
│                              │                               │
│                              ▼                               │
│  ECS Task Runner injects env vars:                           │
│  - CUSTOMER_AWS_ROLE_ARN                                     │
│  - CUSTOMER_AWS_EXTERNAL_ID                                  │
│  - CUSTOMER_AWS_REGION                                       │
│                              │                               │
│                              ▼                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  WORKER CONTAINER (minimal permissions)                 │ │
│  │                                                         │ │
│  │  Deploy script calls:                                   │ │
│  │  aws sts assume-role --role-arn $CUSTOMER_AWS_ROLE_ARN │ │
│  │                       --external-id $CUSTOMER_AWS_...   │ │
│  │                                                         │ │
│  │  Gets temporary credentials (1 hour)                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ STS AssumeRole
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 CUSTOMER AWS ACCOUNT                         │
│                                                              │
│  IAM Role: workermill-customer-*                             │
│  - Trusts: WorkerMill's worker task role                     │
│  - Condition: ExternalId must match                          │
│  - Permissions: ECR, ECS, S3, CloudFront (customer controls) │
│                                                              │
│  Customer Infrastructure:                                    │
│  - ECS Clusters/Services                                     │
│  - ECR Repositories                                          │
│  - S3 Buckets                                                │
│  - CloudFront Distributions                                  │
└─────────────────────────────────────────────────────────────┘
```

## Security Model

### Worker Permission Layers

WorkerMill uses two distinct IAM roles for workers:

| Role | Purpose | Permissions |
|------|---------|-------------|
| `workermill-{env}-ecs-task` | API service | Full platform access (secrets, ECR, ECS, S3) |
| `workermill-{env}-worker-task` | Worker containers | Minimal: CloudWatch logs + STS AssumeRole only |

Workers **cannot**:
- Access WorkerMill platform secrets (`workermill/{env}/*`)
- Push to WorkerMill ECR repositories
- Modify WorkerMill ECS services
- Access WorkerMill S3 buckets

Workers **can only**:
- Write to their own CloudWatch log stream
- Assume customer IAM roles (with external ID validation)

### External ID Protection

External IDs prevent confused deputy attacks. Each organization gets a unique external ID:

```
Format: workermill-{orgId}-{random32hex}
Example: workermill-org_abc123-f47ac10b58cc4372a5670e02b2c3d479
```

The customer's IAM role trust policy requires this external ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-dev-worker-task"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "workermill-org_abc123-f47ac10b58cc4372a5670e02b2c3d479"
      }
    }
  }]
}
```

This ensures only the specific WorkerMill organization can assume the role, even if an attacker knows the role ARN.

## Customer Setup

### Option 1: CloudFormation (Recommended)

1. Go to **WorkerMill Settings > AWS Integration**
2. Copy your **External ID**
3. Click **Launch CloudFormation Stack** or deploy manually:

```bash
aws cloudformation create-stack \
  --stack-name workermill-deployment \
  --template-body file://docs/templates/workermill-customer-role.yaml \
  --parameters ParameterKey=ExternalId,ParameterValue=YOUR_EXTERNAL_ID \
  --capabilities CAPABILITY_NAMED_IAM
```

4. Copy the **Role ARN** from CloudFormation outputs
5. Paste into WorkerMill Settings and click **Save**
6. Click **Test Connection** to verify

### Option 2: Manual IAM Role Creation

1. Create an IAM role with this trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-dev-worker-task"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "YOUR_EXTERNAL_ID_FROM_WORKERMILL"
      }
    }
  }]
}
```

2. Attach a policy with permissions for your infrastructure:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:*:YOUR_ACCOUNT:repository/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-frontend-bucket",
        "arn:aws:s3:::your-frontend-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "*"
    }
  ]
}
```

3. Name the role with prefix `workermill-customer-` (e.g., `workermill-customer-production`)
4. Configure in WorkerMill Settings

## API Reference

### Get External ID

```
GET /api/settings/integrations/aws/external-id
```

Returns the organization's unique external ID for AWS role trust policies.

**Response:**
```json
{
  "externalId": "workermill-org_abc123-f47ac10b58cc4372a5670e02b2c3d479",
  "usage": "Add this External ID as a condition in your IAM role's trust policy",
  "trustPolicyExample": { ... }
}
```

### Get Role Configuration

```
GET /api/settings/integrations/aws/role
```

Returns the current AWS role configuration.

**Response:**
```json
{
  "configured": true,
  "externalId": "workermill-org_abc123-...",
  "roleArn": "arn:aws:iam::123456789012:role/workermill-customer-prod",
  "region": "us-east-1",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### Save Role Configuration

```
PUT /api/settings/integrations/aws/role
```

**Request:**
```json
{
  "roleArn": "arn:aws:iam::123456789012:role/workermill-customer-prod",
  "region": "us-east-1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "AWS role configuration saved",
  "config": {
    "roleArn": "arn:aws:iam::123456789012:role/workermill-customer-prod",
    "externalId": "workermill-org_abc123-...",
    "region": "us-east-1"
  },
  "nextSteps": [...]
}
```

### Test Role Assumption

```
POST /api/settings/integrations/aws/role/test
```

Attempts to assume the configured role and returns the result.

**Success Response:**
```json
{
  "success": true,
  "message": "Successfully assumed customer role",
  "assumedRole": {
    "arn": "arn:aws:sts::123456789012:assumed-role/workermill-customer-prod/workermill-test-abc123",
    "assumedAt": "2024-01-15T10:35:00Z",
    "expiresAt": "2024-01-15T10:50:00Z"
  }
}
```

**Failure Response:**
```json
{
  "error": "Failed to assume role: Access Denied",
  "hint": "Check that the role's trust policy includes WorkerMill's worker role and the correct external ID",
  "roleArn": "arn:aws:iam::123456789012:role/workermill-customer-prod",
  "externalId": "workermill-org_abc123-..."
}
```

## Worker Environment Variables

When customer AWS configuration is set, workers receive these environment variables:

| Variable | Description |
|----------|-------------|
| `CUSTOMER_AWS_ROLE_ARN` | Customer's IAM role ARN to assume |
| `CUSTOMER_AWS_EXTERNAL_ID` | External ID for role assumption |
| `CUSTOMER_AWS_REGION` | AWS region for customer infrastructure |

## Deployment Script Integration

Deployment scripts automatically detect and use customer credentials:

```typescript
import { hasCustomerAwsConfig, setCustomerAwsEnvVars } from "../lib/cloud-credentials.js";

async function main() {
  // If customer AWS is configured, assume their role
  if (hasCustomerAwsConfig()) {
    await setCustomerAwsEnvVars();
    // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN now set
  }

  // AWS CLI commands now use customer credentials
  execSync("aws ecs update-service ...");
}
```

The `cloud-credentials` library provides:

| Function | Description |
|----------|-------------|
| `hasCustomerAwsConfig()` | Check if customer role is configured |
| `assumeCustomerRole()` | Assume role and return credentials |
| `setCustomerAwsEnvVars()` | Set AWS_* environment variables |
| `getCustomerAwsSdkCredentials()` | Get credentials for AWS SDK clients |
| `createCustomerAwsClient(ClientClass)` | Factory for configured AWS clients |

## OnCallShift (Same-Account) Setup

For oncallshift, which shares the same AWS account as WorkerMill, a pre-configured customer role is created automatically by Terraform.

### Role Created

```
arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-customer-oncallshift-dev
```

### Permissions Included

| Service | Access Level | Resources |
|---------|--------------|-----------|
| ECR | Full | `oncallshift-*`, `pagerduty-lite-*` repos |
| ECS | Full | `oncallshift-*`, `pagerduty-lite-*` clusters/services/tasks |
| S3 | Full | `oncallshift-*`, `pagerduty-lite-*` buckets |
| CloudFront | Full | All distributions |
| Secrets Manager | Read/Write | `oncallshift/*`, `pagerduty-lite/*` |
| SSM Parameters | Read/Write | `oncallshift/*`, `pagerduty-lite/*` |
| CloudWatch Logs | Full | `/ecs/oncallshift-*`, `/ecs/pagerduty-lite-*` |
| IAM | PassRole | `oncallshift-*`, `pagerduty-lite-*` roles |
| Route53 | Modify | All hosted zones |
| ACM | Read | All certificates |
| ELB | Modify | All load balancers |
| RDS | Describe | All instances |

### Configuration Steps

After running `terraform apply`:

1. Get the role ARN from Terraform output:
   ```bash
   cd infrastructure/terraform/environments/prod
   terraform output oncallshift_customer_role_arn
   ```

2. Configure in WorkerMill Settings:
   - Go to **Settings > AWS Integration**
   - Enter the Role ARN
   - Enter your External ID (shown on the same page)
   - Click **Save**

3. Test the connection:
   - Click **Test Connection**
   - Should show "Successfully assumed customer role"

### Why a Separate Role?

Even though oncallshift is in the same AWS account, using a separate customer role:
- **Isolates permissions**: Workers can't access WorkerMill platform resources
- **Follows the same pattern**: Consistent with external customer deployments
- **Enables auditing**: CloudTrail shows distinct assumed-role sessions
- **Simplifies security**: Worker container has minimal permissions

## File Reference

| File | Purpose |
|------|---------|
| `infrastructure/terraform/modules/ecs-cluster/main.tf` | Minimal worker IAM role + oncallshift customer role |
| `api/src/services/external-id.ts` | External ID generation and storage |
| `api/src/routes/settings.ts` | AWS role configuration endpoints |
| `api/src/services/orchestrator.ts` | Fetch customer credentials |
| `api/src/services/ecs-task-runner.ts` | Inject credentials to workers |
| `worker/execution/lib/cloud-credentials.ts` | Role assumption helper |
| `worker/execution/deploy/deploy_ecs.ts` | ECS deployment with customer creds |
| `worker/execution/deploy/deploy_frontend.ts` | S3/CloudFront with customer creds |
| `worker/execution/deploy/build_container.ts` | ECR push with customer creds |
| `docs/templates/workermill-customer-role.yaml` | CloudFormation template |

## Troubleshooting

### "Access Denied" when testing connection

1. Verify the role ARN is correct
2. Check the trust policy includes `arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-dev-worker-task`
3. Confirm the External ID matches exactly (copy-paste from WorkerMill)
4. Ensure the role exists in the correct AWS account

### "Role does not exist"

1. Verify the role was created successfully (check CloudFormation stack status)
2. Confirm you're using the correct AWS account
3. Check for typos in the role name

### Deployments fail with permission errors

1. Check the role has the required permissions (ECR, ECS, S3, CloudFront)
2. Verify resource ARNs in the policy match your infrastructure
3. Review CloudTrail logs for specific denied actions

### Credentials expire during long deployments

Assumed role credentials last 1 hour. For deployments longer than 1 hour:
1. The `cloud-credentials` library automatically refreshes credentials
2. If issues persist, contact WorkerMill support

## Security Best Practices

1. **Scope permissions narrowly**: Use resource prefixes in the CloudFormation template
2. **Rotate External IDs**: If you suspect compromise, regenerate via WorkerMill Settings
3. **Monitor CloudTrail**: Enable logging for the assumed role sessions
4. **Use separate roles per environment**: Create distinct roles for dev/staging/production
5. **Review permissions regularly**: Audit the role policy against actual usage
