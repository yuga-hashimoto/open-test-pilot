# Multitenancy

Organizations are the tenant boundary. Users can belong to multiple organizations with independent roles. Organization ID is mandatory in domain records, API context, storage keys, queue payloads, logs, artifact paths, and audit events. PostgreSQL RLS provides defense in depth and tests must include cross-tenant denial.

Platform roles are Organization Owner/Admin, Project Admin, Test Editor, Test Runner, Secret User/Admin, Runner Admin, and Viewer. GitHub repository permissions are synchronized with these Platform roles and can only reduce access, never expand repository authority.
