# Capability status

This page is the current boundary between repository evidence and operator/external gates. It should be updated when a capability changes.

| Capability | Local evidence | External/operator gate |
| --- | --- | --- |
| Manifest validation and generation | CLI tests, examples, generated snapshot gate | None for local use |
| Local Playwright/API execution | `pnpm test`, integration fixtures, `.testpilot/runs` | Browser binaries and target service availability |
| Responsive dashboard | `pnpm test:web:ui` | Hosted URL/auth deployment if used |
| Team API, runner, scheduler | unit/integration tests and Docker/Helm assets | Postgres/Redis/S3, secrets, network, runner capacity |
| MCP/Claude Code integration | MCP protocol tests and plugin validator | session token, reachable API, installed client |
| AI repair | policy and workflow tests | selected agent CLI, repository access, human approval |
| Android/iOS | adapter tests and platform-specific docs | Appium/Xcode/device/WDA availability; real-device evidence is separate |
| Release artifacts | release script and manifest | registry publication, signed assets, deployment |

Historical troubleshooting notes in platform docs are not proof of current success. Pair them with the latest acceptance evidence and the verification command that produced it.
