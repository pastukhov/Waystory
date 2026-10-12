# Waystory observability

Approved scope: the owner operates VictoriaMetrics and Grafana and will connect
scraping/import dashboards later. Deliver the application side and importable
configuration; do not install or access the owner's monitoring infrastructure.

Expose Prometheus text metrics on GET /metrics only with a dedicated bearer
METRICS_TOKEN (at least 32 URL-safe characters). No token means 404; wrong or
missing authorization means 401. Cookies and query parameters never authorize.
No public port or monitoring credentials are added automatically. Production
Actions may deliver an optional METRICS_TOKEN without erasing an existing token.

Measure normalized HTTP routes, provider HTTP results and header latency,
completed discovery/source/generation/review/TTS stages, cache hits/misses,
matching decisions, available AI token usage and requested TTS characters.
Export process resources and configured-provider flags. Read the persisted
Tavily UTC daily call budget at scrape time; it is NOT the provider's credit
balance. Expose last provider success and last HTTP status; zero success time
means no observed success since process start, never healthy-by-default.

Generate a server-owned UUID per request and use AsyncLocalStorage to correlate
provider/stage/access events. Return X-Request-ID. Shared/cache work has its own
original diagnostic ID linked to each waiting request. Allowlist structured
fields; never log URLs, query text, coordinates, email, cookies, credentials,
provider bodies or generated text. No request/place/user IDs in metric labels.

Deliver Grafana JSON (Prometheus datasource variable, job/instance filters),
vmalert YAML, vmagent scrape example with authorization.credentials_file, and
setup/runbook documentation. Recording/alert queries must survive counter
resets, absent traffic and per-instance restarts. No automatic paid probes.

No browser telemetry ingestion, distributed tracing backend, logging backend,
node exporter or host monitoring installation in this release. Server TTS
latency is not browser time-to-play; document this boundary explicitly.
