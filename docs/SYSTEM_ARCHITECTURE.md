# System Architecture

The system is a pnpm TypeScript monorepo with protocol-first package boundaries. Manifest parsing and generation are pure libraries. Local, hosted, and self-hosted execution implement the Runner Protocol. The Web console and API compose the same domain packages used by the CLI.

Data flow: source analyzer → normalized findings → Manifest → generated code → Runner job → Result Protocol → Storage Adapter → report/UI. Agent requests use the Agent Protocol and may be served by Claude Code, a self-hosted AI Worker, or future adapters.

The control plane owns tenancy, GitHub metadata, jobs, schedules, secrets metadata, artifact references, audit records, and notifications. Runners own execution and evidence collection, never cross-tenant data, and never write product code without explicit approval.
