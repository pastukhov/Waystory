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

### Verified Loki connection (2026-10-17)

- Repository: `pastukhov/Waystory`; application: `https://ws.nayg.ru`.
- Loki is reachable **from the self-hosted runner on ovoi** at `http://192.168.11.2:3100`. Do not try to reach this private address directly from the cloud workspace.
- Verified stable selector: `{container="waystory-waystory-1"}`. Other discovered labels include `compose_service="waystory"` and `compose_project="waystory"`.
- No Loki authentication was needed in the verified run. Use the temporary workflow inputs below when repository settings are absent. Configured `LOKI_URL`/`LOKI_SELECTOR` take precedence; never send stored credentials to a temporary address.
- Artifact downloads returned HTTP 403 from the blob host in this environment, but Actions run logs were readable. Use the run-log fallback rather than asking the user to download logs manually.
- Verification run `39037943464` returned 136 recognized events for one hour, with zero discarded records and no truncation. Multiple application revisions were present, confirming access to logs predating deployment. This is a historical check, not a guarantee of current connectivity or retention.

For a new incident, dispatch a fresh report (add `request_id`, `place_id`, or UTC `end_utc` when known):

```sh
gh workflow run logs.yml -R pastukhov/Waystory --ref main \
  -f mode=logs -f hours=1 \
  -f loki_url=http://192.168.11.2:3100 \
  -f 'selector={container="waystory-waystory-1"}'
gh run list -R pastukhov/Waystory --workflow logs.yml --limit 5
# Select the run just dispatched, wait for it, then save its log locally:
gh run watch RUN_ID -R pastukhov/Waystory --exit-status
gh run view RUN_ID -R pastukhov/Waystory --log > /tmp/waystory-diagnostics.log
```

Parse JSON records beginning with `{"event":"waystory_log_export"` after the Actions log prefix. Read the final summary and verify that the parsed count equals `exported`; inspect `truncated` and `discarded` before drawing conclusions. Do this investigation autonomously before requesting manual server commands or screenshots from the user. If connectivity/authentication has changed, report the actual failure and ask only for the missing configuration.
