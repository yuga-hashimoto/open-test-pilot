# Test Strategy

Pure package contracts use unit and property tests. Parser and generator use schema, semantic, snapshot, and deterministic-output tests. Runner and server use integration fixtures with real Playwright, PostgreSQL, object storage, and Docker where the capability is under test. Web flows use Playwright E2E. Mobile flows use Appium against explicit emulator/simulator capabilities.

No mock-only result is accepted as completion evidence. Tests that depend on unavailable browsers, devices, credentials, or external GitHub services report the exact unavailable capability.
