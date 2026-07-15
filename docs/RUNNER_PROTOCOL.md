# Runner Protocol

Jobs are asynchronous and contain `jobId`, `runId`, organization/project scope, source revision, Manifest, capabilities, execution mode, timeout, retry policy, and artifact policy. Runners register capabilities, acquire a lease, heartbeat, emit step/action events, store artifacts, and close the lease with a Result Protocol envelope.

The protocol defines queued, leased, running, passed, failed, cancelled, expired, and rejected states; duplicate prevention by job/run identity; cancellation; timeout; and reassignment after heartbeat loss. Shared execution is Docker-isolated. Trusted host execution requires administrator policy.
