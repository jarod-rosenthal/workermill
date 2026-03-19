#!/bin/bash
set -e

# WorkerMill Deployment Script
# This script handles deploying both the API (ECS) and Frontend (S3/CloudFront)

# Source login profile for non-interactive shells (CI, IDE tool calls).
# Infrastructure vars (WM_PROD_ECS_CLUSTER, etc.) are exported in ~/.profile.
[ -f "$HOME/.profile" ] && . "$HOME/.profile"
# Supports multiple environments via --env flag

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration (production)
AWS_REGION="us-east-1"

# Environment-specific configuration
declare -A ENV_CONFIG

# Production environment (default) - resource names from ~/.workermill/env
ENV_CONFIG[prod_ecs_cluster]="${WM_PROD_ECS_CLUSTER:?Set WM_PROD_ECS_CLUSTER in ~/.profile}"
ENV_CONFIG[prod_ecs_service]="${WM_PROD_ECS_SERVICE:?Set WM_PROD_ECS_SERVICE in ~/.profile}"
ENV_CONFIG[prod_s3_bucket]="${WM_PROD_S3_BUCKET:?Set WM_PROD_S3_BUCKET in ~/.profile}"
ENV_CONFIG[prod_cloudfront]="${PROD_CLOUDFRONT_ID:?Set PROD_CLOUDFRONT_ID in ~/.profile}"
ENV_CONFIG[prod_url]="https://workermill.com"
ENV_CONFIG[prod_tf_dir]="infrastructure/terraform/environments/prod"

# Development environment - resource names from ~/.workermill/env
ENV_CONFIG[dev_ecs_cluster]="${WM_DEV_ECS_CLUSTER:?Set WM_DEV_ECS_CLUSTER in ~/.profile}"
ENV_CONFIG[dev_ecs_service]="${WM_DEV_ECS_SERVICE:?Set WM_DEV_ECS_SERVICE in ~/.profile}"
ENV_CONFIG[dev_s3_bucket]="${WM_DEV_S3_BUCKET:?Set WM_DEV_S3_BUCKET in ~/.profile}"
ENV_CONFIG[dev_cloudfront]="${DEV_CLOUDFRONT_ID:?Set DEV_CLOUDFRONT_ID in ~/.profile}"
ENV_CONFIG[dev_url]="https://dev.workermill.com"
ENV_CONFIG[dev_tf_dir]="infrastructure/terraform/environments/dev"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
DEPLOY_API=false
DEPLOY_WORKER=false
DEPLOY_FRONTEND=false
PUBLISH_AGENT=false
SKIP_BUILD=false
WORKER_VERSION="latest"
API_VERSION="latest"
ENVIRONMENT="prod"  # Default to production

# Database/bastion feature flags
DB_CHECK=false
CHECK_MIGRATIONS=false
CREATE_SNAPSHOT=false
WAIT_FOR_DEPLOY=false
NO_BASTION_STOP=false

# Runtime state
SSH_TUNNEL_PID=""
BASTION_STARTED=false
BASTION_IP=""

