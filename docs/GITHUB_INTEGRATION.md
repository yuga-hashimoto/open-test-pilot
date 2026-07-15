# GitHub Integration

GitHub OAuth is the only user authentication method. A GitHub App supplies installation access for clone/fetch, push, webhooks, Pull Requests, Checks, Commit Status, and PR comments. The server treats GitHub as the source repository; Claude Code uploads are proposals or artifacts, not a replacement source of truth.

The current foundation includes `@open-test-pilot/github-adapter` with OAuth authorization URL construction, code exchange, GitHub API repository lookup, and timing-safe `X-Hub-Signature-256` verification. Credentials are supplied through deployment configuration; tokens are never written to Manifests or returned in logs.

The default edit path creates a dedicated branch and Pull Request. Protected branches cannot receive direct commits. Repository permission loss revokes Platform project access. Webhook signatures, installation ownership, branch/PR state, and commit SHA are persisted and audited.
