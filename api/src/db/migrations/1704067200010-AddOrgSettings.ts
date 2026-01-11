import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddOrgSettings1704067200010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Data Management Settings
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "log_retention_days",
        type: "int",
        default: 30,
      })
    );

    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "task_retention_days",
        type: "int",
        default: 90,
      })
    );

    // Worker Settings
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "max_concurrent_workers",
        type: "int",
        default: 3,
      })
    );

    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "default_max_retries",
        type: "int",
        default: 3,
      })
    );

    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "task_cooldown_seconds",
        type: "int",
        default: 30,
      })
    );

    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "default_worker_model",
        type: "varchar",
        length: "100",
        default: "'claude-3-5-haiku-20241022'",
      })
    );

    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "default_worker_persona",
        type: "varchar",
        length: "50",
        default: "'backend_developer'",
      })
    );

    // Cost Settings
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "cost_alert_threshold_usd",
        type: "decimal",
        precision: 10,
        scale: 2,
        isNullable: true,
        default: null,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("organizations", "cost_alert_threshold_usd");
    await queryRunner.dropColumn("organizations", "default_worker_persona");
    await queryRunner.dropColumn("organizations", "default_worker_model");
    await queryRunner.dropColumn("organizations", "task_cooldown_seconds");
    await queryRunner.dropColumn("organizations", "default_max_retries");
    await queryRunner.dropColumn("organizations", "max_concurrent_workers");
    await queryRunner.dropColumn("organizations", "task_retention_days");
    await queryRunner.dropColumn("organizations", "log_retention_days");
  }
}
