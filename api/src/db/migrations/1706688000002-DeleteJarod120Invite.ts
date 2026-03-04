import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteJarod120Invite1706688000002 implements MigrationInterface {
  name = "DeleteJarod120Invite1706688000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
