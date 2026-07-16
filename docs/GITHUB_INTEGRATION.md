# GitHub Integration

GitHub OAuth is the only user authentication method. A GitHub App supplies short-lived installation access for clone/fetch, push, webhooks, Pull Requests, Checks, Commit Status, and PR comments. The adapter signs the App JWT with the configured private key, exchanges it for an installation token, and never returns that token from the server's OAuth callback. The server treats GitHub as the source repository; Claude Code uploads are proposals or artifacts, not a replacement source of truth.

The current foundation includes `@open-test-pilot/github-adapter` with OAuth authorization URL construction, code exchange, GitHub App JWT signing, installation-token exchange, repository lookup, branch/commit/PR/check/status/comment operations, and timing-safe `X-Hub-Signature-256` verification. Credentials are supplied through deployment configuration; tokens are never written to Manifests or returned in logs.

For a local GitHub App installation, configure `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY_PATH`. Keep the downloaded PEM outside version control; this repository ignores `.secrets/`. The reference App uses repository permissions for Checks, Commit statuses, Contents, Issues, and Pull requests, plus mandatory Metadata read access. Installation tokens are short-lived and must be requested at runtime rather than stored.

The local Server exposes `GET /auth/github/start` and `GET /auth/github/callback`. It stores one-time OAuth state in the server session and returns only authentication metadata after a successful code exchange; it never returns the GitHub access token to the browser response.

The default edit path creates a dedicated branch and Pull Request. Protected branches cannot receive direct commits. Repository permission loss revokes Platform project access. Webhook signatures, installation ownership, branch/PR state, and commit SHA are persisted and audited.
