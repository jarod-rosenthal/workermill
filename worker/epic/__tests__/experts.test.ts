import { describe, it, expect } from "vitest";
import { matchPersonaToExpert, getAvailableExperts } from "../experts.js";

// ─── matchPersonaToExpert ───────────────────────────────────────

describe("matchPersonaToExpert", () => {
  it("matches exact persona names", () => {
    expect(matchPersonaToExpert("backend_developer")).toBe("backend_developer");
    expect(matchPersonaToExpert("frontend_developer")).toBe("frontend_developer");
    expect(matchPersonaToExpert("security_engineer")).toBe("security_engineer");
    expect(matchPersonaToExpert("qa_engineer")).toBe("qa_engineer");
    expect(matchPersonaToExpert("devops_engineer")).toBe("devops_engineer");
  });

  it("normalizes persona strings (lowercases and replaces non-alpha chars)", () => {
    expect(matchPersonaToExpert("Backend Developer")).toBe("backend_developer");
    expect(matchPersonaToExpert("BACKEND_DEVELOPER")).toBe("backend_developer");
    expect(matchPersonaToExpert("Backend-Developer")).toBe("backend_developer");
  });

  it("returns null for unknown personas", () => {
    expect(matchPersonaToExpert("unknown_persona")).toBeNull();
    expect(matchPersonaToExpert("")).toBeNull();
    expect(matchPersonaToExpert("astronaut")).toBeNull();
  });

  it("handles special characters in persona string", () => {
    // Non-alpha chars become underscores
    expect(matchPersonaToExpert("tech.lead")).toBe("tech_lead");
    expect(matchPersonaToExpert("tech-lead")).toBe("tech_lead");
  });
});

// ─── getAvailableExperts ────────────────────────────────────────

describe("getAvailableExperts", () => {
  it("returns available experts filtering out review-only personas", () => {
    const experts = getAvailableExperts();
    // tech_lead and manager are review-only by default
    expect(experts).not.toContain("tech_lead");
    expect(experts).not.toContain("manager");
  });

  it("includes standard development personas", () => {
    const experts = getAvailableExperts();
    expect(experts).toContain("backend_developer");
    expect(experts).toContain("frontend_developer");
    expect(experts).toContain("security_engineer");
    expect(experts).toContain("qa_engineer");
    expect(experts).toContain("devops_engineer");
  });

  it("returns an array of strings", () => {
    const experts = getAvailableExperts();
    expect(Array.isArray(experts)).toBe(true);
    expect(experts.length).toBeGreaterThan(0);
    for (const e of experts) {
      expect(typeof e).toBe("string");
    }
  });
});
