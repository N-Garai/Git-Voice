import { describe, it, expect } from "vitest";
import { hashedEmbed, cosineSimilarity } from "./embeddings.js";

describe("hashedEmbed", () => {
  it("produces unit-length vectors", () => {
    const v = hashedEmbed("coupon checkout validation error");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    const a = hashedEmbed("the exact same sentence");
    const b = hashedEmbed("the exact same sentence");
    expect(a).toEqual(b);
  });

  it("separates unrelated text less than related text", () => {
    const query = hashedEmbed("coupon code broken at checkout");
    const related = hashedEmbed("coupon checkout apply code validation");
    const unrelated = hashedEmbed("user avatar upload crop resize");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it("handles empty input without NaN", () => {
    const v = hashedEmbed("");
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and ~0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it("returns 0 on zero vectors instead of NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
