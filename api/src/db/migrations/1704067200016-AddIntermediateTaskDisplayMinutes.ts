import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddIntermediateTaskDisplayMinutes1704067200016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "intermediate_task_display_minutes",
        type: "int",
        default: 60,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("organizations", "intermediate_task_display_minutes");
  }
}
