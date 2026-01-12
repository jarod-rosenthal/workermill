# Kaniko Docker Build Implementation Plan

> Enable AI workers to build and push Docker images without requiring privileged containers.

## Implementation Status: COMPLETE

All phases have been implemented:
- [x] Phase 1: Add Kaniko to Worker Dockerfile
- [x] Phase 2: Add AWS CLI to Worker
- [x] Phase 3: Create deployment execution scripts
- [x] Phase 4: Update Dockerfile verification
- [x] Phase 5: Update Terraform task role for ECR
- [x] Phase 6: Update orchestrator env var passthrough

**Next steps:** Run `terraform apply` to update IAM permissions, then deploy worker image.

## Overview

Workers running in ECS Fargate cannot use Docker-in-Docker (DinD) because Fargate doesn't support privileged containers. Kaniko solves this by building images in userspace without requiring a Docker daemon.

## Why Kaniko?

| Approach | Pros | Cons |
|----------|------|------|
| Docker-in-Docker | Familiar workflow | Requires privileged mode (not supported in Fargate) |
| Kaniko | Works unprivileged, secure, fast | Different build syntax, ~100MB image size |
| AWS CodeBuild | AWS-native, full Docker support | Additional cost, complexity, latency |
| GitHub Actions | Already exists | Worker can't verify deployment |

**Kaniko is the best fit for ECS Fargate** - it's designed exactly for this use case.

## Implementation Phases

### Phase 1: Add Kaniko to Worker Container

**File: `worker/Dockerfile`**

```dockerfile
# Add after GitHub CLI installation

# Install Kaniko executor
# Note: We use the debug image which includes a shell for debugging
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/executor /kaniko/executor
ENV PATH="/kaniko:${PATH}"

# Create Kaniko config directory
RUN mkdir -p /kaniko/.docker
```

**Estimated size increase**: ~50-100MB

### Phase 2: ECR Authentication Setup

Workers need ECR credentials to push images. Two options:

#### Option A: ECS Task Role (Recommended)
- Task role already has permissions via IAM
- Kaniko auto-detects ECR and uses task role
- No additional secrets needed

**Required IAM permissions for task role:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:us-east-1:AWS_ACCOUNT_ID:repository/workermill-*"
    },
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    }
  ]
}
```

#### Option B: Docker Config Secret
- Store ECR credentials in Secrets Manager
- Mount as `/kaniko/.docker/config.json`
- More complex but works for cross-account pushes

### Phase 3: Create Deployment Execution Scripts

**File: `worker/execution/deploy/build_and_push.ts`**

```typescript
/**
 * Build and push Docker image using Kaniko
 *
 * Environment variables:
 * - DOCKER_REGISTRY: ECR registry URL (e.g., AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/app)
 * - DOCKERFILE_PATH: Path to Dockerfile (default: ./Dockerfile)
 * - BUILD_CONTEXT: Build context path (default: .)
 * - IMAGE_TAG: Tag for the image (default: git short SHA)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

const registry = process.env.DOCKER_REGISTRY;
const dockerfile = process.env.DOCKERFILE_PATH || "./Dockerfile";
const context = process.env.BUILD_CONTEXT || ".";
const tag = process.env.IMAGE_TAG || execSync("git rev-parse --short HEAD").toString().trim();

if (!registry) {
  console.error("ERROR: DOCKER_REGISTRY not set");
  process.exit(1);
}

if (!existsSync(dockerfile)) {
  console.error(`ERROR: Dockerfile not found at ${dockerfile}`);
  process.exit(1);
}

const destination = `${registry}:${tag}`;
console.log(`Building image: ${destination}`);

// Run Kaniko
const kanikoCmd = [
  "/kaniko/executor",
  `--dockerfile=${dockerfile}`,
  `--context=${context}`,
  `--destination=${destination}`,
  "--cache=true",
  "--cache-ttl=24h",
].join(" ");

try {
  execSync(kanikoCmd, { stdio: "inherit" });
  console.log(`Successfully pushed: ${destination}`);
  console.log(`::image_pushed::${destination}`);
} catch (error) {
  console.error("Kaniko build failed:", error);
  process.exit(1);
}
```

**File: `worker/execution/deploy/deploy_ecs.ts`**

```typescript
/**
 * Deploy to ECS by forcing a new deployment
 *
 * Environment variables:
 * - CLUSTER_NAME: ECS cluster name
 * - SERVICE_NAME: ECS service name
 * - AWS_REGION: AWS region (default: us-east-1)
 */

import { execSync } from "child_process";

const cluster = process.env.CLUSTER_NAME;
const service = process.env.SERVICE_NAME;
const region = process.env.AWS_REGION || "us-east-1";

if (!cluster || !service) {
  console.error("ERROR: CLUSTER_NAME and SERVICE_NAME required");
  process.exit(1);
}

console.log(`Deploying ${service} to ${cluster}...`);

