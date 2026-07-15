# Pre-run safety hook

Before executing a test, inspect the Manifest permissions and identify destructive operations such as payment, order confirmation, external notifications, account deletion, production writes, or data deletion. Ask the user for approval through Claude Code for those operations. Do not return secret values to the model.
