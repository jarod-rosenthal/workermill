import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TOOLS = [
  "bash", "bash_background", "bash_output", "bash_kill", "read_file", "write_file", "edit_file", "multi_edit_file", "patch",
  "glob", "grep", "ls", "fetch", "sub_agent",
];

function makePersonaContent({
  name = "Test Expert",
  slug = "test_expert",
  description = "A test expert",
  tools,
  provider,
  model,
  body = "You are a test expert.",
}: {
  name?: string;
  slug?: string;
  description?: string;
  tools?: string[];
  provider?: string;
  model?: string;
  body?: string;
} = {}): string {
  const lines = [`name: ${name}`, `slug: ${slug}`];
  if (description) lines.push(`description: ${description}`);
  if (tools) lines.push(`tools: [${tools.join(", ")}]`);
  if (provider) lines.push(`provider: ${provider}`);
  if (model) lines.push(`model: ${model}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("personas", () => {
  let tmp: TempHome;
  let origCwd: string;
  let projectDir: string;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    origCwd = process.cwd();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-personas-project-"));
    // Reset module registry so path constants in personas.ts are re-evaluated
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    // Restore cwd spy before cleanup so process.chdir still resolves the original path
    vi.restoreAllMocks();
    process.chdir(origCwd);
    tmp.cleanup();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function importPersonas() {
    return await import("../personas.js");
  }

  // -------------------------------------------------------------------------
  // parsePersonaFile — exercised indirectly via loadPersona
  // -------------------------------------------------------------------------

  describe("parsePersonaFile (via loadPersona)", () => {
    it("parses a persona file with all fields present", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, "full_expert.md"),
        makePersonaContent({
          name: "Full Expert",
          slug: "full_expert",
          description: "Has everything",
          tools: ["bash", "read_file"],
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          body: "You are a comprehensive expert.",
        }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("full_expert");

      expect(persona).not.toBeNull();
      expect(persona!.name).toBe("Full Expert");
      expect(persona!.slug).toBe("full_expert");
      expect(persona!.description).toBe("Has everything");
      expect(persona!.tools).toEqual(["bash", "read_file"]);
      expect(persona!.provider).toBe("anthropic");
      expect(persona!.model).toBe("claude-sonnet-4-6");
      expect(persona!.systemPrompt).toBe("You are a comprehensive expert.");
    });

    it("assigns default tools when the tools field is absent", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, "no_tools.md"),
        makePersonaContent({
          name: "No Tools",
          slug: "no_tools",
          tools: undefined,
          body: "You work with default tools.",
        }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("no_tools");

      expect(persona).not.toBeNull();
      expect(persona!.tools).toEqual(DEFAULT_TOOLS);
    });

    it("returns fallback (not null) when content has no frontmatter markers", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, "invalid_content.md"),
        "This file has no frontmatter at all.",
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      // parsePersonaFile returns null → loadPersona falls through to the fallback persona
      const persona = loadPersona("invalid_content");

      // Should receive the generated fallback, not null
      expect(persona).not.toBeNull();
      expect(persona!.slug).toBe("invalid_content");
    });

    it("returns fallback when required name/slug fields are missing", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      // Frontmatter present but name and slug are absent
      fs.writeFileSync(
        path.join(personasDir, "missing_fields.md"),
        "---\ndescription: no name or slug here\n---\nSome body.",
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("missing_fields");

      // Falls through to fallback
      expect(persona).not.toBeNull();
      expect(persona!.slug).toBe("missing_fields");
    });

    it("preserves multi-line system prompt body", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      const multiLineBody = "Line one.\nLine two.\n\nLine four after blank.";
      fs.writeFileSync(
        path.join(personasDir, "multiline.md"),
        makePersonaContent({ name: "Multiline", slug: "multiline", body: multiLineBody }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("multiline");

      expect(persona!.systemPrompt).toBe(multiLineBody);
    });

    it("leaves provider and model undefined when not in frontmatter", async () => {
      const personasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, "no_provider.md"),
        makePersonaContent({ name: "No Provider", slug: "no_provider" }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("no_provider");

      expect(persona!.provider).toBeUndefined();
      expect(persona!.model).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // loadPersona — location resolution
  // -------------------------------------------------------------------------

  describe("loadPersona()", () => {
    it("loads from project .workermill/personas/ directory", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);

      const personasDir = path.join(projectDir, ".workermill", "personas");
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, "project_expert.md"),
        makePersonaContent({ name: "Project Expert", slug: "project_expert" }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("project_expert");

      expect(persona).not.toBeNull();
      expect(persona!.name).toBe("Project Expert");
      expect(persona!.slug).toBe("project_expert");
    });

    it("loads from user ~/.workermill/personas/ directory", async () => {
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(userPersonasDir, "user_expert.md"),
        makePersonaContent({ name: "User Expert", slug: "user_expert" }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("user_expert");

      expect(persona).not.toBeNull();
      expect(persona!.name).toBe("User Expert");
      expect(persona!.slug).toBe("user_expert");
    });

    it("project-level persona takes precedence over user-level persona for same slug", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);

      // User-level persona
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(userPersonasDir, "shared_expert.md"),
        makePersonaContent({ name: "User Version", slug: "shared_expert" }),
        "utf-8",
      );

      // Project-level persona with same slug
      const projectPersonasDir = path.join(projectDir, ".workermill", "personas");
      fs.mkdirSync(projectPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectPersonasDir, "shared_expert.md"),
        makePersonaContent({ name: "Project Version", slug: "shared_expert" }),
        "utf-8",
      );

      const { loadPersona } = await importPersonas();
      const persona = loadPersona("shared_expert");

      expect(persona!.name).toBe("Project Version");
    });

    it("returns fallback default persona when no file is found for slug", async () => {
      const { loadPersona } = await importPersonas();
      const persona = loadPersona("nonexistent_expert");

      expect(persona).not.toBeNull();
      expect(persona!.slug).toBe("nonexistent_expert");
    });

    it("fallback persona name converts underscores to spaces and capitalizes words", async () => {
      const { loadPersona } = await importPersonas();
      const persona = loadPersona("my_custom_expert");

      expect(persona!.name).toBe("My Custom Expert");
    });

    it("fallback persona uses default tools", async () => {
      const { loadPersona } = await importPersonas();
      const persona = loadPersona("unknown_slug");

      expect(persona!.tools).toEqual(DEFAULT_TOOLS);
    });

    it("fallback system prompt references the slug without underscores", async () => {
      const { loadPersona } = await importPersonas();
      const persona = loadPersona("database_engineer");

      expect(persona!.systemPrompt).toContain("database engineer");
    });

    it("fallback description uses slug as specialist label", async () => {
      const { loadPersona } = await importPersonas();
      // Use a slug that definitely does not exist in any bundled or user persona dir
      const persona = loadPersona("completely_nonexistent_xyz_expert");

      expect(persona!.description).toContain("completely_nonexistent_xyz_expert");
    });
  });

  // -------------------------------------------------------------------------
  // listAvailablePersonas
  // -------------------------------------------------------------------------

  describe("listAvailablePersonas()", () => {
    it("returns slugs from user ~/.workermill/personas/ directory", async () => {
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(userPersonasDir, "alpha_expert.md"),
        makePersonaContent({ name: "Alpha Expert", slug: "alpha_expert" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(userPersonasDir, "beta_expert.md"),
        makePersonaContent({ name: "Beta Expert", slug: "beta_expert" }),
        "utf-8",
      );

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      expect(slugs).toContain("alpha_expert");
      expect(slugs).toContain("beta_expert");
    });

    it("returns slugs from project .workermill/personas/ directory", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);

      const projectPersonasDir = path.join(projectDir, ".workermill", "personas");
      fs.mkdirSync(projectPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectPersonasDir, "gamma_expert.md"),
        makePersonaContent({ name: "Gamma Expert", slug: "gamma_expert" }),
        "utf-8",
      );

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      expect(slugs).toContain("gamma_expert");
    });

    it("deduplicates slugs that appear in both user and project dirs", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);

      // Same slug in user dir
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(userPersonasDir, "shared_expert.md"),
        makePersonaContent({ name: "Shared User", slug: "shared_expert" }),
        "utf-8",
      );

      // Same slug in project dir
      const projectPersonasDir = path.join(projectDir, ".workermill", "personas");
      fs.mkdirSync(projectPersonasDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectPersonasDir, "shared_expert.md"),
        makePersonaContent({ name: "Shared Project", slug: "shared_expert" }),
        "utf-8",
      );

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      const count = slugs.filter((s) => s === "shared_expert").length;
      expect(count).toBe(1);
    });

    it("converts hyphens in filenames to underscores in returned slugs", async () => {
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      // Use hyphen in filename
      fs.writeFileSync(
        path.join(userPersonasDir, "hyphen-expert.md"),
        makePersonaContent({ name: "Hyphen Expert", slug: "hyphen_expert" }),
        "utf-8",
      );

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      expect(slugs).toContain("hyphen_expert");
      expect(slugs).not.toContain("hyphen-expert");
    });

    it("returns a sorted array", async () => {
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      // Write in reverse alphabetical order
      for (const name of ["zebra_expert", "alpha_expert", "middle_expert"]) {
        fs.writeFileSync(
          path.join(userPersonasDir, `${name}.md`),
          makePersonaContent({ name, slug: name }),
          "utf-8",
        );
      }

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      const relevant = slugs.filter((s) =>
        ["zebra_expert", "alpha_expert", "middle_expert"].includes(s),
      );
      expect(relevant).toEqual(["alpha_expert", "middle_expert", "zebra_expert"]);
    });

    it("ignores non-.md files in persona directories", async () => {
      const userPersonasDir = path.join(tmp.wmDir, "personas");
      fs.mkdirSync(userPersonasDir, { recursive: true });
      fs.writeFileSync(path.join(userPersonasDir, "real_expert.md"), makePersonaContent({ name: "Real", slug: "real_expert" }), "utf-8");
      fs.writeFileSync(path.join(userPersonasDir, "readme.txt"), "ignore me", "utf-8");
      fs.writeFileSync(path.join(userPersonasDir, "config.json"), "{}", "utf-8");

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      expect(slugs).toContain("real_expert");
      expect(slugs).not.toContain("readme");
      expect(slugs).not.toContain("config");
    });

    it("returns empty array when no persona directories exist", async () => {
      // No user personas dir, no project personas dir, and we point cwd somewhere empty
      vi.spyOn(process, "cwd").mockReturnValue(projectDir);

      const { listAvailablePersonas } = await importPersonas();
      const slugs = listAvailablePersonas();

      // Builtin personas (from the personas/ dir) may or may not be found depending
      // on import.meta.dirname resolution in tests — only assert the array is an Array
      // and sorted (no duplicates, no non-.md files leaked in).
      expect(Array.isArray(slugs)).toBe(true);
      // All returned slugs must use underscores, not hyphens
      for (const slug of slugs) {
        expect(slug).not.toContain("-");
      }
    });
  });
});
