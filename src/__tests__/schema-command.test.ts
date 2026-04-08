import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CliConfigSchema } from "../config.js";

describe("schema command", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-schema-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("schema generation", () => {
    it("generates valid JSON schema from CliConfigSchema", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      expect(schema).toBeDefined();
      expect(schema.$ref).toBe("#/definitions/CliConfig");
      expect(schema.definitions).toBeDefined();
      expect(schema.definitions.CliConfig).toBeDefined();
      expect(schema.definitions.CliConfig.type).toBe("object");
    });

    it("includes all expected top-level properties", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      const props = schema.definitions.CliConfig.properties;
      expect(props.providers).toBeDefined();
      expect(props.default).toBeDefined();
      expect(props.routing).toBeDefined();
      expect(props.mcp).toBeDefined();
      expect(props.review).toBeDefined();
      expect(props.hooks).toBeDefined();
      expect(props.sandbox).toBeDefined();
      expect(props.bell).toBeDefined();
      expect(props.permissions).toBeDefined();
      expect(props.ticketSystem).toBeDefined();
      expect(props.jira).toBeDefined();
      expect(props.linear).toBeDefined();
      expect(props.qualityGates).toBeDefined();
      expect(props.disableModelAutoUpdate).toBeDefined();
      expect(props.editor).toBeDefined();
      expect(props.program).toBeDefined();
      expect(props.doctor).toBeDefined();
      expect(props.liveView).toBeDefined();
      expect(props.inlineEditPreview).toBeDefined();
      expect(props.experimental).toBeDefined();
    });

    it("marks providers and default as required", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      const required = schema.definitions.CliConfig.required;
      expect(required).toContain("providers");
      expect(required).toContain("default");
    });

    it("includes enum values for ticketSystem", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      const ticketSystem = schema.definitions.CliConfig.properties.ticketSystem;
      expect(ticketSystem.enum).toEqual(["github", "jira", "linear", "none"]);
    });

    it("includes enum values for MCPServerConfig transport", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      const mcpTransport = schema.definitions.CliConfig.properties.mcp?.additionalProperties?.properties?.transport;
      expect(mcpTransport?.enum).toEqual(["stdio", "http", "sse"]);
    });

    it("includes union type for liveView (boolean | 'auto')", () => {
      const schema = zodToJsonSchema(CliConfigSchema, {
        name: "CliConfig",
        $ref: true,
        target: "jsonSchema7",
      });

      const liveView = schema.definitions.CliConfig.properties.liveView;
      expect(liveView.anyOf).toBeDefined();
    });
  });

  describe("schema command output", () => {
    it("outputs valid JSON to stdout", async () => {
      const { runSchemaCommand } = await import("../schema-command.js");
      let output: string = "";
      const originalLog = console.log;
      console.log = (msg: string) => { output = msg; };

      try {
        runSchemaCommand({});
        const parsed = JSON.parse(output);
        expect(parsed.$id).toBe("https://workermill.com/schema/cli-config-v1.json");
        expect(parsed.version).toBe("1.0.0");
        expect(parsed.title).toBe("WorkerMill CLI Configuration");
        expect(parsed.$schema).toBe("http://json-schema.org/draft-07/schema#");
      } finally {
        console.log = originalLog;
      }
    });

    it("writes schema to file when --out is provided", async () => {
      const { runSchemaCommand } = await import("../schema-command.js");
      let output: string = "";
      const originalLog = console.log;
      console.log = (msg: string) => { output = msg; };

      try {
        const outPath = path.join(tmpDir, "schema.json");
        runSchemaCommand({ out: outPath });
        
        expect(output).toBe(`Schema written to ${outPath}`);
        expect(fs.existsSync(outPath)).toBe(true);
        
        const content = fs.readFileSync(outPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.$id).toBe("https://workermill.com/schema/cli-config-v1.json");
        expect(parsed.definitions.CliConfig).toBeDefined();
      } finally {
        console.log = originalLog;
      }
    });

    it("creates directory if it doesn't exist", async () => {
      const { runSchemaCommand } = await import("../schema-command.js");
      const outPath = path.join(tmpDir, "nested", "dir", "schema.json");
      
      runSchemaCommand({ out: outPath });
      
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.$id).toBe("https://workermill.com/schema/cli-config-v1.json");
    });

    it("output is deterministic", async () => {
      const { runSchemaCommand } = await import("../schema-command.js");
      let output1: string = "";
      let output2: string = "";
      const originalLog = console.log;
      console.log = (msg: string) => { output1 = msg; };

      runSchemaCommand({});

      console.log = (msg: string) => { output2 = msg; };
      runSchemaCommand({});

      console.log = originalLog;

      expect(output1).toBe(output2);
    });
  });

  describe("schema validation", () => {
    it("validates a representative valid CliConfig", () => {
      const validConfig = {
        providers: {
          ollama: { model: "qwen3-coder:30b", host: "http://localhost:11434" },
        },
        default: "ollama",
        review: { enabled: true, maxRevisions: 3 },
        ticketSystem: "github",
        sandbox: true,
        bell: false,
      };

      const result = CliConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("rejects a config without required fields", () => {
      const invalidConfig = {
        default: "ollama",
      };

      const result = CliConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.errors.map((e: any) => e.path.join("."));
        expect(errors).toContain("providers");
      }
    });

    it("rejects a config with invalid ticketSystem value", () => {
      const invalidConfig = {
        providers: { ollama: { model: "test" } },
        default: "ollama",
        ticketSystem: "invalid-system" as any,
      };

      const result = CliConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("rejects a config with invalid editor value", () => {
      const invalidConfig = {
        providers: { ollama: { model: "test" } },
        default: "ollama",
        editor: "invalid-editor" as any,
      };

      const result = CliConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("rejects a config with invalid transport value in mcp", () => {
      const invalidConfig = {
        providers: { ollama: { model: "test" } },
        default: "ollama",
        mcp: {
          testServer: {
            transport: "invalid-transport" as any,
          },
        },
      };

      const result = CliConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });
});
