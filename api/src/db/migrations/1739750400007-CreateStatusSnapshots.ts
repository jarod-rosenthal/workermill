import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateStatusSnapshots1739750400007 implements MigrationInterface {
  name = "CreateStatusSnapshots1739750400007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "status_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
        "component" varchar(50) NOT NULL,
        "status" varchar(20) NOT NULL,
        "response_time_ms" integer,
        "message" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_status_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_status_snapshots_component_timestamp"
      ON "status_snapshots" ("component", "timestamp" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_status_snapshots_component_timestamp"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "status_snapshots"
    `);
  }
}
