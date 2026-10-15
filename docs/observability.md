# Waystory → VictoriaMetrics → Grafana

This release supplies application instrumentation and configuration files. It
does not connect to, install or modify your monitoring infrastructure.

## Connect later

1. Create a dedicated random token (32–512 characters from `A-Z a-z 0-9 _ -`).
   Store it as repository Actions secret **METRICS_TOKEN**. Do not reuse a Tavily,
   Yandex or Google credential. The next deployment writes it to the VM environment
   without printing it; an unset GitHub secret preserves an existing VM token.
   A removed GitHub secret does not revoke the VM token: remove METRICS_TOKEN from
   `/opt/waystory/.env` and recreate the container to disable scraping.
2. Store the same token in a protected file on the monitoring host, for example
   `/etc/vmagent/secrets/waystory-metrics-token` (readable only by vmagent).
3. Merge [vmagent.yml](../monitoring/vmagent.yml) into your existing scrape config.
   Production Compose publishes TCP/5173 on `0.0.0.0` so a collector can connect
   over the VPN. Replace the example target with the host's VPN IP. This direct
   private endpoint uses HTTP; allow TCP/5173 in the host firewall only from the
   monitoring host over the VPN. The application additionally requires the token.
   Do not put the token in the URL. The public HTTPS endpoint through nginx remains
   available if you prefer to scrape through that route.
4. Reload the collector. In VictoriaMetrics query `up{job="waystory"}`: expect 1.
5. Import [grafana-dashboard.json](../monitoring/grafana-dashboard.json) into Grafana.
   Choose your VictoriaMetrics **Prometheus-compatible datasource** in the dashboard
   dropdown, then job and instance. It uses standard PromQL; no Grafana plugins or
   recording rules are required. Tested with Grafana 11.6 and Prometheus 3.2.
6. Load [alerts.yml](../monitoring/alerts.yml) in your existing vmalert, connected to
   VictoriaMetrics and your existing Alertmanager. Rename the job selector if needed.
   Rules alone do not configure notification delivery. Keep your current routing.

Without METRICS_TOKEN, `/metrics` returns 404. With it, missing or wrong bearer
authorization returns 401. Cookies and query parameters do not grant access.
Only authenticated GET is supported. Scrape responses have `Cache-Control: no-store`.
Deployment publishes port 5173 on all host interfaces, so firewall access to this
port to the VPN monitoring host. Deployment success does not prove that a remote
collector can reach the endpoint; verify the target after deployment.

To test from the collector without placing the token in process arguments:

```bash
python3 - <<'PY'
from pathlib import Path
from urllib.request import Request, urlopen
secret = Path('/etc/vmagent/secrets/waystory-metrics-token').read_text().strip()
request = Request('https://ws.nayg.ru/metrics', headers={'Authorization': 'Bearer '+secret})
with urlopen(request, timeout=10) as response:
    print('HTTP', response.status)
    print(response.read().decode())
PY
```

No remote paid calls occur during a scrape. Start with 30-second scrapes; configure
retention in your existing VictoriaMetrics (e.g. 30 days initially).

## What the metrics mean

All application metrics start with `waystory_`. Registry schemas live in
`server/observability.mjs`. IDs, place names, coordinates, emails, URLs and request
text are never metric labels. Route, method, provider, operation, stage, outcome,
cache result and token kind use finite allowlists. The build revision changes
only on deployment. Normal deployment and process restarts reset in-memory
counters and provider observation timestamps; use `rate`/`increase`, not subtraction.
The instance label should stay stable across container restarts.

- `http_requests_total`, `http_request_duration_seconds`: complete server request
  lifetime, normalized routes. Scrapes are excluded. A disconnected response is 499.
- `provider_access_denied_total`: preinitialized per-provider 401/403 counter for
  access-denied alerts, including the first failures after a successful scrape.
  Sparse detailed HTTP series only appear after their first event; `rate`/`increase`
  cannot recover events before that first sample.