# Function to show usage
show_help() {
    echo "Usage: ./deploy.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --api [version]    Update API + orchestrator ECS task definitions to GHCR image (default: latest)"
    echo "  --worker [version] Update Worker ECS task definition to GHCR image (default: latest)"
    echo "  --frontend         Deploy Frontend to S3/CloudFront"
    echo "  --all              Deploy API, Worker, and Frontend"
    echo "  --publish-agent    Build and publish @workermill/agent to npm"
    echo "  --env ENV          Environment: 'prod' (default) or 'dev'"
    echo "  --skip-build       Skip the build step (use existing builds)"
    echo "  --help             Show this help message"
    echo ""
    echo "Database/Bastion Options (requires psql, SSH key at ~/.ssh/workermill-bastion):"
    echo "  --db-check         Pre-deployment database health check"
    echo "  --check-migrations Show pending migrations count (without deploying)"
    echo "  --snapshot         Create RDS snapshot before deploying"
    echo "  --wait             Wait for ECS stability + health check after deploy"
    echo "  --no-bastion-stop  Keep bastion running after checks (for debugging)"
    echo ""
    echo "Environments:"
    echo "  prod               Production at workermill.com (default)"
    echo "  dev                Development at dev.workermill.com"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh --all                         # Deploy everything to production"
    echo "  ./deploy.sh --api --env dev               # Deploy API to development"
    echo "  ./deploy.sh --frontend --env prod         # Deploy frontend to production"
    echo "  ./deploy.sh --api --db-check              # Deploy API with DB health check"
    echo "  ./deploy.sh --api --check-migrations      # See pending migrations without deploying"
    echo "  ./deploy.sh --api --db-check --snapshot --wait  # Full safety deploy"
    echo ""
    echo "Notes:"
    echo "  - Bastion features add ~60-90s if bastion is cold, ~5s if warm"
    echo "  - RDS snapshots take ~5-10 minutes and cost ~\$0.05/GB/month"
    echo "  - Clean up old snapshots via AWS Console: RDS > Snapshots"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api)
            DEPLOY_API=true
            # Capture optional version argument (e.g., --api 0abcdef)
            if [[ -n "${2:-}" && ! "$2" =~ ^-- ]]; then
                API_VERSION="$2"
                shift 2
            else
                shift
            fi
            ;;
        --worker)
            DEPLOY_WORKER=true
            # Capture optional version argument (e.g., --worker 0.10.213)
            if [[ -n "${2:-}" && ! "$2" =~ ^-- ]]; then
                WORKER_VERSION="$2"
                shift 2
            else
                shift
            fi
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
        --publish-agent)
            PUBLISH_AGENT=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --db-check)
            DB_CHECK=true
            shift
            ;;
        --check-migrations)
            CHECK_MIGRATIONS=true
            shift
            ;;
        --snapshot)
            CREATE_SNAPSHOT=true
            shift
            ;;
        --wait)
            WAIT_FOR_DEPLOY=true
            shift
            ;;
        --no-bastion-stop)
            NO_BASTION_STOP=true
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
ECS_CLUSTER="${ENV_CONFIG[${ENVIRONMENT}_ecs_cluster]}"
ECS_SERVICE="${ENV_CONFIG[${ENVIRONMENT}_ecs_service]}"
S3_BUCKET="${ENV_CONFIG[${ENVIRONMENT}_s3_bucket]}"
CLOUDFRONT_DISTRIBUTION="${ENV_CONFIG[${ENVIRONMENT}_cloudfront]}"
APP_URL="${ENV_CONFIG[${ENVIRONMENT}_url]}"
TF_DIR="${ENV_CONFIG[${ENVIRONMENT}_tf_dir]}"

# RDS instance identifier (matches ECS cluster naming)
RDS_INSTANCE="${ECS_CLUSTER}"

# ============================================================================
# Bastion and Database Helper Functions
# ============================================================================

# Check if bastion features are needed
needs_bastion_features() {
    [[ "$DB_CHECK" == "true" || "$CHECK_MIGRATIONS" == "true" || "$CREATE_SNAPSHOT" == "true" ]]
}

# Check dependencies for bastion features
check_bastion_dependencies() {
    local missing=""

    if ! command -v psql &> /dev/null; then
        missing="$missing psql"
    fi

    if ! command -v jq &> /dev/null; then
        missing="$missing jq"
    fi

    if [[ ! -f ~/.ssh/workermill-bastion ]]; then
        missing="$missing ~/.ssh/workermill-bastion"
    fi

    if [[ -n "$missing" ]]; then
        echo -e "${RED}Missing dependencies for database features:${missing}${NC}"
        echo ""
        echo "Install missing dependencies:"
        echo "  - psql: sudo apt install postgresql-client (Ubuntu) or brew install postgresql (macOS)"
        echo "  - jq: sudo apt install jq (Ubuntu) or brew install jq (macOS)"
        echo "  - SSH key: See CLAUDE.md for bastion setup instructions"
        exit 1
    fi
}

# Invoke bastion Lambda
invoke_bastion() {
    local action="$1"
    local extra_payload="${2:-}"
    local response_file=$(mktemp)
    local payload="{\"action\":\"$action\"${extra_payload:+,$extra_payload}}"

    MSYS_NO_PATHCONV=1 aws lambda invoke --function-name "${WM_BASTION_LAMBDA:?Set WM_BASTION_LAMBDA in ~/.profile}" --payload "$payload" --cli-binary-format raw-in-base64-out --region "$AWS_REGION" "$response_file" > /dev/null 2>&1

    cat "$response_file"
    rm -f "$response_file"
}

