# Drop Legacy User.orgId and User.role Columns

## Background

As of commit `314aa49`, the `UserOrganization` table is now the **single source of truth** for organization membership and roles. The legacy columns on the `User` table are no longer used:

- `User.orgId` - Always set to `null` for new users
- `User.role` - Always set to `"member"` as a default, but actual role comes from `UserOrganization.role`

## Prerequisites

Before running this migration, verify:

1. **All users have UserOrganization records** - Run this query to check for orphans:
   ```sql
   SELECT u.id, u.email, u.org_id, u.role
   FROM users u
   LEFT JOIN user_organizations uo ON u.id = uo.user_id
   WHERE uo.id IS NULL AND u.status = 'active';
   ```
   If any rows are returned, create UserOrganization records for them first.

2. **No code references legacy fields** - Verify with:
   ```bash
   grep -r "user\.orgId\|user\.role\|req\.user.*\.role\|req\.user.*\.orgId" api/src --include="*.ts"
   ```
   Should return no results (except comments).

3. **Production has been stable** - Wait at least 1-2 weeks after the refactor to ensure no issues.

## Migration

Create file: `api/src/db/migrations/XXXXXXXXXX-DropLegacyUserColumns.ts`

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class DropLegacyUserColumns implements MigrationInterface {
  name = "DropLegacyUserColumns";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verify no orphaned users before dropping
    const orphanedUsers = await queryRunner.query(`
      SELECT u.id, u.email
      FROM users u
      LEFT JOIN user_organizations uo ON u.id = uo.user_id
      WHERE uo.id IS NULL AND u.status = 'active'
      LIMIT 5
    `);

    if (orphanedUsers.length > 0) {
      throw new Error(
        `Cannot drop columns: ${orphanedUsers.length} active users have no UserOrganization record. ` +
        `First orphan: ${orphanedUsers[0].email}`
      );
    }

    // Drop the legacy columns
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS org_id`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add columns (without data - would need separate backfill)
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id),
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member'
    `);
  }
}
```

## After Migration

1. Remove the columns from the User model (`api/src/models/User.ts`):
   ```typescript
   // DELETE these lines:
   @Column({ name: "org_id", type: "uuid", nullable: true })
   orgId: string | null;

   @Column({ type: "varchar", length: 20, default: "member" })
   role: string;
   ```

2. Remove any remaining references to these fields in seed files or debug endpoints.

## Rollback Plan

If issues arise:
1. The `down` migration re-adds the columns
2. Data would need to be backfilled from UserOrganization:
   ```sql
   UPDATE users u
   SET org_id = uo.org_id, role = uo.role
   FROM user_organizations uo
   WHERE u.id = uo.user_id AND uo.is_default = true;
   ```

## Timeline

- **Now**: Document created, migration not urgent
- **+2 weeks**: If no issues, run prerequisites check
- **+3 weeks**: Execute migration in dev environment
- **+4 weeks**: Execute migration in production
