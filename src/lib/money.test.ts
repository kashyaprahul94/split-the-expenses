import { describe, expect, it } from "vitest";
import fc from "fast-check";

// Placeholder proving the test toolchain (vitest + fast-check, the @/ alias,
// property tests) works before Phase 1 relies on it. Replaced by the real
// money tests in Phase 1.
describe("toolchain", () => {
  it("runs a property test", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
    );
  });
});
