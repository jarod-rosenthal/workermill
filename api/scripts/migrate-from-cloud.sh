***REMOVED***!/bin/bash
***REMOVED*** Migrate data from production database to local database
***REMOVED*** Prerequisites:
***REMOVED***   1. Bastion SSH tunnel running: ./bin/bastion ssh (in another terminal)
***REMOVED***   2. Local PostgreSQL running on port 5433
***REMOVED***   3. Production database password

set -e

***REMOVED*** Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' ***REMOVED*** No Color

echo -e "${YELLOW}=== WorkerMill Cloud to Local Data Migration ===${NC}"

***REMOVED*** Configuration
PROD_HOST="localhost"
PROD_PORT="5432"
PROD_DB="workermill"
PROD_USER="workermill"

LOCAL_HOST="localhost"
LOCAL_PORT="5433"
LOCAL_DB="workermill"
LOCAL_USER="workermill"
LOCAL_PASS="localdev"

***REMOVED*** Get production password
if [ -z "$PROD_DB_PASSWORD" ]; then
    echo -e "${YELLOW}Enter production database password (from AWS Secrets Manager):${NC}"
    read -s PROD_DB_PASSWORD
fi

***REMOVED*** Test connections
echo -e "\n${GREEN}Testing connections...${NC}"

***REMOVED*** Test production connection
echo "Testing production connection via tunnel..."
PGPASSWORD="$PROD_DB_PASSWORD" psql -h $PROD_HOST -p $PROD_PORT -U $PROD_USER -d $PROD_DB -c "SELECT 1" > /dev/null 2>&1 || {
    echo -e "${RED}ERROR: Cannot connect to production database.${NC}"
    echo "Make sure the SSH tunnel is running: ./bin/bastion ssh"
    exit 1
}
echo -e "${GREEN}✓ Production connection OK${NC}"

***REMOVED*** Test local connection
echo "Testing local connection..."
PGPASSWORD="$LOCAL_PASS" psql -h $LOCAL_HOST -p $LOCAL_PORT -U $LOCAL_USER -d $LOCAL_DB -c "SELECT 1" > /dev/null 2>&1 || {
    echo -e "${RED}ERROR: Cannot connect to local database.${NC}"
    echo "Make sure local PostgreSQL is running on port 5433"
    exit 1
}
echo -e "${GREEN}✓ Local connection OK${NC}"

***REMOVED*** Create temp directory for dumps
DUMP_DIR="/tmp/workermill-migration-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DUMP_DIR"
echo -e "\n${GREEN}Using temp directory: $DUMP_DIR${NC}"

***REMOVED*** Tables to migrate (in order for foreign key constraints)
TABLES=(
    "organizations"
    "users"
    "user_organizations"
    "personas"
    "persona_directives"
    "persona_scripts"
    "projects"
    "worker_tasks"
    "worker_task_logs"
    "worker_commands"
    "audit_logs"
)

echo -e "\n${YELLOW}Exporting from production...${NC}"

for table in "${TABLES[@]}"; do
    echo -n "  Exporting $table... "
    PGPASSWORD="$PROD_DB_PASSWORD" pg_dump -h $PROD_HOST -p $PROD_PORT -U $PROD_USER -d $PROD_DB \
        --data-only --no-owner --no-privileges \
        --table="$table" \
        -f "$DUMP_DIR/$table.sql" 2>/dev/null || {
            echo -e "${YELLOW}skipped (table may not exist)${NC}"
            continue
        }

    ***REMOVED*** Count rows
    ROWS=$(grep -c "^INSERT\|^COPY" "$DUMP_DIR/$table.sql" 2>/dev/null || echo "0")
    echo -e "${GREEN}✓ ($ROWS statements)${NC}"
done

echo -e "\n${YELLOW}Clearing local tables...${NC}"

***REMOVED*** Clear local tables in reverse order (for foreign keys)
for (( idx=${***REMOVED***TABLES[@]}-1 ; idx>=0 ; idx-- )); do
    table="${TABLES[idx]}"
    echo -n "  Clearing $table... "
    PGPASSWORD="$LOCAL_PASS" psql -h $LOCAL_HOST -p $LOCAL_PORT -U $LOCAL_USER -d $LOCAL_DB \
        -c "TRUNCATE $table CASCADE" 2>/dev/null || {
            echo -e "${YELLOW}skipped${NC}"
            continue
        }
    echo -e "${GREEN}✓${NC}"
done

echo -e "\n${YELLOW}Importing to local database...${NC}"

for table in "${TABLES[@]}"; do
    if [ -f "$DUMP_DIR/$table.sql" ] && [ -s "$DUMP_DIR/$table.sql" ]; then
        echo -n "  Importing $table... "
        PGPASSWORD="$LOCAL_PASS" psql -h $LOCAL_HOST -p $LOCAL_PORT -U $LOCAL_USER -d $LOCAL_DB \
            -f "$DUMP_DIR/$table.sql" > /dev/null 2>&1 || {
                echo -e "${RED}failed${NC}"
                continue
            }
        echo -e "${GREEN}✓${NC}"
    fi
done

***REMOVED*** Verify migration
echo -e "\n${YELLOW}Verifying migration...${NC}"

for table in "${TABLES[@]}"; do
    COUNT=$(PGPASSWORD="$LOCAL_PASS" psql -h $LOCAL_HOST -p $LOCAL_PORT -U $LOCAL_USER -d $LOCAL_DB \
        -t -c "SELECT COUNT(*) FROM $table" 2>/dev/null || echo "0")
    COUNT=$(echo "$COUNT" | tr -d ' ')
    if [ "$COUNT" != "0" ]; then
        echo -e "  $table: ${GREEN}$COUNT rows${NC}"
    fi
done

***REMOVED*** Cleanup
rm -rf "$DUMP_DIR"

echo -e "\n${GREEN}=== Migration Complete ===${NC}"
echo -e "Your local database now has the production data."
echo -e "Restart the API to pick up any settings changes: ${YELLOW}npm run dev${NC}"
