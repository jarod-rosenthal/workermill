import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ensure Mevion and WorkerMill platform orgs are Enterprise with no restrictions.
 *
 * - Mevion: plan=enterprise, active subscription, unlimited quota, billing not paused
 * - WorkerMill platform: isPlatformOrg=true, plan=enterprise, unlimited quota
 *
 * Idempotent: uses conditional WHERE clauses.
 */
export class EnsureEnterpriseMevionAndPlatform1740800000000
  implements MigrationInterface
{
  name = "EnsureEnterpriseMevionAndPlatform1740800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Mevion — enterprise, no restrictions
    const mevionResult = await queryRunner.query(
      `
      UPDATE organizations
      SET
        plan = 'enterprise',
        stripe_subscription_status = 'active',
        task_quota = -1,
        billing_paused = false,
        billing_paused_reason = NULL
      WHERE name = 'Mevion'
      RETURNING id, name, plan, stripe_subscription_status, task_quota
      `,
    );
    console.log("Mevion updated:", mevionResult);

    // WorkerMill platform org — enterprise, no restrictions, isPlatformOrg
    const platformResult = await queryRunner.query(
      `
      UPDATE organizations
      SET
        plan = 'enterprise',
        stripe_subscription_status = 'active',
        task_quota = -1,
        billing_paused = false,
        billing_paused_reason = NULL,
        is_platform_org = true
      WHERE is_platform_org = true
         OR id = 'a0000000-0000-4000-8000-000000000001'
      RETURNING id, name, plan, stripe_subscription_status, task_quota, is_platform_org
      `,
    );
    console.log("Platform org updated:", platformResult);
  }

  public async down(): Promise<void> {
    // No-op: don't downgrade enterprise customers
  }
}
