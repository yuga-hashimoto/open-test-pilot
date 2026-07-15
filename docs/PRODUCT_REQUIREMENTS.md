# Product Requirements

OpenTestPilot is a self-hostable, code-first test automation platform with a Web-editable YAML Manifest and generated standard TypeScript. Claude Code is the first supported AI client; server protocols remain agent-neutral.

The product supports local and team modes, Web/API/Mobile execution, source-first test design, evidence-driven failure classification, safe repair proposals, GitHub-backed versioning, distributed Runners, custom Actions, and tenant isolation. Local mode must work without a server. Team mode must not treat an uploaded artifact as the Git source of truth.

The first release slice is the local Web flow documented in `docs/superpowers/specs/2026-07-16-open-test-pilot-foundation-design.md`. Completion of the whole product is governed by `docs/MASTER_IMPLEMENTATION_PLAN.md` and its acceptance scenarios.
