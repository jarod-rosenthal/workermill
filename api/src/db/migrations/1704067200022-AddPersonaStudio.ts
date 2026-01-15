import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey, TableColumn } from "typeorm";

export class AddPersonaStudio1704067200022 implements MigrationInterface {
  name = "AddPersonaStudio1704067200022";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create personas table
    await queryRunner.createTable(
      new Table({
        name: "personas",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "org_id",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "slug",
            type: "varchar",
            length: "50",
          },
          {
            name: "name",
            type: "varchar",
            length: "100",
          },
          {
            name: "emoji",
            type: "varchar",
            length: "10",
            isNullable: true,
          },
          {
            name: "color",
            type: "varchar",
            length: "50",
            isNullable: true,
          },
          {
            name: "short_label",
            type: "varchar",
            length: "30",
            isNullable: true,
          },
          {
            name: "description",
            type: "text",
            isNullable: true,
          },
          {
            name: "enabled",
            type: "boolean",
            default: true,
          },
          {
            name: "is_system",
            type: "boolean",
            default: false,
          },
          {
            name: "priority",
            type: "int",
            default: 0,
          },
          {
            name: "skills",
            type: "text",
            isNullable: true,
          },
          {
            name: "risk_level",
            type: "varchar",
            length: "20",
            default: "'medium'",
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    // Add unique constraint for org_id + slug
    await queryRunner.createIndex(
      "personas",
      new TableIndex({
        name: "IDX_personas_org_slug_unique",
        columnNames: ["org_id", "slug"],
        isUnique: true,
      })
    );

    // Add index for org_id + enabled
    await queryRunner.createIndex(
      "personas",
      new TableIndex({
        name: "IDX_personas_org_enabled",
        columnNames: ["org_id", "enabled"],
      })
    );

    // Add foreign key to organizations
    await queryRunner.createForeignKey(
      "personas",
      new TableForeignKey({
        name: "FK_personas_organization",
        columnNames: ["org_id"],
        referencedTableName: "organizations",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );

    // Create persona_directives table
    await queryRunner.createTable(
      new Table({
        name: "persona_directives",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "persona_id",
            type: "uuid",
          },
          {
            name: "type",
            type: "varchar",
            length: "50",
          },
          {
            name: "filename",
            type: "varchar",
            length: "100",
            isNullable: true,
          },
          {
            name: "content",
            type: "text",
          },
          {
            name: "version",
            type: "int",
            default: 1,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
          },
          {
            name: "created_by_id",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "change_summary",
            type: "varchar",
            length: "500",
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

    // Add indexes for persona_directives
    await queryRunner.createIndex(
      "persona_directives",
      new TableIndex({
        name: "IDX_directives_persona_type_filename_active",
        columnNames: ["persona_id", "type", "filename", "is_active"],
      })
    );

    await queryRunner.createIndex(
      "persona_directives",
      new TableIndex({
        name: "IDX_directives_persona_active",
        columnNames: ["persona_id", "is_active"],
      })
    );

    // Add foreign keys for persona_directives
    await queryRunner.createForeignKey(
      "persona_directives",
      new TableForeignKey({
        name: "FK_directives_persona",
        columnNames: ["persona_id"],
        referencedTableName: "personas",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );

    await queryRunner.createForeignKey(
      "persona_directives",
      new TableForeignKey({
        name: "FK_directives_created_by",
        columnNames: ["created_by_id"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "SET NULL",
      })
    );

    // Create persona_scripts table
    await queryRunner.createTable(
      new Table({
        name: "persona_scripts",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "persona_id",
            type: "uuid",
          },
          {
            name: "category",
            type: "varchar",
            length: "50",
          },
          {
            name: "name",
            type: "varchar",
            length: "100",
          },
          {
            name: "content",
            type: "text",
          },
          {
            name: "version",
            type: "int",
            default: 1,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
          },
          {
            name: "created_by_id",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "change_summary",
            type: "varchar",
            length: "500",
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

    // Add indexes for persona_scripts
    await queryRunner.createIndex(
      "persona_scripts",
      new TableIndex({
        name: "IDX_scripts_persona_category_name_active",
        columnNames: ["persona_id", "category", "name", "is_active"],
      })
    );

    await queryRunner.createIndex(
      "persona_scripts",
      new TableIndex({
        name: "IDX_scripts_persona_active",
        columnNames: ["persona_id", "is_active"],
      })
    );

    // Add foreign keys for persona_scripts
    await queryRunner.createForeignKey(
      "persona_scripts",
      new TableForeignKey({
        name: "FK_scripts_persona",
        columnNames: ["persona_id"],
        referencedTableName: "personas",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );

    await queryRunner.createForeignKey(
      "persona_scripts",
      new TableForeignKey({
        name: "FK_scripts_created_by",
        columnNames: ["created_by_id"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "SET NULL",
      })
    );

    // Add use_db_personas column to organizations
    await queryRunner.addColumn(
      "organizations",
      new TableColumn({
        name: "use_db_personas",
        type: "boolean",
        default: false,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    await queryRunner.dropForeignKey("persona_scripts", "FK_scripts_created_by");
    await queryRunner.dropForeignKey("persona_scripts", "FK_scripts_persona");
    await queryRunner.dropForeignKey("persona_directives", "FK_directives_created_by");
    await queryRunner.dropForeignKey("persona_directives", "FK_directives_persona");
    await queryRunner.dropForeignKey("personas", "FK_personas_organization");

    // Drop indexes
    await queryRunner.dropIndex("persona_scripts", "IDX_scripts_persona_active");
    await queryRunner.dropIndex("persona_scripts", "IDX_scripts_persona_category_name_active");
    await queryRunner.dropIndex("persona_directives", "IDX_directives_persona_active");
    await queryRunner.dropIndex("persona_directives", "IDX_directives_persona_type_filename_active");
    await queryRunner.dropIndex("personas", "IDX_personas_org_enabled");
    await queryRunner.dropIndex("personas", "IDX_personas_org_slug_unique");

    // Drop tables
    await queryRunner.dropTable("persona_scripts");
    await queryRunner.dropTable("persona_directives");
    await queryRunner.dropTable("personas");

    // Drop column from organizations
    await queryRunner.dropColumn("organizations", "use_db_personas");
  }
}