# Start bastion if not running, wait for it to be ready
start_bastion_if_needed() {
    echo -e "${YELLOW}Checking bastion status...${NC}"

    # Detect IP once for whitelisting
    local my_ip=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null)
    local ip_payload=""
    if [[ -n "$my_ip" ]]; then
        ip_payload="\"ip\":\"$my_ip\""
        echo -e "${GREEN}Detected IP: $my_ip${NC}"
    else
        echo -e "${YELLOW}Warning: Could not detect public IP${NC}"
    fi

    local status_json=$(invoke_bastion "status")
    local current_state=$(echo "$status_json" | jq -r '.status // "unknown"')

    if [[ "$current_state" == "running" ]]; then
        BASTION_IP=$(echo "$status_json" | jq -r '.instances[0].public_ip // empty')
        if [[ -n "$BASTION_IP" ]]; then
            echo -e "${GREEN}Bastion already running at $BASTION_IP${NC}"
            # Whitelist via Lambda (not direct EC2 API)
            if [[ -n "$ip_payload" ]]; then
                invoke_bastion "whitelist" "$ip_payload" > /dev/null
                echo -e "${GREEN}IP whitelisted via Lambda${NC}"
            fi
            return 0
        fi
    fi

    echo -e "${YELLOW}Starting bastion (this takes ~60-90 seconds)...${NC}"
    invoke_bastion "start" "$ip_payload" > /dev/null
    BASTION_STARTED=true

    # Poll for bastion to be ready
    local max_attempts=18  # 90 seconds
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        sleep 5
        ((++attempt))

        status_json=$(invoke_bastion "status")
        current_state=$(echo "$status_json" | jq -r '.status // "unknown"')

        if [[ "$current_state" == "running" ]]; then
            BASTION_IP=$(echo "$status_json" | jq -r '.instances[0].public_ip // empty')
            if [[ -n "$BASTION_IP" ]]; then
                echo -e "${GREEN}Bastion ready at $BASTION_IP${NC}"
                return 0
            fi
        fi

        echo -e "${YELLOW}  Waiting for bastion... ($((attempt * 5))s)${NC}"
    done

    echo -e "${RED}Bastion failed to start within 90 seconds${NC}"
    exit 1
}

# Start SSH tunnel to RDS (with retries for sshd startup race)
start_ssh_tunnel() {
    if [[ -z "$BASTION_IP" ]]; then
        echo -e "${RED}Bastion IP not set - cannot start SSH tunnel${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Starting SSH tunnel to RDS...${NC}"

    # Extract RDS host from database-url secret (strip port if present)
    local rds_host=$(aws secretsmanager get-secret-value --secret-id "${WM_SECRETS_PREFIX}/database-url" --query 'SecretString' --output text --region "$AWS_REGION" 2>/dev/null | grep -o '@[^:/]*' | tr -d '@')

    if [[ -z "$rds_host" ]]; then
        echo -e "${RED}Failed to get RDS endpoint from secrets${NC}"
        exit 1
    fi

    # Retry loop: sshd may not be ready on freshly-booted spot instances
    local max_retries=3
    local retry=0

    while [[ $retry -lt $max_retries ]]; do
        ((++retry))

        # Start SSH tunnel in background (|| true prevents set -e exit on failure)
        ssh -f -N -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
            -i ~/.ssh/workermill-bastion \
            -L 5433:${rds_host}:5432 \
            ec2-user@${BASTION_IP} 2>/dev/null || true

        # Give it a moment to establish
        sleep 2

        # Find the SSH tunnel PID
        SSH_TUNNEL_PID=$(pgrep -f "ssh.*-L 5433.*${BASTION_IP}" | head -1)

        if [[ -n "$SSH_TUNNEL_PID" ]]; then
            # Verify tunnel is working
            if command -v nc &> /dev/null && nc -z localhost 5433 2>/dev/null; then
                echo -e "${GREEN}SSH tunnel established (PID: $SSH_TUNNEL_PID)${NC}"
                return 0
            fi
        fi

        if [[ $retry -lt $max_retries ]]; then
            echo -e "${YELLOW}  SSH tunnel attempt $retry/$max_retries failed, retrying in 5s...${NC}"
            # Kill any partial tunnel
            [[ -n "$SSH_TUNNEL_PID" ]] && kill "$SSH_TUNNEL_PID" 2>/dev/null || true
            SSH_TUNNEL_PID=""
            sleep 5
        fi
    done

    echo -e "${RED}Failed to establish SSH tunnel after $max_retries attempts${NC}"
    exit 1
}

