#!/bin/bash
set -e

# WorkerMill Deployment Script
# This script handles deploying both the API (ECS) and Frontend (S3/CloudFront)
# Supports multiple environments via --env flag

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration (production)
AWS_REGION="us-east-1"
ECR_REGISTRY="593971626975.dkr.ecr.us-east-1.amazonaws.com"

# Environment-specific configuration
declare -A ENV_CONFIG

# Production environment (default) - uses "dev" resource names due to historical naming
ENV_CONFIG[prod_ecr_api_repo]="workermill-dev/api"
ENV_CONFIG[prod_ecr_worker_repo]="workermill-dev/worker"
ENV_CONFIG[prod_ecs_cluster]="workermill-dev"
ENV_CONFIG[prod_ecs_service]="workermill-dev-api"
ENV_CONFIG[prod_s3_bucket]="workermill-dev-frontend-593971626975"
ENV_CONFIG[prod_cloudfront]="E15CA3N5TI2ZR2"
ENV_CONFIG[prod_url]="https://workermill.com"
ENV_CONFIG[prod_tf_dir]="infrastructure/terraform/environments/prod"

# Development environment - uses "sandbox" resource names
ENV_CONFIG[dev_ecr_api_repo]="workermill-sandbox/api"
ENV_CONFIG[dev_ecr_worker_repo]="workermill-sandbox/worker"
ENV_CONFIG[dev_ecs_cluster]="workermill-sandbox"
ENV_CONFIG[dev_ecs_service]="workermill-sandbox-api"
ENV_CONFIG[dev_s3_bucket]="workermill-sandbox-frontend-593971626975"
ENV_CONFIG[dev_cloudfront]="E12RYV9AUPXT90"
ENV_CONFIG[dev_url]="https://dev.workermill.com"
ENV_CONFIG[dev_tf_dir]="infrastructure/terraform/environments/dev"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
DEPLOY_API=false
DEPLOY_WORKER=false
DEPLOY_FRONTEND=false
SKIP_BUILD=false
ENVIRONMENT="prod"  # Default to production

# Function to show usage
show_help() {
    echo "Usage: ./deploy.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --api         Deploy API to ECS"
    echo "  --worker      Deploy Worker image to ECR"
    echo "  --frontend    Deploy Frontend to S3/CloudFront"
    echo "  --all         Deploy API, Worker, and Frontend"
    echo "  --env ENV     Environment: 'prod' (default) or 'dev'"
    echo "  --skip-build  Skip the build step (use existing builds)"
    echo "  --help        Show this help message"
    echo ""
    echo "Environments:"
    echo "  prod          Production at workermill.com (default)"
    echo "  dev           Development at dev.workermill.com"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh --all                    # Deploy everything to production"
    echo "  ./deploy.sh --api --env dev          # Deploy API to development"
    echo "  ./deploy.sh --frontend --env prod    # Deploy frontend to production"
    echo "  ./deploy.sh --all --env dev          # Deploy everything to development"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api)
            DEPLOY_API=true
            shift
            ;;
        --worker)
            DEPLOY_WORKER=true
            shift
            ;;
        --frontend)
            DEPLOY_FRONTEND=true
            shift
            ;;
        --all)
            DEPLOY_API=true
            DEPLOY_WORKER=true
            DEPLOY_FRONTEND=true
            shift
            ;;
        --env)
            ENVIRONMENT="$2"
            if [[ "$ENVIRONMENT" != "prod" && "$ENVIRONMENT" != "dev" ]]; then
                echo -e "${RED}Invalid environment: $ENVIRONMENT${NC}"
                echo "Valid environments: prod, dev"
                exit 1
            fi
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --help)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set environment-specific variables
ECR_API_REPO="${ENV_CONFIG[${ENVIRONMENT}_ecr_api_repo]}"
ECR_WORKER_REPO="${ENV_CONFIG[${ENVIRONMENT}_ecr_worker_repo]}"
ECS_CLUSTER="${ENV_CONFIG[${ENVIRONMENT}_ecs_cluster]}"
ECS_SERVICE="${ENV_CONFIG[${ENVIRONMENT}_ecs_service]}"
S3_BUCKET="${ENV_CONFIG[${ENVIRONMENT}_s3_bucket]}"
CLOUDFRONT_DISTRIBUTION="${ENV_CONFIG[${ENVIRONMENT}_cloudfront]}"
APP_URL="${ENV_CONFIG[${ENVIRONMENT}_url]}"
TF_DIR="${ENV_CONFIG[${ENVIRONMENT}_tf_dir]}"

# If no options specified, show help
if [[ "$DEPLOY_API" == "false" && "$DEPLOY_WORKER" == "false" && "$DEPLOY_FRONTEND" == "false" ]]; then
    echo -e "${YELLOW}No deployment target specified. Use --api, --worker, --frontend, or --all${NC}"
    echo "Use --help for usage information"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}    WorkerMill Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Environment: ${ENVIRONMENT}${NC}"
echo -e "${CYAN}Target URL:  ${APP_URL}${NC}"
echo ""

