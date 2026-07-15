# GitHub Integration

GitHub OAuth is the only user authentication method. A GitHub App supplies installation access for clone/fetch, push, webhooks, Pull Requests, Checks, Commit Status, and PR comments. The server treats GitHub as the source repository; Claude Code uploads are proposals or artifacts, not a replacement source of truth.

The default edit path creates a dedicated branch and Pull Request. Protected branches cannot receive direct commits. Repository permission loss revokes Platform project access. Webhook signatures, installation ownership, branch/PR state, and commit SHA are persisted and audited.