# Stop SSH tunnel
stop_ssh_tunnel() {
    if [[ -n "$SSH_TUNNEL_PID" ]]; then
        kill "$SSH_TUNNEL_PID" 2>/dev/null || true
        SSH_TUNNEL_PID=""
        echo -e "${GREEN}SSH tunnel closed${NC}"
    fi
}

# Get database password from Secrets Manager
get_db_password() {
    aws secretsmanager get-secret-value \
        --secret-id "${WM_SECRETS_PREFIX}/database-url" \
        --query 'SecretString' --output text \
        --region "$AWS_REGION" \
        | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|'
}

# Check database health
check_database_health() {
    echo -e "${YELLOW}Checking database health...${NC}"

    local db_password=$(get_db_password)

    if PGPASSWORD="$db_password" psql -h localhost -U workermill -d workermill \
        -c "SELECT 1" > /dev/null 2>&1; then
        echo -e "${GREEN}Database health check passed ✓${NC}"
        return 0
    else
        echo -e "${RED}Database health check failed!${NC}"
        echo -e "${RED}Cannot connect to database via SSH tunnel${NC}"
        exit 1
    fi
}

# Check pending migrations
check_pending_migrations() {
    echo -e "${YELLOW}Checking pending migrations...${NC}"

    local db_password=$(get_db_password)

    # Count migrations registered in connection.ts
    local code_count=$(grep -E "^import.*from.*migrations" "$SCRIPT_DIR/api/src/db/connection.ts" | wc -l)

    # Count migrations applied in database
    local db_count=$(PGPASSWORD="$db_password" psql -h localhost -U workermill -d workermill \
        -t -c "SELECT COUNT(*) FROM migrations" 2>/dev/null | tr -d ' ')

    if [[ -z "$db_count" || "$db_count" == "" ]]; then
        echo -e "${RED}Failed to query migrations table${NC}"
        exit 1
    fi

    local pending=$((code_count - db_count))

    if [[ $pending -gt 0 ]]; then
        echo -e "${YELLOW}$pending pending migration(s) will run on deploy${NC}"
    elif [[ $pending -lt 0 ]]; then
        echo -e "${RED}Warning: Database has more migrations than code (${db_count} vs ${code_count})${NC}"
    else
        echo -e "${GREEN}No pending migrations ✓${NC}"
    fi

    echo -e "${CYAN}  Code migrations: $code_count${NC}"
    echo -e "${CYAN}  Applied in DB:   $db_count${NC}"
}

# Create RDS snapshot
create_rds_snapshot() {
    local snapshot_id="workermill-pre-deploy-$(date +%Y%m%d-%H%M%S)"

    echo -e "${YELLOW}Creating RDS snapshot: $snapshot_id${NC}"
    echo -e "${YELLOW}This may take 5-10 minutes...${NC}"

    aws rds create-db-snapshot \
        --db-instance-identifier "$RDS_INSTANCE" \
        --db-snapshot-identifier "$snapshot_id" \
        --region "$AWS_REGION" \
        --output text > /dev/null

    echo -e "${YELLOW}Waiting for snapshot to complete...${NC}"
    aws rds wait db-snapshot-available \
        --db-snapshot-identifier "$snapshot_id" \
        --region "$AWS_REGION"

    echo -e "${GREEN}Snapshot created: $snapshot_id ✓${NC}"
    echo -e "${CYAN}To delete later: aws rds delete-db-snapshot --db-snapshot-identifier $snapshot_id${NC}"
}

