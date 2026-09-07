import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  OTHER,
  categoryFor,
  categoryValue,
  isCategoryId,
} from "./categories";

describe("the category list", () => {
  it("has unique ids and ends with Other", () => {
    const ids = CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATEGORIES[CATEGORIES.length - 1]).toBe(OTHER);
    expect(OTHER.id).toBe("other");
  });

  it("gives every category an icon", () => {
    for (const category of CATEGORIES) {
      expect(category.icon.length).toBeGreaterThan(0);
      expect(category.label.length).toBeGreaterThan(0);
    }
  });
});

describe("categoryFor", () => {
  it("resolves a stored id", () => {
    expect(categoryFor("travel").label).toBe("Travel");
  });

  it("resolves values written before the list existed", () => {
    // Real data in this project has "Travel" with a capital T, saved by the
    // old free-text field. It must not fall through to Other.
    expect(categoryFor("Travel").id).toBe("travel");
    expect(categoryFor("  FOOD ").id).toBe("food");
    expect(categoryFor("Food & drink").id).toBe("food");
  });

  it("falls back to Other rather than throwing", () => {
    expect(categoryFor(null)).toBe(OTHER);
    expect(categoryFor("")).toBe(OTHER);
    expect(categoryFor("nonsense someone typed in 2024")).toBe(OTHER);
  });
});

describe("categoryValue", () => {
  it("preselects the matching option when editing", () => {
    expect(categoryValue("Travel")).toBe("travel");
    expect(categoryValue("food")).toBe("food");
  });

  it("is blank when there is no category", () => {
    expect(categoryValue(null)).toBe("");
    expect(categoryValue("")).toBe("");
  });

  it("puts an unrecognised value on Other", () => {
    expect(categoryValue("whatever")).toBe("other");
  });
});

describe("isCategoryId", () => {
  it("accepts only the known ids", () => {
    expect(isCategoryId("travel")).toBe(true);
    expect(isCategoryId("other")).toBe(true);
    // The server uses this to keep new writes on the list, so it must reject
    // labels and stray casing rather than storing them.
    expect(isCategoryId("Travel")).toBe(false);
    expect(isCategoryId("Food & drink")).toBe(false);
    expect(isCategoryId("")).toBe(false);
  });
});
