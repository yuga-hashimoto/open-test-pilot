# Agent Protocol

Agent-neutral operations are analyze, design, generate, run, analyze-failure, repair, publish, and review. Requests include protocol version, repository revision, organization/project context, constraints, requested artifacts, and approval policy. Results include findings, proposed changes, Manifest/code artifacts, evidence references, and optional Pull Request intent.

Claude Code Plugin and the future Codex/OpenCode adapters implement this protocol. Long-running work returns a request/job ID; no MCP session or synchronous HTTP request is held open during execution.
