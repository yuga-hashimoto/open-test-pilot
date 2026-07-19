# Configuration

Use `.env.example` as the safe starting point. Copy it to a local file loaded by your process or Compose environment; never commit secrets.

## Local dashboard

The browser-only dashboard needs no environment variables:

```bash
pnpm --filter @open-test-pilot/web dev --host 127.0.0.1 --port 4173
```

## Team mode

The API uses `PORT`, `WEB_ORIGIN`, `AUTH_REQUIRED`, `DATABASE_URL`, `REDIS_URL`, and the `S3_*` settings. Scheduler and runner require a shared `OPENTESTPILOT_ORGANIZATION_ID` (or comma-separated `OPENTESTPILOT_ORGANIZATION_IDS`) and `OPENTESTPILOT_URL`.

When the API requires authentication, pass the session value to integrations with `OPENTESTPILOT_SESSION_TOKEN`; the MCP server sends it as a Bearer token and never places it in tool payloads.

GitHub integration is optional and uses the `GITHUB_*` settings. AI Worker execution is disabled by default; enable it only after setting the worker policy, repository access, and selected agent credentials.

Mobile-only variables (`ANDROID_*`, `OPENTESTPILOT_IOS_*`, `OPENTESTPILOT_APPIUM_URL`) are documented in [Android with Appium](ANDROID_APPIUM.md) and [iOS with Appium](IOS_APPIUM.md).

## Troubleshooting checklist

1. Confirm the API URL and organization ID match in every daemon.
2. Confirm Postgres, Redis, and object storage are reachable from the process, not only from the host.
3. Inspect `.testpilot/` evidence and the API logs; do not infer a deployed/hosted result from a local green test.
