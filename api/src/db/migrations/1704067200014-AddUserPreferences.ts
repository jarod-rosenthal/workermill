import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddUserPreferences1704067200014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "users",
      new TableColumn({
        name: "preferences",
        type: "jsonb",
        default: "'{}'",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("users", "preferences");
  }
}
