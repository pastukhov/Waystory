# Repository instructions

## Auto-merge and delivery

The repository owner has explicitly authorized automatic merging of completed work. This is a standing instruction for future sessions in this repository.

- For changes requested by the user, create or update a pull request and enable GitHub auto-merge without asking for merge confirmation again.
- Merge after all required checks pass and review findings are addressed. If auto-merge is unavailable, merge directly once these conditions are met, verifying the current PR head first.
- Investigate and fix failing checks and actionable review findings within the requested scope; resolve review threads only after addressing or verifying them. Do not bypass branch protection or required checks.
- Continue through the merge and verify the resulting main-branch CI and automatic deployment when configured. Report the actual merge and deployment status; do not describe queued or running jobs as successful.
- Do not stop at "the PR is ready" or ask whether to merge. Ask only when a genuine blocker requires information or a decision that is not already authorized.
- A later explicit user instruction to pause, keep a draft, or not merge overrides this default for that task.

## Production diagnostics

- Use the **Diagnostic logs** workflow (`logs.yml`) to read Loki through the private-network runner. Setup, discovery and filters are documented in `docs/loki-diagnostics.md`.
- When the user provides a Loki address but no selector, use `mode=discover` to identify streams; do not require the user to find labels manually. Temporary unauthenticated `loki_url` and `selector` inputs are supported when repository settings are absent.
- Download the report artifact, or use `gh run view RUN_ID --log` and parse `waystory_log_export` records when artifact downloads fail. Analyze the sanitized events locally instead of dumping the whole log into conversation.
- Prefer request ID/place/time filters. Check truncation and discarded counts; empty or partial results do not establish that no failures occurred. Older deployments may lack detailed review events.
