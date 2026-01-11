import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from "typeorm";

export class AddWorkerTaskLogs1704067200006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "worker_task_logs",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            default: "uuid_generate_v4()",
          },
          {
            name: "task_id",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "type",
            type: "varchar",
            length: "50",
            isNullable: false,
          },
          {
            name: "message",
            type: "text",
            isNullable: false,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "severity",
            type: "varchar",
            length: "20",
            default: "'info'",
          },
          {
            name: "command",
            type: "text",
            isNullable: true,
          },
          {
            name: "exit_code",
            type: "int",
            isNullable: true,
          },
          {
            name: "stdout",
            type: "text",
            isNullable: true,
          },
          {
            name: "stderr",
            type: "text",
            isNullable: true,
          },
          {
            name: "file_path",
            type: "varchar",
            length: "500",
            isNullable: true,
          },
          {
            name: "duration_ms",
            type: "int",
            isNullable: true,
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    // Create index on task_id + created_at for efficient log streaming
    await queryRunner.createIndex(
      "worker_task_logs",
      new TableIndex({
        name: "IDX_worker_task_logs_task_created",
        columnNames: ["task_id", "created_at"],
      })
    );

    // Create foreign key to worker_tasks
    await queryRunner.createForeignKey(
      "worker_task_logs",
      new TableForeignKey({
        name: "FK_worker_task_logs_task",
        columnNames: ["task_id"],
        referencedTableName: "worker_tasks",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey("worker_task_logs", "FK_worker_task_logs_task");
    await queryRunner.dropIndex("worker_task_logs", "IDX_worker_task_logs_task_created");
    await queryRunner.dropTable("worker_task_logs");
  }
}
