# Failure Repair Specification

The runner records evidence before repair. Failure classification is one of `TEST_IMPLEMENTATION_ERROR`, `LOCATOR_CHANGED`, `WAIT_CONDITION_ERROR`, `TEST_DATA_ERROR`, `ENVIRONMENT_ERROR`, `NETWORK_ERROR`, `PRODUCT_DEFECT`, `SPECIFICATION_MISMATCH`, or `UNKNOWN`.

Repair requests include failed Manifest node, generated-code range, evidence, source revision, previous attempts, and forbidden transformations. Default maximum attempts is three; repeated identical causes stop early. Product defects and app-code changes are reported for approval rather than hidden by weakening tests.
