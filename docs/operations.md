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

Открытые источники: операция `sources-test` выполняет bounded-поиск в трёх фиксированных
публичных точках и отдельно собирает материалы через штатные адаптеры/каталог.
Общий deadline — 110 секунд; не более 3 мест на точку, до 15 секунд на сбор места.
Для Alanya tower и Paris нужен хотя бы один непустой текст, разрешённый для model input.
Редкое покрытие может честно показать ноль. Выводятся found/testedPlaces/withMaterials,
число материалов, статусы discovery и сборщиков, имена/координаты и задержки cold/repeat
(cache — только при здоровом discovery и совпадающих ID). Тексты не печатаются. Ключи ИИ
и web-поиск не используются. `web-source-test` отдельно и явно платный (до 2 search
calls), выключен без ключа, бюджета и прав доменов. Diagnose выводит только флаги
конфигурации, размеры кэша и остаток бюджета. Аргументы и URL от пользователя не принимаются.
См. [sources.md](sources.md) для прав, качества и отката через `MULTISOURCE_ENABLED=false`.


## История логов в Loki

Отдельный workflow **Diagnostic logs** читает Loki из локальной сети через runner и прикладывает очищенный отчёт к запуску GitHub Actions. Доступны фильтры времени, места и request ID; приложение не перезапускается. Настройки и ограничения: [loki-diagnostics.md](loki-diagnostics.md).

Progressive tours: `tour-fixtures-test` uses no network or paid provider and covers station, sparse, foreign-language and wrong-object evidence through the service. CI runs the same fixtures. `kuskovo-tour-test` is a paid fixed diagnostic for wikipedia/ru/173387, Russian: normal research → one plan → overview and first three available themes sequentially → only the first overview TTS fragment. It uses the configured providers, source policy, normal stored snapshot and existing allowlisted owner's AI/TTS quota subject. Each diagnostic creates fresh work through an internal service option, preserving existing owner tours while applying normal storage caps and quotas; cached tour output alone cannot pass current-revision acceptance. HTTP callers cannot request this option. It creates no cookies/session and cannot validate the owner's browser. No arbitrary place, URL, model or prompt inputs are accepted. Limits remain four search calls, one planning call, twenty chapter model calls (including reviews/repair), existing daily quotas and service deadlines. Missing/failed chapters, missing attribution, repetition or TTS failure fail the operation. Output contains only enum reasons, statuses, timings, counts and reported tokens; unknown prices are not estimated.

`diagnose` reports source database file bytes and filesystem available/total bytes, plus catalog logical cache bytes. Investigate the cause of low disk space before any cleanup; the diagnostic does not delete application data. A critical regression uses the existing `rollback` operation and recorded previous healthy image. Tour schema migrations are additive: keep tour tables, source snapshots and verified chapters across rollback. Never drop tour tables or audio/source data as a rollback step. There is no server audio cache in v1.

Acceptance requires successful CI and Deploy for the exact main SHA, real Kuskovo overview plus three distinct verified themes, reported source attribution and usage, then owner-authenticated browser and physical Chrome Android checks. Playwright fixtures and the server-side Operations diagnostic do not establish device sound, background playback or real-session reload behavior. First audio p95 <8 seconds and prefetched boundary gap <1 second remain measurement targets; a single server TTS call does not establish a p95.
