import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from "typeorm";

export class AddUserApiKeys1704067200015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "user_api_keys",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "gen_random_uuid()",
          },
          {
            name: "user_id",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "name",
            type: "varchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "key_hash",
            type: "varchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "key_prefix",
            type: "varchar",
            length: "12",
            isNullable: false,
          },
          {
            name: "scopes",
            type: "jsonb",
            default: "'[\"*\"]'",
          },
          {
            name: "last_used_at",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "expires_at",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "NOW()",
          },
        ],
      }),
      true
    );

    // Add foreign key
    await queryRunner.createForeignKey(
      "user_api_keys",
      new TableForeignKey({
        columnNames: ["user_id"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );

    // Add indexes
    await queryRunner.createIndex(
      "user_api_keys",
      new TableIndex({
        name: "idx_user_api_keys_user_id",
        columnNames: ["user_id"],
      })
    );

    await queryRunner.createIndex(
      "user_api_keys",
      new TableIndex({
        name: "idx_user_api_keys_key_prefix",
        columnNames: ["key_prefix"],
      })
    );

    // Add unique constraint on user_id + name
    await queryRunner.createIndex(
      "user_api_keys",
      new TableIndex({
        name: "idx_user_api_keys_user_name_unique",
        columnNames: ["user_id", "name"],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("user_api_keys");
  }
}