# Wait for deployment to complete and verify health
wait_for_deployment() {
    echo -e "${YELLOW}Waiting for ECS service to stabilize...${NC}"

    aws ecs wait services-stable \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_REGION"

    echo -e "${GREEN}ECS service stable ✓${NC}"

    echo -e "${YELLOW}Checking application health endpoint...${NC}"

    local max_attempts=12  # 60 seconds
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        if curl -sf "${APP_URL}/health/ready" > /dev/null 2>&1; then
            echo -e "${GREEN}Health check passed ✓${NC}"
            return 0
        fi

        ((++attempt))
        sleep 5
        echo -e "${YELLOW}  Waiting for health endpoint... ($((attempt * 5))s)${NC}"
    done

    echo -e "${RED}Health check failed after 60 seconds${NC}"
    echo -e "${RED}Check logs: aws logs tail /ecs/${ECS_CLUSTER}/api --follow${NC}"
    exit 1
}

# Cleanup function for trap
cleanup_bastion() {
    # Stop SSH tunnel if running
    if [[ -n "$SSH_TUNNEL_PID" ]]; then
        kill "$SSH_TUNNEL_PID" 2>/dev/null || true
        echo -e "${GREEN}SSH tunnel closed${NC}"
    fi

    # Stop bastion if we started it and user didn't request to keep it
    if [[ "$BASTION_STARTED" == "true" && "$NO_BASTION_STOP" != "true" ]]; then
        echo -e "${YELLOW}Stopping bastion...${NC}"
        invoke_bastion "stop" > /dev/null
        echo -e "${GREEN}Bastion stopped${NC}"
    fi
}

# Run pre-deployment database checks
run_pre_deploy_db_checks() {
    if ! needs_bastion_features; then
        return 0
    fi

    check_bastion_dependencies
    start_bastion_if_needed
    start_ssh_tunnel

    if [[ "$DB_CHECK" == "true" ]]; then
        check_database_health
    fi

    if [[ "$CHECK_MIGRATIONS" == "true" ]]; then
        check_pending_migrations
    fi

    if [[ "$CREATE_SNAPSHOT" == "true" ]]; then
        create_rds_snapshot
    fi

    stop_ssh_tunnel
}

# Set up cleanup trap
trap cleanup_bastion EXIT

