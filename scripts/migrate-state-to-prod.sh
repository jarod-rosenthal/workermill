***REMOVED***!/bin/bash
set -e

***REMOVED*** =============================================================================
***REMOVED*** Terraform State Migration: dev → prod
***REMOVED*** =============================================================================
***REMOVED***
***REMOVED*** This script migrates the Terraform state from the old "dev" state key to the
***REMOVED*** new "prod" state key. This is a ONE-TIME operation.
***REMOVED***
***REMOVED*** WHAT THIS DOES:
***REMOVED***   - Copies state from workermill/dev/terraform.tfstate → workermill/prod/terraform.tfstate
***REMOVED***   - Initializes the prod environment with the migrated state
***REMOVED***
***REMOVED*** WHAT THIS DOES NOT DO:
***REMOVED***   - Does NOT rename AWS resources (they remain workermill-dev-*)
***REMOVED***   - Does NOT destroy or recreate any infrastructure
***REMOVED***   - Does NOT affect the running system
***REMOVED***
***REMOVED*** PREREQUISITES:
***REMOVED***   - AWS CLI configured with appropriate credentials
***REMOVED***   - Terraform >= 1.0 installed
***REMOVED***   - No active Terraform operations in progress
***REMOVED***
***REMOVED*** =============================================================================

***REMOVED*** Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

***REMOVED*** Configuration
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="AWS_ACCOUNT_ID"
STATE_BUCKET="workermill-terraform-state-${AWS_ACCOUNT_ID}"
OLD_STATE_KEY="workermill/dev/terraform.tfstate"
NEW_STATE_KEY="workermill/prod/terraform.tfstate"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="$SCRIPT_DIR/../infrastructure/terraform/environments/prod"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Terraform State Migration: dev → prod${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

***REMOVED*** Verify we're in the right place
if [[ ! -d "$PROD_DIR" ]]; then
    echo -e "${RED}Error: prod environment directory not found at $PROD_DIR${NC}"
    exit 1
fi

***REMOVED*** Check if state already exists at new location
echo -e "${YELLOW}Checking if state already exists at new location...${NC}"
if aws s3 ls "s3://${STATE_BUCKET}/${NEW_STATE_KEY}" --region $AWS_REGION 2>/dev/null; then
    echo -e "${RED}Error: State already exists at s3://${STATE_BUCKET}/${NEW_STATE_KEY}${NC}"
    echo -e "${RED}If you want to re-run migration, delete the existing state first.${NC}"
    exit 1
fi

***REMOVED*** Verify source state exists
echo -e "${YELLOW}Verifying source state exists...${NC}"
if ! aws s3 ls "s3://${STATE_BUCKET}/${OLD_STATE_KEY}" --region $AWS_REGION 2>/dev/null; then
    echo -e "${RED}Error: Source state not found at s3://${STATE_BUCKET}/${OLD_STATE_KEY}${NC}"
    exit 1
fi
echo -e "${GREEN}Source state found ✓${NC}"

***REMOVED*** Confirm with user
echo ""
echo -e "${YELLOW}This will:${NC}"
echo "  1. Copy state from: s3://${STATE_BUCKET}/${OLD_STATE_KEY}"
echo "  2. To new location: s3://${STATE_BUCKET}/${NEW_STATE_KEY}"
echo "  3. Initialize Terraform in environments/prod/"
echo ""
echo -e "${YELLOW}The original state will be preserved (not deleted).${NC}"
echo ""
read -p "Continue? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

***REMOVED*** Copy state to new location
echo ""
echo -e "${YELLOW}Copying state to new location...${NC}"
aws s3 cp \
    "s3://${STATE_BUCKET}/${OLD_STATE_KEY}" \
    "s3://${STATE_BUCKET}/${NEW_STATE_KEY}" \
    --region $AWS_REGION

echo -e "${GREEN}State copied successfully ✓${NC}"

***REMOVED*** Initialize Terraform in prod directory
echo ""
echo -e "${YELLOW}Initializing Terraform in prod environment...${NC}"
cd "$PROD_DIR"

terraform init \
    -backend-config="bucket=${STATE_BUCKET}" \
    -reconfigure

***REMOVED*** Verify state was loaded
echo ""
echo -e "${YELLOW}Verifying state was loaded correctly...${NC}"
RESOURCE_COUNT=$(terraform state list 2>/dev/null | wc -l)
if [[ $RESOURCE_COUNT -eq 0 ]]; then
    echo -e "${RED}Error: No resources found in state. Migration may have failed.${NC}"
    exit 1
fi

echo -e "${GREEN}Found ${RESOURCE_COUNT} resources in state ✓${NC}"

***REMOVED*** Run plan to verify no changes
echo ""
echo -e "${YELLOW}Running terraform plan to verify no changes...${NC}"
terraform plan -var="domain_name=workermill.com" -detailed-exitcode || PLAN_EXIT=$?

if [[ ${PLAN_EXIT:-0} -eq 0 ]]; then
    echo -e "${GREEN}No changes detected - migration successful! ✓${NC}"
elif [[ ${PLAN_EXIT:-0} -eq 2 ]]; then
    echo -e "${YELLOW}Warning: Terraform detected some changes.${NC}"
    echo -e "${YELLOW}Review the plan above and run 'terraform apply' if changes are expected.${NC}"
else
    echo -e "${RED}Error: Terraform plan failed.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Migration Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the terraform plan output above"
echo "  2. If no unexpected changes, the migration is complete"
echo "  3. Update deploy.sh to use environments/prod for production deployments"
echo "  4. The old state at ${OLD_STATE_KEY} can be deleted after verification"
echo ""
echo -e "${YELLOW}IMPORTANT: Do NOT delete the old state until you've verified production is working.${NC}"
