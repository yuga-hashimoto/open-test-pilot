# OpenTestPilot README Redesign

Date: 2026-07-19  
Status: Approved for implementation

## Purpose

Make OpenTestPilot understandable to a first-time visitor without requiring them to inspect the source tree or architecture documents. Provide complete English and Japanese entry points, show the real web interface, and separate the quick local CLI experience from the larger team control-plane setup.

## Audience and success criteria

The primary audience is a developer, QA engineer, or OSS evaluator arriving from GitHub for the first time. Within the first screenful they should understand:

- what OpenTestPilot is;
- which web and mobile testing problems it addresses;
- what makes it different from using Playwright or Appium alone;
- where to start in English or Japanese;
- what the product UI looks like.

A reader should then be able to run the smallest local example, understand the generated artifacts, and find the relevant team-mode, architecture, mobile, GitHub, security, and contribution documentation.

## Approaches considered

### 1. Keep one bilingual README

This keeps everything in one file, but doubles its length, makes headings noisy, and is difficult to maintain or scan on GitHub.

### 2. English root README plus a complete Japanese README

Use `README.md` as the default English landing page and `README.ja.md` as a complete Japanese counterpart, with a language switch at the top of both. This follows common multilingual OSS practice and gives each audience a clean reading flow.

### 3. Short root landing page plus language-specific documents

Use the root README only as a language selector and move both languages elsewhere. This is tidy internally but wastes GitHub's most valuable landing surface and weakens search and repository previews.

Approach 2 is selected.

## Information architecture

Both language versions will share the same section order and claims:

1. Product name, one-sentence value proposition, language switch, and project badges.
2. Real dashboard screenshot.
3. A short “Why OpenTestPilot?” explanation and a concise feature matrix.
4. A human-readable manifest example showing the product's core abstraction.
5. A minimal local quick start that uses the included fixture and produces a real report.
6. A “How it works” flow from manifest to generated Playwright/Appium execution and evidence.
7. Web dashboard and team-mode startup instructions, clearly separated from the local CLI path.
8. Supported surfaces and explicit environment-dependent boundaries.
9. Repository map and links to detailed documentation.
10. Development verification, contributing, security, and Apache-2.0 license.

The README will link to detailed documents instead of duplicating architecture specifications.

## OSS references

The redesign borrows presentation patterns, not wording:

- Playwright: an immediate definition, workflow-oriented getting-started choices, small runnable examples, and capability summaries.
- Maestro: a plain-language value proposition, human-readable YAML near the top, and a short path to the first successful run.
- Appium: a clear description of the platform boundary, modular components, and installation caveats.

OpenTestPilot's README will combine these with its own differentiator: one structured manifest feeding generated tests, browser and mobile adapters, evidence capture, team operation, GitHub integration, and policy-gated AI repair.

## Screenshot plan

Create repository-owned images under `docs/images/` from the current local web application, using a real browser at desktop size. Capture only stable product surfaces that are already implemented:

- the Overview dashboard as the primary hero image;
- the manifest editor or run-evidence view as a secondary product image if it can be shown without misleading demo or error state.

Screenshots must use the current UI, avoid exposing credentials or machine-specific information, use a consistent viewport, and remain readable on GitHub. If the live API is unhealthy, use the application's intentional demo mode rather than presenting an error banner as a healthy team deployment. Image alt text and captions will be localized in each README.

## Accuracy boundaries

The README must not imply that npm publication, GHCR publication, cloud deployment, external secrets, a live Claude Code worker, or physical mobile-device readiness is automatic. It will distinguish:

- the local CLI example that can be reproduced from the repository;
- optional team services and integrations;
- deployment- or credential-dependent capabilities;
- device-specific Appium requirements.

## Verification

- Run every documented local command that is practical in the current workspace, including manifest validation and the included fixture flow.
- Start the web application through its documented path and inspect the pages used for screenshots.
- Verify every relative link and every local image reference in both READMEs.
- Confirm the English and Japanese files have matching section coverage and do not contradict one another.
- Run the repository's relevant documentation/build checks and inspect the final Markdown diff.

## Files

- Replace `README.md` with the redesigned English version.
- Add `README.ja.md` as the complete Japanese version.
- Add stable UI captures under `docs/images/`.
- Do not change product behavior or API contracts.
