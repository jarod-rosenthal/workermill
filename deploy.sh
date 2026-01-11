#!/bin/bash
set -e

# WorkerMill Deployment Script
# This script handles deploying both the API (ECS) and Frontend (S3/CloudFront)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="us-east-1"
ECR_REGISTRY="AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
ECR_REPO="workermill-dev-api"
ECS_CLUSTER="workermill-dev-cluster"
ECS_SERVICE="workermill-dev-api"
S3_BUCKET="workermill-dev-frontend-AWS_ACCOUNT_ID"
CLOUDFRONT_DISTRIBUTION="CLOUDFRONT_DIST_ID"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}    WorkerMill Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Parse arguments
DEPLOY_API=false
DEPLOY_FRONTEND=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --api)
            DEPLOY_API=true
            shift
            ;;
        --frontend)
            DEPLOY_FRONTEND=true
            shift
            ;;
        --all)
            DEPLOY_API=true
            DEPLOY_FRONTEND=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --help)
            echo "Usage: ./deploy.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --api         Deploy API to ECS"
            echo "  --frontend    Deploy Frontend to S3/CloudFront"
            echo "  --all         Deploy both API and Frontend"
            echo "  --skip-build  Skip the build step (use existing builds)"
            echo "  --help        Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./deploy.sh --all           # Build and deploy everything"
            echo "  ./deploy.sh --api           # Build and deploy API only"
            echo "  ./deploy.sh --frontend      # Build and deploy frontend only"
            echo "  ./deploy.sh --all --skip-build  # Deploy without rebuilding"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# If no options specified, show help
if [[ "$DEPLOY_API" == "false" && "$DEPLOY_FRONTEND" == "false" ]]; then
    echo -e "${YELLOW}No deployment target specified. Use --api, --frontend, or --all${NC}"
    echo "Use --help for usage information"
    exit 1
fi

# Function to deploy API
deploy_api() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying API to ECS${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

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

    echo -e "${YELLOW}Building Docker image...${NC}"
    docker build -t $ECR_REPO:latest .

    echo -e "${YELLOW}Tagging image...${NC}"
    docker tag $ECR_REPO:latest $ECR_REGISTRY/$ECR_REPO:latest

    echo -e "${YELLOW}Pushing to ECR...${NC}"
    docker push $ECR_REGISTRY/$ECR_REPO:latest

    echo -e "${YELLOW}Forcing new ECS deployment...${NC}"
    aws ecs update-service \
        --cluster $ECS_CLUSTER \
        --service $ECS_SERVICE \
        --force-new-deployment \
        --region $AWS_REGION \
        --output text > /dev/null

    echo -e "${GREEN}API deployment initiated!${NC}"
    echo -e "${YELLOW}Note: ECS deployment takes 2-5 minutes to complete${NC}"

    cd "$SCRIPT_DIR"
}

# Function to deploy frontend
deploy_frontend() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying Frontend to S3/CloudFront${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

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

if [[ "$DEPLOY_FRONTEND" == "true" ]]; then
    deploy_frontend
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}    Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

if [[ "$DEPLOY_API" == "true" ]]; then
    echo -e "API Status: Check with: ${YELLOW}aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --query 'services[0].deployments' --output table${NC}"
fi

if [[ "$DEPLOY_FRONTEND" == "true" ]]; then
    echo -e "Frontend: https://workermill.com"
fi
