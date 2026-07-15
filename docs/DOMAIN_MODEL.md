# Domain Model

Tenant roots are User, Organization, Membership, Project, Repository, Environment, and Secret. Test roots are Test, TestVersion, Manifest, GeneratedCode, ChangeRequest, and PluginVersion. Execution roots are Runner, RunnerGroup, Job, Schedule, Run, TestResult, StepResult, ActionResult, Artifact, and RepairAttempt.

Every tenant-owned record has `organizationId`. A TestVersion points to a Git commit and immutable Manifest/GeneratedCode content. A Run points to the selected TestVersion, source revision, Runner, environment, and browser/device metadata. Step and Action results reference stable Manifest IDs and generated-code mappings.
