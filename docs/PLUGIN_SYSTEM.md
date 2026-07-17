# Plugin System

Custom Actions declare type, title, input/output JSON Schema, permissions, UI schema, secret references, artifact behavior, and error categories. Plugin API versions use semver compatibility checks and a capability manifest. Plugins run under Runner policy; external plugins cannot bypass tenant, secret, network, or filesystem controls.

The current `@open-test-pilot/custom-action-sdk` provides versioned `defineAction`, permission metadata, execution context, and duplicate-safe `ActionRegistry`. External developers can package an action module and run it through `testpilot run --actions <module>`; the team Server also exposes tenant-scoped `POST /v1/organizations/{organizationId}/plugins`, `POST /v1/plugins/{pluginId}/versions`, and corresponding list endpoints for publishing the JSON metadata contract and version history. The server stores metadata only: executable code remains in the reviewed plugin package supplied to the Runner, so publishing cannot inject arbitrary server-side code.

Source Analyzers and Notification providers use the same registry pattern. Plugin discovery is explicit and audited; no package is loaded from an untrusted repository without policy approval.
