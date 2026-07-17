import { describe, expect, it } from "vitest";
import { getOrganizationDisplayName } from "./organization.js";

describe("getOrganizationDisplayName", () => {
  it("uses the authenticated organization name instead of a demo workspace label", () => {
    expect(getOrganizationDisplayName({ name: "OpenTestPilot Acceptance 20260718" })).toBe("OpenTestPilot Acceptance 20260718");
  });

  it("falls back to Workspace when no organization name is available", () => {
    expect(getOrganizationDisplayName(undefined)).toBe("Workspace");
  });
});
