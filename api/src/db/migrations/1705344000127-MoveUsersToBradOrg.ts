import { MigrationInterface, QueryRunner } from "typeorm";

export class MoveUsersToBradOrg1705344000127 implements MigrationInterface {
  name = "MoveUsersToBradOrg1705344000127";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