# Warning for production deployments
if [[ "$ENVIRONMENT" == "prod" ]]; then
    echo -e "${YELLOW}⚠️  PRODUCTION DEPLOYMENT${NC}"
    echo -e "${YELLOW}This will deploy to the live production environment.${NC}"
    echo ""
fi

# Function to validate migrations are registered
validate_migrations() {
    echo -e "${YELLOW}Validating database migrations...${NC}"

    cd "$SCRIPT_DIR/api"

    # Get all migration files (exclude index files)
    MIGRATION_FILES=$(ls src/db/migrations/*.ts 2>/dev/null | grep -v index | xargs -I {} basename {} .ts)

    # Check each migration is registered in connection.ts
    MISSING=""
    for migration in $MIGRATION_FILES; do
        # Convert filename to expected import format (replace hyphens, check for .js extension)
        if ! grep -q "${migration}.js" src/db/connection.ts; then
            MISSING="$MISSING\n  - $migration"
        fi
    done

    if [[ -n "$MISSING" ]]; then
        echo -e "${RED}ERROR: Unregistered migrations found!${NC}"
        echo -e "${RED}The following migrations exist but are NOT registered in connection.ts:${NC}"
        echo -e "${RED}$MISSING${NC}"
        echo ""
        echo -e "${YELLOW}To fix: Add the import and register in api/src/db/connection.ts:${NC}"
        echo -e "${YELLOW}  1. Add: import { MigrationName } from \"./migrations/filename.js\";${NC}"
        echo -e "${YELLOW}  2. Add to migrations array: MigrationName,${NC}"
        echo ""
        exit 1
    fi

    echo -e "${GREEN}All migrations registered ✓${NC}"
    cd "$SCRIPT_DIR"
}

# Function to deploy API
deploy_api() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying API to ECS (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    # Validate migrations before deploying
    validate_migrations

    cd "$SCRIPT_DIR/api"

    if [[ "$SKIP_BUILD" == "false" ]]; then
        echo -e "${YELLOW}Building API...${NC}"
        npm run build
        if [[ $? -ne 0 ]]; then
            echo -e "${RED}API build failed!${NC}"
            exit 1
        fi
        echo -e "${GREEN}API build successful${NC}"
    fi

    echo -e "${YELLOW}Logging into ECR...${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

    echo -e "${YELLOW}Building Docker image (no cache)...${NC}"
    docker build --no-cache -t $ECR_API_REPO:latest .

    echo -e "${YELLOW}Tagging image...${NC}"
    docker tag $ECR_API_REPO:latest $ECR_REGISTRY/$ECR_API_REPO:latest

    echo -e "${YELLOW}Pushing to ECR...${NC}"
    PUSH_OUTPUT=$(docker push $ECR_REGISTRY/$ECR_API_REPO:latest 2>&1)
    echo "$PUSH_OUTPUT"

    # Extract digest from push output
    API_DIGEST=$(echo "$PUSH_OUTPUT" | grep -o 'sha256:[a-f0-9]*' | head -1)
    if [[ -z "$API_DIGEST" ]]; then
        echo -e "${RED}Failed to extract image digest from push output${NC}"
        exit 1
    fi
    echo -e "${GREEN}Image digest: $API_DIGEST${NC}"

    # Get current task definition
    echo -e "${YELLOW}Creating new task definition with image digest...${NC}"
    TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition ${ECS_CLUSTER}-api \
        --region $AWS_REGION \
        --query 'taskDefinition' \
        --output json)

    # Update the image in the container definition to use digest
    NEW_IMAGE="$ECR_REGISTRY/$ECR_API_REPO@$API_DIGEST"
    NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "$NEW_IMAGE" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) |
        .containerDefinitions[0].image = $IMAGE
    ')

    # Register new task definition (use temp file for Windows/Git Bash compatibility)
    TASK_DEF_FILE=$(mktemp)
    echo "$NEW_TASK_DEF" > "$TASK_DEF_FILE"
    NEW_TASK_ARN=$(MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
        --cli-input-json "file://$TASK_DEF_FILE" \
        --region $AWS_REGION \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)
    rm -f "$TASK_DEF_FILE"

    echo -e "${GREEN}Registered new task definition: $NEW_TASK_ARN${NC}"

    echo -e "${YELLOW}Updating ECS service with new task definition...${NC}"
    aws ecs update-service \
        --cluster $ECS_CLUSTER \
        --service $ECS_SERVICE \
        --task-definition "$NEW_TASK_ARN" \
        --region $AWS_REGION \
        --output text > /dev/null

    echo -e "${GREEN}API deployment initiated!${NC}"
    echo -e "${GREEN}Image: $NEW_IMAGE${NC}"
    echo -e "${YELLOW}Note: ECS deployment takes 2-5 minutes to complete${NC}"

    cd "$SCRIPT_DIR"
}

# Function to deploy worker image
deploy_worker() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying Worker Image to ECR (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    cd "$SCRIPT_DIR/worker"

    echo -e "${YELLOW}Logging into ECR...${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

    echo -e "${YELLOW}Building Docker image (no cache)...${NC}"
    docker build --no-cache -t $ECR_WORKER_REPO:latest .

    echo -e "${YELLOW}Tagging image...${NC}"
    docker tag $ECR_WORKER_REPO:latest $ECR_REGISTRY/$ECR_WORKER_REPO:latest

    echo -e "${YELLOW}Pushing to ECR...${NC}"
    PUSH_OUTPUT=$(docker push $ECR_REGISTRY/$ECR_WORKER_REPO:latest 2>&1)
    echo "$PUSH_OUTPUT"

    # Extract digest from push output
    WORKER_DIGEST=$(echo "$PUSH_OUTPUT" | grep -o 'sha256:[a-f0-9]*' | head -1)
    if [[ -z "$WORKER_DIGEST" ]]; then
        echo -e "${RED}Failed to extract image digest from push output${NC}"
        exit 1
    fi
    echo -e "${GREEN}Image digest: $WORKER_DIGEST${NC}"

    # Get current task definition
    echo -e "${YELLOW}Creating new task definition with image digest...${NC}"
    TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition ${ECS_CLUSTER}-worker \
        --region $AWS_REGION \
        --query 'taskDefinition' \
        --output json)

    # Update the image in the container definition to use digest
    NEW_IMAGE="$ECR_REGISTRY/$ECR_WORKER_REPO@$WORKER_DIGEST"
    NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "$NEW_IMAGE" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) |
        .containerDefinitions[0].image = $IMAGE
    ')

    # Register new task definition (use temp file for Windows/Git Bash compatibility)
    TASK_DEF_FILE=$(mktemp)
    echo "$NEW_TASK_DEF" > "$TASK_DEF_FILE"
    NEW_TASK_ARN=$(MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
        --cli-input-json "file://$TASK_DEF_FILE" \
        --region $AWS_REGION \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)
    rm -f "$TASK_DEF_FILE"

    echo -e "${GREEN}Registered new task definition: $NEW_TASK_ARN${NC}"
    echo -e "${GREEN}Worker image deployed!${NC}"
    echo -e "${GREEN}Image: $NEW_IMAGE${NC}"
    echo -e "${YELLOW}Note: New worker tasks will use the updated image${NC}"

    cd "$SCRIPT_DIR"
}

# Function to deploy frontend
deploy_frontend() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying Frontend to S3/CloudFront (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    # Check if CloudFront distribution is set
    if [[ -z "$CLOUDFRONT_DISTRIBUTION" ]]; then
        echo -e "${YELLOW}CloudFront distribution ID not set for ${ENVIRONMENT}.${NC}"
        echo -e "${YELLOW}Run 'terraform output cloudfront_distribution_id' in ${TF_DIR} to get the ID.${NC}"
        echo -e "${YELLOW}Then update this script with the distribution ID.${NC}"
        exit 1
    fi

    cd "$SCRIPT_DIR/frontend"

    if [[ "$SKIP_BUILD" == "false" ]]; then
        echo -e "${YELLOW}Building Frontend...${NC}"
        npm run build
        if [[ $? -ne 0 ]]; then
            echo -e "${RED}Frontend build failed!${NC}"
            exit 1
        fi
        echo -e "${GREEN}Frontend build successful${NC}"
    fi

    # Verify we're in the right directory and dist exists
    if [[ ! -d "dist" ]]; then
        echo -e "${RED}Error: dist directory not found in $(pwd)${NC}"
        echo -e "${RED}Make sure you're running from the project root and frontend is built${NC}"
        exit 1
    fi

    # Verify dist contains index.html (sanity check)
    if [[ ! -f "dist/index.html" ]]; then
        echo -e "${RED}Error: dist/index.html not found - this doesn't look like a frontend build${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Syncing to S3...${NC}"
    aws s3 sync dist/ s3://$S3_BUCKET/ --delete --region $AWS_REGION

    echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id $CLOUDFRONT_DISTRIBUTION \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text)

    echo -e "${GREEN}Frontend deployed!${NC}"
    echo -e "${YELLOW}CloudFront invalidation ID: $INVALIDATION_ID${NC}"
    echo -e "${YELLOW}Note: CloudFront invalidation takes 1-5 minutes to complete${NC}"

    cd "$SCRIPT_DIR"
}

# Execute deployments
if [[ "$DEPLOY_API" == "true" ]]; then
    deploy_api
fi

if [[ "$DEPLOY_WORKER" == "true" ]]; then
    deploy_worker
fi

if [[ "$DEPLOY_FRONTEND" == "true" ]]; then
    deploy_frontend
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}    Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Environment: ${CYAN}${ENVIRONMENT}${NC}"

if [[ "$DEPLOY_API" == "true" ]]; then
    echo -e "API Status: Check with: ${YELLOW}aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --query 'services[0].deployments' --output table${NC}"
fi

if [[ "$DEPLOY_FRONTEND" == "true" ]]; then
    echo -e "Frontend: ${APP_URL}"
fi
