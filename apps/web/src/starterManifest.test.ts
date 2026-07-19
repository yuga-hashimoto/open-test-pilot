import { describe, expect, it } from "vitest";
import { createManifestValidator } from "@open-test-pilot/manifest-schema";
import { buildStarterManifest, slugifyTestName } from "./starterManifest.js";

describe("starter manifest", () => {
  it("produces a schema-valid Manifest for a newly created test", () => {
    const validate = createManifestValidator();
    const manifest = buildStarterManifest("checkout-flow", "Checkout flow");
    const result = validate(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeNull();
  });

  it("slugifies test names into manifest ids", () => {
    expect(slugifyTestName("Checkout / Guest Payment!")).toBe("checkout-guest-payment");
    expect(slugifyTestName("  ")).toBe("new-test");
    expect(slugifyTestName("Already-slug-2")).toBe("already-slug-2");
  });
});