try {
  const result = execSync(
    `aws ecs update-service --cluster ${cluster} --service ${service} --force-new-deployment --region ${region}`,
    { encoding: "utf-8" }
  );

  const response = JSON.parse(result);
  console.log(`Deployment initiated. Task definition: ${response.service.taskDefinition}`);
  console.log(`::deployment_started::${service}`);
} catch (error) {
  console.error("ECS deployment failed:", error);
  process.exit(1);
}
```

**File: `worker/execution/deploy/check_health.ts`**

```typescript
/**
 * Check deployment health endpoint
 *
 * Environment variables:
 * - HEALTH_CHECK_URL: URL to check
 * - HEALTH_CHECK_RETRIES: Number of retries (default: 10)
 * - HEALTH_CHECK_INTERVAL: Seconds between retries (default: 30)
 */

import https from "https";
import http from "http";

const url = process.env.HEALTH_CHECK_URL;
const maxRetries = parseInt(process.env.HEALTH_CHECK_RETRIES || "10");
const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL || "30") * 1000;

if (!url) {
  console.error("ERROR: HEALTH_CHECK_URL required");
  process.exit(1);
}

async function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log(`Checking health: ${url}`);

  for (let i = 0; i < maxRetries; i++) {
    const healthy = await checkHealth();
    if (healthy) {
      console.log("Health check passed!");
      console.log("::health_check::passed");
      process.exit(0);
    }

    console.log(`Attempt ${i + 1}/${maxRetries} failed, waiting ${interval / 1000}s...`);
    await new Promise((r) => setTimeout(r, interval));
  }

  console.error("Health check failed after all retries");
  console.log("::health_check::failed");
  process.exit(1);
}

main();
```

### Phase 4: Update Dockerfile Verification

Add to `worker/Dockerfile`:

```dockerfile
# Verify deploy scripts compiled
RUN test -f /app/execution-compiled/deploy/build_and_push.js && \
    test -f /app/execution-compiled/deploy/deploy_ecs.js && \
    test -f /app/execution-compiled/deploy/check_health.js && \
    echo "Deploy scripts compiled successfully!"
```

### Phase 5: Add AWS CLI to Worker

Workers need AWS CLI for ECS deployments:

```dockerfile
# Install AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws
```

### Phase 6: Update Terraform Task Role

**File: `infrastructure/terraform/modules/ecs/iam.tf`**

Add ECR push permissions to worker task role:

```hcl
resource "aws_iam_role_policy" "worker_ecr_push" {
  name = "${var.project}-worker-ecr-push"
  role = aws_iam_role.worker_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/${var.project}-*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.project}-*"
      }
    ]
  })
}
```

### Phase 7: Environment Variable Passthrough

Update orchestrator to pass deployment env vars to workers:

```typescript
// In spawnEcsTask()
const deploymentEnvVars = task.deploymentEnabled ? [
  { name: "DOCKER_REGISTRY", value: org.dockerRegistry || "" },
  { name: "CLUSTER_NAME", value: org.ecsCluster || "workermill-dev" },
  { name: "SERVICE_NAME", value: task.targetService || "" },
  { name: "HEALTH_CHECK_URL", value: org.healthCheckUrl || "" },
] : [];
```

## Testing Plan

1. **Local Test**: Build worker image locally, verify Kaniko is installed
2. **ECR Auth Test**: Run worker, verify it can authenticate to ECR
3. **Build Test**: Create test Dockerfile, verify Kaniko can build it
4. **Push Test**: Verify image appears in ECR
5. **Deploy Test**: Trigger ECS deployment, verify service updates
6. **Health Test**: Verify health check script works

## Rollout Plan

1. Deploy updated worker image with Kaniko (no behavior change yet)
2. Add IAM permissions via Terraform
3. Test with a single task using `deploy` label
4. Monitor for issues
5. Enable for all deployment tasks

## Estimated Effort

| Phase | Complexity | Time |
|-------|-----------|------|
| Phase 1: Dockerfile update | Low | - |
| Phase 2: IAM permissions | Low | - |
| Phase 3: Execution scripts | Medium | - |
| Phase 4-5: Dockerfile verification | Low | - |
| Phase 6: Terraform updates | Medium | - |
| Phase 7: Orchestrator updates | Low | - |
| Testing | Medium | - |

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Kaniko build failures | Medium | Add detailed logging, fallback to manual |
| ECR auth issues | Low | Test IAM role thoroughly before rollout |
| Image size increase | Certain | Accept ~100MB increase, monitor |
| Build cache issues | Low | Use ECR as cache backend |

## Dependencies

- ECR repositories must exist for target applications
- ECS task role must have ECR push permissions
- Target services must have health endpoints
- AWS CLI v2 must be installed in worker

## Future Enhancements

1. **Multi-arch builds**: Use Kaniko's `--customPlatform` for ARM64
2. **Build caching**: Use ECR as remote cache for faster builds
3. **Parallel builds**: Build multiple images concurrently
4. **Dockerfile linting**: Add hadolint before build
5. **Security scanning**: Integrate Trivy for vulnerability scanning

## References

- [Kaniko GitHub](https://github.com/GoogleContainerTools/kaniko)
- [Kaniko in ECS](https://aws.amazon.com/blogs/containers/building-container-images-on-amazon-ecs-on-aws-fargate/)
- [ECR Authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)
