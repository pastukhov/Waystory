# Operations without SSH

The **Operations** workflow runs on the existing Waystory self-hosted runner. It accepts only six operations; no arbitrary shell commands, paths or secrets are accepted as workflow inputs.

- `diagnose`: container status/image/restart count, recent allowlisted provider error records, Google setup availability, anonymous session and denied paid endpoints. No paid calls.
- `speech-test`: two short fixed synthesis requests, Russian and English. Uses the production speech adapter to read and validate the complete MP3; reports byte count, duration and redacted upstream failures. Does not submit user stories, store audio or print credentials. These two calls can incur provider charges.
- `speech-format-test`: two fixed Russian probes (Filipp/OggOpus and Marina/MP3) to isolate format/voice failures. These calls can incur provider charges.
- `ai-test`: one fixed short prompt (maximum 32 output tokens), then the real story generator with a fixed public Aunesis excerpt and its configured timeout. Reports whether the story passed validation; no user text or generated story is logged. These two requests can incur provider charges.
- `restart`: recreate the current image with the current server dotenv file, then diagnose.
- `rollback`: recreate the previously healthy locally available `waystory:<commit>` image, then diagnose. Persistent data is kept. This changes the image, not the environment file or schema; use only when the older image is compatible with current data. A later deployment of main will replace it again.

## Manual launch

GitHub → Actions → Operations → Run workflow → main → operation. Do not paste secrets. The workflow ignores other refs. Workflow logs contain the report.

## Launch through the assistant's GitHub connection

The current connector can create PRs and read job logs but cannot dispatch arbitrary workflows. Instead, update `ops/request.json` through a reviewed PR:

```json
{"id":"20261011-speech-diagnosis-2","operation":"speech-test"}
```

The ID must be new, 6–80 lowercase letters/digits/hyphens, starting with a letter/digit. Only the two shown properties are accepted. Following a successful deployment, Operations detects a changed request file and executes it once. On ordinary deployments it runs only free diagnostics. Claims in `/opt/waystory/operations/requests/` prevent a rerun of the same request from repeating a paid test or a restart/rollback, including after partial failure. To retry, submit a new ID. Manual runs use a unique run/attempt ID.

Operations and Deploy share one concurrency group. Stale revisions are skipped. Workflow code runs only from protected main, following CI and Deploy for repository requests. Pull request code never executes on the VM before merge.

The deploy script maintains the current and previous verified healthy images independently of the running container; failed deployments never replace these records. Automatic operations also require the deployed image SHA to match the checked-out revision. The deploy script records the previous healthy image in `/opt/waystory/operations/previous-image`; initially no rollback exists until a successful deployment has replaced an existing image. Never prune that image if you want rollback available. Both Compose files rotate Docker logs (10 MB × 3).

## Privacy and diagnostics

Application error logging reconstructs a fixed schema: service (AI/speech), upstream HTTP status (null for transport failure), duration and a locally generated request ID. No body, model input, cookies or provider credentials are logged. Operations emits only records matching this schema, not raw Docker logs. Detailed upstream error bodies are available only for the fixed diagnostic probes, after credential redaction. Public API callers do not gain a diagnostics endpoint or a way to bypass authentication.
