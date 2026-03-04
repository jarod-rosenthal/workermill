import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteJarod120ForInviteTest1706688000009 implements MigrationInterface {
  name = "DeleteJarod120ForInviteTest1706688000009";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
