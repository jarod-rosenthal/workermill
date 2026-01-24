import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailInfrastructure1705344000026 implements MigrationInterface {
  name = "AddEmailInfrastructure1705344000026";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create email_logs table for audit trail of all sent emails
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        recipient_email VARCHAR(255) NOT NULL,
        email_type VARCHAR(50) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        ses_message_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        sent_at TIMESTAMP WITH TIME ZONE,

        CONSTRAINT email_logs_status_check CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'complained'))
      )
    `);

    // Create indexes for email_logs
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_org_id ON email_logs(org_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_type_status ON email_logs(email_type, status)
    `);

    // Create inbound_email_mappings table for routing incoming emails
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbound_email_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email_pattern VARCHAR(255) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        action_config JSONB DEFAULT '{}',
        persona VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT inbound_email_action_check CHECK (action_type IN ('create_task', 'reply_to_task', 'route_to_persona'))
      )
    `);

    // Create indexes for inbound_email_mappings
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbound_email_org_id ON inbound_email_mappings(org_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_email_pattern ON inbound_email_mappings(email_pattern, org_id) WHERE is_active = true
    `);

    // Create authorized_email_senders table for security whitelist
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS authorized_email_senders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email_pattern VARCHAR(255) NOT NULL,
        sender_type VARCHAR(50) NOT NULL DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT authorized_sender_type_check CHECK (sender_type IN ('user', 'domain', 'service'))
      )
    `);

    // Create indexes for authorized_email_senders
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_authorized_senders_org_id ON authorized_email_senders(org_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_senders_pattern ON authorized_email_senders(email_pattern, org_id) WHERE is_active = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS authorized_email_senders`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbound_email_mappings`);
    await queryRunner.query(`DROP TABLE IF EXISTS email_logs`);
  }
}
