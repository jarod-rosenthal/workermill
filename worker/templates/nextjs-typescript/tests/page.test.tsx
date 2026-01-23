import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "../src/app/page";

describe("Home", () => {
  it("renders the ready message", () => {
    render(<Home />);
    expect(screen.getByText(/Ready for development/i)).toBeInTheDocument();
  });
});
