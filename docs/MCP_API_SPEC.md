# MCP API Specification

The MCP surface exposes bounded tools: `organization_get`, `project_get`, `repository_get`, `test_list`, `test_get`, `test_get_manifest`, `test_get_generated_code`, `change_request_list`, `change_request_get`, `change_request_update`, `run_start`, `run_get_status`, `run_get_failures`, `run_get_step`, `run_compare`, `artifact_get`, `repair_register`, `pull_request_register`, and `report_get_url`.

Tools return structured JSON and stable IDs. `run_start` returns immediately with `runId`; status and evidence are retrieved separately. All tools require tenant and authorization context supplied by the authenticated connector.
