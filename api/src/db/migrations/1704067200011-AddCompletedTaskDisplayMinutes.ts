import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddCompletedTaskDisplayMinutes1704067200011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "completed_task_display_minutes",
        type: "int",
        default: 10,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("organizations", "completed_task_display_minutes");
  }
}