# Handle --check-migrations without deployment (info-only mode)
if [[ "$CHECK_MIGRATIONS" == "true" && "$DEPLOY_API" == "false" && "$DEPLOY_WORKER" == "false" && "$DEPLOY_FRONTEND" == "false" ]]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}    Migration Check (no deployment)${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    check_bastion_dependencies
    start_bastion_if_needed
    start_ssh_tunnel
    check_pending_migrations
    stop_ssh_tunnel
    echo ""
    echo -e "${GREEN}Done. No deployment was performed.${NC}"
    exit 0
fi

# If no options specified, show help
if [[ "$DEPLOY_API" == "false" && "$DEPLOY_WORKER" == "false" && "$DEPLOY_FRONTEND" == "false" && "$PUBLISH_AGENT" == "false" ]]; then
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

# Function to deploy API image from GHCR
deploy_api() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Updating API Image (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}  (also updates self-hosted via GHCR :latest)${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    # Pre-deployment safety checks
    run_pre_deploy_db_checks
    validate_migrations

    # Wait for any in-progress Docker Images CI build so we deploy the latest code
    echo -e "${YELLOW}Checking for in-progress Docker image builds...${NC}"
    local MAX_WAIT=300
    local WAITED=0
    while [[ $WAITED -lt $MAX_WAIT ]]; do
        local STATUS=$(gh run list --workflow="Docker Images" --limit 1 --json status --jq '.[0].status' 2>/dev/null || echo "unknown")
        if [[ "$STATUS" == "completed" || "$STATUS" == "unknown" ]]; then
            break
        fi
        echo -e "${YELLOW}  Docker image build in progress, waiting... (${WAITED}s)${NC}"
        sleep 10
        WAITED=$((WAITED + 10))
    done

    local GHCR_IMAGE="ghcr.io/jarod-rosenthal/api"
    local FULL_IMAGE="${GHCR_IMAGE}:${API_VERSION}"

    echo -e "${YELLOW}Pulling GHCR image ${FULL_IMAGE}...${NC}"
    docker pull "$FULL_IMAGE" 2>&1

    API_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$FULL_IMAGE" 2>/dev/null | grep -o 'sha256:[a-f0-9]*')
    if [[ -z "$API_DIGEST" ]]; then
        echo -e "${RED}Failed to resolve digest for ${FULL_IMAGE}${NC}"
        exit 1
    fi
    echo -e "${GREEN}Image digest: $API_DIGEST${NC}"

    NEW_IMAGE="${GHCR_IMAGE}@${API_DIGEST}"

    # --- Update API task definition ---
    echo -e "${YELLOW}Updating API task definition...${NC}"
    TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition ${ECS_CLUSTER}-api \
        --region $AWS_REGION \
        --query 'taskDefinition' \
        --output json)

    NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "$NEW_IMAGE" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) |
        .containerDefinitions[0].image = $IMAGE
    ')

    TASK_DEF_FILE=$(mktemp)
    echo "$NEW_TASK_DEF" > "$TASK_DEF_FILE"
    NEW_TASK_ARN=$(MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
        --cli-input-json "file://$TASK_DEF_FILE" \
        --region $AWS_REGION \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)
    rm -f "$TASK_DEF_FILE"

    echo -e "${GREEN}Registered API task definition: $NEW_TASK_ARN${NC}"

    echo -e "${YELLOW}Updating API ECS service...${NC}"
    aws ecs update-service \
        --cluster $ECS_CLUSTER \
        --service $ECS_SERVICE \
        --task-definition "$NEW_TASK_ARN" \
        --region $AWS_REGION \
        --output text > /dev/null

    echo -e "${GREEN}API deployment initiated!${NC}"
    echo -e "${GREEN}Image: $NEW_IMAGE${NC}"

    # --- Update Orchestrator task definition (same image) ---
    ORCHESTRATOR_SERVICE="${ECS_CLUSTER}-orchestrator"
    if aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ORCHESTRATOR_SERVICE" --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        echo -e "${YELLOW}Updating orchestrator task definition...${NC}"
        ORCH_TASK_DEF=$(aws ecs describe-task-definition \
            --task-definition ${ECS_CLUSTER}-orchestrator \
            --region $AWS_REGION \
            --query 'taskDefinition' \
            --output json)

        NEW_ORCH_TASK_DEF=$(echo "$ORCH_TASK_DEF" | jq --arg IMAGE "$NEW_IMAGE" '
            del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) |
            .containerDefinitions[0].image = $IMAGE
        ')

        ORCH_TASK_DEF_FILE=$(mktemp)
        echo "$NEW_ORCH_TASK_DEF" > "$ORCH_TASK_DEF_FILE"
        NEW_ORCH_ARN=$(MSYS_NO_PATHCONV=1 aws ecs register-task-definition \
            --cli-input-json "file://$ORCH_TASK_DEF_FILE" \
            --region $AWS_REGION \
            --query 'taskDefinition.taskDefinitionArn' \
            --output text)
        rm -f "$ORCH_TASK_DEF_FILE"

        echo -e "${GREEN}Registered orchestrator task definition: $NEW_ORCH_ARN${NC}"

        echo -e "${YELLOW}Redeploying orchestrator...${NC}"
        aws ecs update-service \
            --cluster "$ECS_CLUSTER" \
            --service "$ORCHESTRATOR_SERVICE" \
            --task-definition "$NEW_ORCH_ARN" \
            --region "$AWS_REGION" \
            --output text > /dev/null
        echo -e "${GREEN}Orchestrator redeployment initiated${NC}"
    fi

    # Wait for deployment if requested
    if [[ "$WAIT_FOR_DEPLOY" == "true" ]]; then
        wait_for_deployment
    else
        echo -e "${YELLOW}Note: ECS deployment takes 2-5 minutes to complete${NC}"
        echo -e "${YELLOW}Use --wait to wait for completion and verify health${NC}"
    fi

    cd "$SCRIPT_DIR"
}

