import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketingAgent1740400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Marketing Campaigns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
        budget_cents INT NOT NULL DEFAULT 0,
        spent_cents INT NOT NULL DEFAULT 0,
        impressions INT NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        conversions INT NOT NULL DEFAULT 0,
        targeting_config JSONB NOT NULL DEFAULT '{}',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_org_id ON marketing_campaigns(org_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status)`,
    );

    // Marketing Content
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
        platform VARCHAR(50) NOT NULL,
        content_type VARCHAR(50) NOT NULL,
        title VARCHAR(500),
        body TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        published_at TIMESTAMP WITH TIME ZONE,
        engagement_metrics JSONB NOT NULL DEFAULT '{}',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_content_org_id ON marketing_content(org_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_content_status ON marketing_content(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_content_campaign_id ON marketing_content(campaign_id)`,
    );

    // Marketing Actions (audit log)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketing_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        mission_run_id VARCHAR(100) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        platform VARCHAR(50),
        description TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}',
        auto_executed BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_actions_org_id ON marketing_actions(org_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_actions_mission_run ON marketing_actions(mission_run_id)`,
    );

    // Organization columns for marketing agent
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_enabled BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_interval_minutes INT NOT NULL DEFAULT 120`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_agent_config JSONB NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_channel_credentials JSONB NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_monthly_budget_cents INT NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS marketing_escalation_threshold_cents INT NOT NULL DEFAULT 10000`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_escalation_threshold_cents`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_monthly_budget_cents`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_channel_credentials`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_config`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_interval_minutes`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS marketing_agent_enabled`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_actions`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_content`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_campaigns`);
  }
}
