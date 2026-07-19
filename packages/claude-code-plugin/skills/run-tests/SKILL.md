# Run tests

Run the generated test through the requested Runner. Long operations are asynchronous in team mode. Preserve commit SHA, browser/device, environment, Runner, Step/Action IDs, and all configured artifacts.

For local execution prefer `testpilot run <manifest> --json`: it prints a single JSON object with `ok`, `runId`, `status`, `reportPath`, `htmlReportPath`, and a `failures` array (stepId, actionId, type, structured error) that can be parsed instead of scraping prose output.
