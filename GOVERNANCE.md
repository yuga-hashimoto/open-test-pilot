# OpenTestPilot Governance

OpenTestPilot is governed as an open-source project under the Apache License
2.0. Technical decisions are made in the repository through reviewed pull
requests and Architecture Decision Records under `docs/adr/`.

## Maintainers

Maintainers are responsible for reviewing contributions, protecting the
security model, preserving tenant isolation, and keeping release artifacts
reproducible. A maintainer may merge a change only after the applicable CI
checks pass and the change has an accountable reviewer.

## Contributions

Contributors should read `CONTRIBUTING.md`, follow the Code of Conduct, and
include tests and documentation for behavior changes. New public protocol or
Manifest changes require versioning and compatibility tests. Security issues
must follow `SECURITY.md` rather than being disclosed in a public issue.

## Decision process

Large architectural changes require an ADR and a staged implementation plan.
Changes affecting authentication, secrets, execution isolation, or tenant
boundaries require an explicit security review. The project does not collect
external telemetry; operational data must remain within destinations selected
by the self-hosting operator.

## Releases

Releases are produced from reviewed commits and must include the generated
license report, changelog, migration guidance, and reproducible package and
deployment artifacts. Release automation must not publish credentials,
secret-bearing fixtures, or unreviewed generated changes.