# Function to update worker task definition to use GHCR image
deploy_worker() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Updating Worker Image (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}  (self-hosted pulls worker image on next task)${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    local GHCR_IMAGE="ghcr.io/jarod-rosenthal/worker"
    local FULL_IMAGE="${GHCR_IMAGE}:${WORKER_VERSION}"

    echo -e "${YELLOW}Pulling GHCR image ${FULL_IMAGE}...${NC}"
    docker pull "$FULL_IMAGE" 2>&1

    WORKER_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$FULL_IMAGE" 2>/dev/null | grep -o 'sha256:[a-f0-9]*')
    if [[ -z "$WORKER_DIGEST" ]]; then
        echo -e "${RED}Failed to resolve digest for ${FULL_IMAGE}${NC}"
        exit 1
    fi
    echo -e "${GREEN}Image digest: $WORKER_DIGEST${NC}"

    # Get current task definition
    echo -e "${YELLOW}Creating new task definition with GHCR image...${NC}"
    TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition ${ECS_CLUSTER}-worker \
        --region $AWS_REGION \
        --query 'taskDefinition' \
        --output json)

    # Update the image in the container definition to use GHCR digest
    NEW_IMAGE="${GHCR_IMAGE}@${WORKER_DIGEST}"
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
    echo -e "${GREEN}Worker image updated to: ${FULL_IMAGE} (${WORKER_DIGEST})${NC}"
    echo -e "${YELLOW}Note: New worker tasks will use the GHCR image${NC}"

    cd "$SCRIPT_DIR"
}

# Function to deploy frontend
deploy_frontend() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Deploying Frontend to S3/CloudFront (${ENVIRONMENT})${NC}"
    echo -e "${GREEN}  (self-hosted frontend updates via GHCR :latest on CI push)${NC}"
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
        echo -e "${YELLOW}Fetching frontend config from SSM Parameter Store...${NC}"
        SSM_PREFIX="/workermill/${ENVIRONMENT}/frontend"
        export VITE_STRIPE_PUBLISHABLE_KEY=$(aws ssm get-parameter --name "${SSM_PREFIX}/VITE_STRIPE_PUBLISHABLE_KEY" --query 'Parameter.Value' --output text --region $AWS_REGION 2>/dev/null || echo "")
        export VITE_SENTRY_DSN=$(aws ssm get-parameter --name "${SSM_PREFIX}/VITE_SENTRY_DSN" --query 'Parameter.Value' --output text --region $AWS_REGION 2>/dev/null || echo "")

        if [[ -z "$VITE_STRIPE_PUBLISHABLE_KEY" ]]; then
            echo -e "${YELLOW}Warning: VITE_STRIPE_PUBLISHABLE_KEY not found in SSM (${SSM_PREFIX})${NC}"
        fi
        if [[ -z "$VITE_SENTRY_DSN" ]]; then
            echo -e "${YELLOW}Warning: VITE_SENTRY_DSN not found in SSM (${SSM_PREFIX})${NC}"
        fi

        # Move .env.local out of the way during build — Vite loads it in ALL modes
        # and it contains local dev overrides (localhost API, local mode flag, etc.)
        if [[ -f ".env.local" ]]; then
            mv .env.local .env.local.bak
            echo -e "${YELLOW}Temporarily moved .env.local to prevent local config leaking into production${NC}"
        fi

        echo -e "${YELLOW}Building Frontend (mode: production)...${NC}"
        npx vite build --mode production
        BUILD_EXIT=$?

        # Restore .env.local
        if [[ -f ".env.local.bak" ]]; then
            mv .env.local.bak .env.local
        fi

        if [[ $BUILD_EXIT -ne 0 ]]; then
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
    # Hashed assets (js/css) — cache aggressively, filename changes on each build
    aws s3 sync dist/assets/ s3://$S3_BUCKET/assets/ --delete --cache-control "public, max-age=31536000, immutable" --region $AWS_REGION
    # Everything else (index.html, images) — always revalidate so new deploys take effect immediately
    aws s3 sync dist/ s3://$S3_BUCKET/ --delete --exclude "agent/*" --exclude "install.sh" --exclude "install.ps1" --exclude "assets/*" --cache-control "no-cache, no-store, must-revalidate" --region $AWS_REGION

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

# Function to publish @workermill/agent to npm
publish_agent() {
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${GREEN}Publishing @workermill/agent to npm${NC}"
    echo -e "${GREEN}----------------------------------------${NC}"

    cd "$SCRIPT_DIR/agent"

    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install

    echo -e "${YELLOW}Building...${NC}"
    npm run build

    echo -e "${YELLOW}Publishing to npm...${NC}"
    npm publish --access public

    echo -e "${GREEN}@workermill/agent published!${NC}"

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

if [[ "$PUBLISH_AGENT" == "true" ]]; then
    publish_agent
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
