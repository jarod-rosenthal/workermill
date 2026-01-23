import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/index.js";

describe("App", () => {
  it("should return welcome message on root", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("message");
  });

  it("should return healthy status on /health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "healthy" });
  });
});
