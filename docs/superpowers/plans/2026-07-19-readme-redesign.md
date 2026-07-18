# Bilingual README and Product Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal repository README with matching, beginner-friendly English and Japanese guides illustrated by real OpenTestPilot UI screenshots.

**Architecture:** Keep `README.md` as the canonical English GitHub landing page and add `README.ja.md` as a complete Japanese counterpart. Store stable, repository-owned browser captures in `docs/images/`, keep the local CLI path separate from optional team-mode services, and link detailed specifications instead of duplicating them.

**Tech Stack:** GitHub-flavored Markdown, React/Vite demo UI, Playwright Chromium, pnpm 10, Node.js 20+

## Global Constraints

- Perform the work directly in the parent Codex task; do not delegate to external engines or subagents.
- Preserve factual boundaries between locally reproducible features and deployment-, credential-, or device-dependent capabilities.
- Use only screenshots from the current local OpenTestPilot UI and exclude secrets, local usernames, tokens, or misleading error states.
- Keep English and Japanese section coverage equivalent.
- Do not change product behavior, API contracts, or application copy.
- Push the completed, verified commits directly to `origin/main` only after all checks pass.

---

### Task 1: Capture stable product UI images

**Files:**
- Create: `docs/images/opentestpilot-overview.png`
- Create: `docs/images/opentestpilot-manifest-editor.png`

**Interfaces:**
- Consumes: the demo-mode web application served by `pnpm --filter @open-test-pilot/web dev --host 127.0.0.1 --port 4173`
- Produces: two 1440 x 1000 PNG assets referenced by both README files

- [ ] **Step 1: Start the demo-mode web application**

Run:

```bash
pnpm --filter @open-test-pilot/web dev --host 127.0.0.1 --port 4173
```

Expected: Vite reports `http://127.0.0.1:4173/` and the page renders with the intentional demo-data indicator rather than an API error.

- [ ] **Step 2: Inspect Overview in a real browser**

Open `http://127.0.0.1:4173/` with a 1440 x 1000 viewport and Japanese locale. Verify the application shell, navigation, status cards, recent runs, and evidence panels are visible; verify no credentials or machine-specific paths appear.

- [ ] **Step 3: Capture the Overview image**

Save a full-page or viewport capture to:

```text
docs/images/opentestpilot-overview.png
```

Expected: a readable PNG showing the current dashboard without browser chrome, error banners, tokens, or personal data.

- [ ] **Step 4: Open and capture the manifest editor**

Select `Tests`, keep the sample test selected, and save the viewport to:

```text
docs/images/opentestpilot-manifest-editor.png
```

Expected: a readable PNG showing the test list, YAML manifest editor, and generated-code workflow without clipped primary controls.

- [ ] **Step 5: Inspect both files locally**

Run:

```bash
file docs/images/opentestpilot-overview.png docs/images/opentestpilot-manifest-editor.png
```

Expected: both files are reported as PNG images with non-zero dimensions.

---

### Task 2: Rewrite the English landing page

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the two images from Task 1, repository scripts in `package.json`, examples under `examples/manifests/`, and detailed documents under `docs/`
- Produces: the canonical English GitHub landing page and the section contract mirrored by Task 3

- [ ] **Step 1: Replace the current README with the approved structure**

Write these sections in this exact order:

```markdown
# OpenTestPilot
[English](README.md) | [日本語](README.ja.md)

One-sentence product definition and concise status badges.

![OpenTestPilot dashboard](docs/images/opentestpilot-overview.png)

## What is OpenTestPilot?
## Why OpenTestPilot?
## Core capabilities
## A test is just YAML
## Quick start: run a real browser test locally
## What the run produces
## Web dashboard and team mode
## How it works
## Supported surfaces
## Current project status
## Repository structure
## Documentation
## Development
## Contributing and security
## License
```

The opening copy must explain that OpenTestPilot is an AI-native, open-source control plane that turns structured YAML manifests into executable web/mobile tests and evidence. The “Why” section must distinguish it from individual execution engines: it coordinates manifests, generation, runners, evidence, GitHub workflows, scheduling, and policy-gated repair while using Playwright and Appium underneath.

- [ ] **Step 2: Add a minimal, reproducible local quick start**

Use the included fixture path and commands exactly:

```bash
pnpm install
pnpm exec playwright install chromium
node examples/fixtures/web/server.mjs
```

Then, in a second terminal:

```bash
pnpm testpilot manifest validate examples/manifests/fixture-login.yaml
pnpm testpilot manifest generate examples/manifests/fixture-login.yaml
pnpm testpilot run examples/manifests/fixture-login.yaml
```

Explain that output is written beneath `.testpilot/runs/<run-id>/` and includes the HTML/JSON report, generated code, screenshots, DOM/accessibility snapshots, and logs.

- [ ] **Step 3: Add team-mode and capability boundaries**

Document the web demo command:

