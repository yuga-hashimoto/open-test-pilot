# Master Implementation Plan

This is the canonical dependency-ordered plan for the complete OpenTestPilot platform. The detailed task-by-task checklist is [the implementation plan](superpowers/plans/2026-07-16-open-test-pilot-implementation.md). The first executable slice is the local Manifest → generated Playwright → Chromium → evidence → HTML report path.

Dependency graph:

```text
P-001/P-002 → C-001 → C-002/C-003 → M-001 → M-002 → M-003 → R-001 → R-002 → R-003 → R-004
                                                        └──────────────→ A-001/A-002
M/R/C → S-001/S-002 → T-001 → T-002 → T-003 → W-001 → W-002 → W-003
T-001/T-002 → D-001 → D-002 → D-003
C/M/R → X-001/X-002/X-003/X-004 → AI-001 → AI-002 → Q-001
```

Each task specifies purpose, packages, files, dependencies, tests, completion criteria, risks, and rollback. A task is not complete when only its types or UI exist; its focused tests and required integration lane must pass.

Release gates are: local vertical slice; source-first analysis and safe repair; tenant-safe API/GitHub team mode; distributed Docker Runner; API/mobile/mixed execution; AI Worker; CI/CD and self-hosted release artifacts.
