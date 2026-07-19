# Pre-run safety hook

Before executing a Manifest (`testpilot run` locally, or `run_start` in team mode), inspect it for destructive-operation signals and require explicit human approval through Claude Code before the run proceeds. This hook exists so an agent never silently sends a real payment, deletes real data, or notifies a real customer while "just running a test."

## Destructive-operation signals to enumerate

Scan the Manifest's actions, URLs, and request bodies for:

- **Payment** — `api.request`/`web.*` actions whose URL, action `name`, or body references payment, checkout charge, or billing endpoints (e.g. `/charge`, `/payments`, `/checkout/complete`), or a `web.click` on a pay/purchase confirmation control.
- **Order confirmation** — any action that finalizes/places/ships an order rather than merely viewing a cart or draft.
- **External notification** — anything that could send a real email, SMS, push notification, or webhook to a real recipient (look for `api.request` calls to notification/messaging endpoints, or forms whose submission triggers one).
- **Deletion** — account deletion, data deletion, or any `DELETE`/destructive `POST` against non-test resources.
- **Production URLs** — `web.goto`/`api.request` targeting a non-local, non-staging host (i.e. not `127.0.0.1`/`localhost`/an explicitly configured test environment). Cross-reference `allowedHosts` on `api.request` actions and the Manifest's `permissions.networkAccess`.

## Required behavior

- When any signal above is present, stop before execution and ask the user for explicit approval through Claude Code, naming the specific action(s) and why they were flagged (e.g. "action `submit-payment` posts to `https://api.example.com/charge` — a production host"). Do not proceed on an assumption of consent.
- Approval is per-run, not a standing grant — re-ask on a subsequent run if the Manifest changed or if using a fresh session without a recorded prior approval.
- If the user declines, do not run the Manifest; suggest scoping it to a safe/staging target instead, or removing/mocking the destructive step (e.g. via a Custom Action with a test double), which then goes through normal review.

## Secret handling

- Never echo secret values to the model, logs, or the approval prompt — reference them by name only (the `secrets:` entry's `name`, never its resolved value).
- If a diagnostic or evidence payload would leak a secret value (e.g. an HTTP exchange capturing an Authorization header), redact it before it reaches the model or any output shown to the user.
