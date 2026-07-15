# Artifact Model

Artifacts are immutable metadata records linked to organization, project, run, test, step, action, and source revision. Supported types include screenshots, video, Playwright trace, DOM, accessibility tree, Appium Page Source, console/network/API logs, logcat, generated code, and runner logs.

Bodies are stored through a Storage Adapter (local filesystem, server disk, S3, MinIO, or R2-compatible). Retention supports success/failure policies, fixed retention, generated-code retention, capacity limits, automatic deletion, and deletion audit events.

The local Storage Adapter namespaces every path by `organizationId` and rejects traversal outside that namespace. S3-compatible adapters must preserve the same key contract.