- `provider_requests_total`: individual outbound HTTP attempts, not logical stories.
  `success` means HTTP 2xx only. Duration measures time to response headers, while
  domain-stage duration includes parsing/validation/body reading. `none` status
  means no HTTP response. HTTP 403 is access denied, not proof of an invalid key,
  geographic block, or exhausted credit balance.
- `provider_configured`: configuration only. `provider_last_status_code=0` means
  no response observed since startup or the latest attempt had no HTTP response.
  `provider_last_success_timestamp_seconds=0` means no success observed since
  startup. Neither is a live health probe. Separate Operations processes do not
  update the running application's registry.
- `stage_operations_total`, `stage_duration_seconds`: discovery, acquisition,
  generation, review, speech. A source coverage outcome (`no_material`) is distinct
  from provider unavailability. Review `rejected` means failed evidence validation;
  it is not proof that the generated text is false. Technical review errors remain
  `error`. Acquisition includes completed cache/shared requests; generation and
  speech count work after validation and cache lookup. Cache hits do not bill a
  provider again. Admission/validation errors remain visible in HTTP metrics.
- `source_candidates_total`: identity matching decisions for candidates actually
  examined (processing stops at the accepted-document limit); `source_documents_total`
  counts accepted documents, not all search results. These are not unique web pages.
- `discovery_results`: counts returned by server-side nearby/search operations on
  cache misses. Browser radius expansion can make several server requests.
- `ai_tokens_total`: only the provider's reported input/output token counts,
  including the separate review request. `ai_usage_missing_total` tracks unreported
  usage. No missing usage is estimated as zero cost. `tts_characters_requested_total`
  counts code points sent for synthesis, including failures; it is not billed usage.
- `tavily_daily_calls_remaining/limit`: persisted SQLite **call reservations** for
  current UTC day, shared across Tavily paths, including failed reservations. They
  survive process restart and reset at UTC midnight. They are not actual credits
  or remaining balance in the Tavily account. `tavily_budget_available=0` means the
  database cannot be read; remaining/limit samples are omitted rather than invented.
- Process memory, CPU, uptime and revision describe this Node process, not the host.

## Logs and troubleshooting

The application generates X-Request-ID; client-provided IDs are not trusted.
Search Docker JSON logs for that UUID to correlate `waystory_request`,
`waystory_provider`, `waystory_stage`, legacy provider errors and source decisions.
Docker supplies event timestamps. Source cache/shared work can retain an earlier
`diagnosticId`; each acquisition stage links the current request to that ID.
Request IDs belong in log fields, never metric labels.

The log schema excludes credentials, request bodies, provider bodies, query text,
coordinates and generated text. Existing source diagnostics may include a public
place ID. `safeLogLine` preserves the allowlisted HTTP status when Operations
filters logs. No remote log backend is installed; ship Docker logs using your
existing collector to VictoriaLogs/Loki when convenient. The dashboard needs only
metrics and does not assume a log datasource UID.

For Tavily: inspect configuration, last status and last-success time together.
403 + no success means access is still refused; a successful deployment or a
Wikipedia-only story does not demonstrate Tavily availability. For a current
probe, dispatch `Operations → global-source-test` (at most two provider calls).
No recurring paid synthetic checks are enabled.

## Limits and maintenance

Server TTS timing is not browser time-to-play or listening completion. Browser
telemetry, distributed tracing, host/disk/container monitoring and log-backend
installation are outside this release. Use existing node-exporter/cAdvisor metrics
for host/disk/restart alerts rather than assuming process memory measures the VM.
A removed scrape target has no `up` series: monitor collector health/target inventory
in your infrastructure; the supplied down alert only detects configured targets
that are being scraped and fail.

Regenerate dashboard: `node scripts/generate-monitoring.mjs`.
Validate assets and real import: `bash scripts/ci-monitoring-smoke.sh` (Docker).
Run application tests: `npm test`.
