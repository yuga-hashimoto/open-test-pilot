import type { Manifest } from "@open-test-pilot/manifest-schema";

export function slugifyTestName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "new-test" : slug;
}

export function buildStarterManifest(manifestId: string, name: string): Manifest {
  return {
    schemaVersion: "1.0.0",
    id: manifestId,
    name,
    description: "",
    type: "e2e",
    tags: [],
    priority: "medium",
    preconditions: [],
    variables: [],
    secrets: [],
    setup: [],
    steps: [
      {
        id: "step-1",
        description: "First step",
        actions: [{ id: "open-page", type: "web.goto", url: "http://127.0.0.1:4173/" }],
      },
    ],
    cleanup: [],
    artifacts: { screenshots: "failure-only" },
    runner: { minBrowsers: ["chromium"] },
    permissions: { networkAccess: true },
    source: { repository: "", path: "" },
    generatedCode: { path: "" },
  };
}
