import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTicketKeyToKbCards1743000000000 implements MigrationInterface {
  name = "AddTicketKeyToKbCards1743000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kb_cards
      ADD COLUMN IF NOT EXISTS ticket_key VARCHAR(100) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kb_cards
      DROP COLUMN IF EXISTS ticket_key
    `);
  }
}
