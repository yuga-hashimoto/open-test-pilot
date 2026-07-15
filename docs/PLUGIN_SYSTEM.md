# Plugin System

Custom Actions declare type, title, input/output JSON Schema, permissions, UI schema, secret references, artifact behavior, and error categories. Plugin API versions use semver compatibility checks and a capability manifest. Plugins run under Runner policy; external plugins cannot bypass tenant, secret, network, or filesystem controls.

Source Analyzers and Notification providers use the same registry pattern. Plugin discovery is explicit and audited; no package is loaded from an untrusted repository without policy approval.
