import fs from "fs";
import path from "path";
import { toJSONSchema } from "zod";
import { CliConfigSchema } from "./config.js";

const SCHEMA_ID = "https://workermill.com/schema/cli-config-v1.json";
const SCHEMA_VERSION = "1.0.0";

export interface SchemaCommandOptions {
  out?: string;
}

export interface WorkerMillJsonSchema extends Record<string, unknown> {
  $ref?: string;
  $id: string;
  $schema: string;
  version: string;
  title: string;
  description: string;
  definitions?: Record<string, unknown>;
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | unknown;
}

/**
 * Generate JSON Schema for the global cli.json config.
 */
export function generateCliConfigJsonSchema(): WorkerMillJsonSchema {
  const schema = toJSONSchema(CliConfigSchema, {
    target: "draft-07",
  }) as unknown as WorkerMillJsonSchema;

  schema.$id = SCHEMA_ID;
  schema.version = SCHEMA_VERSION;
  schema.title = "WorkerMill CLI Configuration";
  schema.description = "JSON Schema for WorkerMill global CLI configuration (~/.workermill/cli.json)";
  return schema;
}

export function runSchemaCommand(options: SchemaCommandOptions): void {
  const schema = generateCliConfigJsonSchema();

  // Output to file or stdout
  const output = JSON.stringify(schema, null, 2);

  if (options.out) {
    const outPath = path.resolve(options.out);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outPath, output + "\n", "utf-8");
    console.log(`Schema written to ${outPath}`);
  } else {
    console.log(output);
  }
}