```bash
pnpm --filter @open-test-pilot/web dev
```

Link `infra/docker/docker-compose.yml` for team services. State plainly that PostgreSQL/Redis/object storage, GitHub credentials, a container registry/cluster, Claude CLI credentials, and physical or configured simulator devices are environment-specific; do not present them as included hosted services.

- [ ] **Step 4: Add the secondary product image and documentation map**

Place:

```markdown
![OpenTestPilot manifest editor](docs/images/opentestpilot-manifest-editor.png)
```

near the manifest/editor explanation. Link at minimum: `docs/MASTER_IMPLEMENTATION_PLAN.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/MANIFEST_DSL_SPEC.md`, `docs/DEPLOYMENT.md`, `docs/GITHUB_INTEGRATION.md`, `docs/ANDROID_APPIUM.md`, `docs/IOS_APPIUM.md`, `docs/SECURITY_MODEL.md`, and `docs/ACCEPTANCE_EVIDENCE.md`.

---

### Task 3: Add the complete Japanese README

**Files:**
- Create: `README.ja.md`

**Interfaces:**
- Consumes: the final English section structure and exact commands from Task 2
- Produces: a complete Japanese landing page with identical commands, links, images, and factual boundaries

- [ ] **Step 1: Translate the full reader journey, not just headings**

Start with:

```markdown
# OpenTestPilot
[English](README.md) | [日本語](README.ja.md)
```

Mirror every English section in the same order. Use natural Japanese aimed at developers and QA engineers. Keep product names, commands, paths, environment-variable names, and filenames unchanged.

- [ ] **Step 2: Verify semantic parity**

Confirm both files describe the same prerequisites, commands, outputs, supported surfaces, optional services, environment gates, documentation links, contribution path, security path, and Apache-2.0 license. Japanese text must not claim a capability beyond the English page.

---

### Task 4: Validate documentation and runnable claims

**Files:**
- Verify: `README.md`
- Verify: `README.ja.md`
- Verify: `docs/images/opentestpilot-overview.png`
- Verify: `docs/images/opentestpilot-manifest-editor.png`

**Interfaces:**
- Consumes: all documentation artifacts from Tasks 1-3
- Produces: evidence that commands, relative links, images, and repository checks pass before push

- [ ] **Step 1: Validate every relative Markdown target**

Run:

```bash
node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = ["README.md", "README.ja.md"];
const missing = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#", 1)[0]);
    if (!existsSync(resolve(dirname(file), target))) missing.push(`${file}: ${raw}`);
  }
}
if (missing.length > 0) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log("All local README targets exist.");
'
```

Expected: `All local README targets exist.`

- [ ] **Step 2: Validate and generate the fixture manifest**

Run:

```bash
pnpm testpilot manifest validate examples/manifests/fixture-login.yaml
pnpm testpilot manifest generate examples/manifests/fixture-login.yaml
```

Expected: both commands exit 0 and the manifest is accepted.

- [ ] **Step 3: Run the documented browser example**

With `node examples/fixtures/web/server.mjs` listening on `127.0.0.1:4173`, run:

```bash
pnpm testpilot run examples/manifests/fixture-login.yaml
```

Expected: exit 0, a passed run, and a new `.testpilot/runs/<run-id>/` report directory.

- [ ] **Step 4: Run repository documentation-adjacent checks**

Run:

```bash
pnpm --filter @open-test-pilot/web lint
pnpm --filter @open-test-pilot/web test
pnpm --filter @open-test-pilot/web build
git diff --check
```

Expected: every command exits 0 and the diff has no whitespace errors.

- [ ] **Step 5: Review the final diff for accuracy and secrets**

Run:

```bash
git diff -- README.md README.ja.md docs/images
git status --short
```

Inspect the images visually. Expected: only the planned README/image changes plus the committed design/plan documents, no secret values, and no unrelated workspace changes.

---

### Task 5: Commit and publish to main

**Files:**
- Commit: `README.md`
- Commit: `README.ja.md`
- Commit: `docs/images/opentestpilot-overview.png`
- Commit: `docs/images/opentestpilot-manifest-editor.png`

**Interfaces:**
- Consumes: a clean, verified Task 4 result
- Produces: the finished bilingual README on `origin/main`

- [ ] **Step 1: Commit the documentation assets**

Run:

```bash
git add README.md README.ja.md docs/images/opentestpilot-overview.png docs/images/opentestpilot-manifest-editor.png
git commit -m "docs: redesign bilingual project README"
```

Expected: one commit containing only the bilingual README and its product screenshots.

- [ ] **Step 2: Confirm the local branch and remote delta**

Run:

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch is `main`, status is clean, and the output lists only the README design, implementation plan, and completed README commits intended for publication.

- [ ] **Step 3: Push the verified commits**

Run:

```bash
git push origin main
```

Expected: the remote reports `main -> main` without a non-fast-forward or authentication error.
