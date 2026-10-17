# Global web discovery

Selected-place discovery uses a configured ordered list of independent search adapters.
The default is Tavily, followed by Brave Search API. Set
`WEB_SEARCH_PROVIDER_ORDER=brave,tavily` to prefer Brave, or set it to one engine
name to select that engine alone. Only `tavily` and `brave` are accepted.
`GLOBAL_SOURCE_DISCOVERY_ENABLED=true` enables the acquisition integration.

## Credentials and deployment

Install `TAVILY_API_KEY` and/or `BRAVE_SEARCH_API_KEY` in the VM environment.
For automatic delivery, create the matching repository Actions secret. The deploy
workflow passes the Brave secret as `WAYSTORY_BRAVE_SECRET` to the allowlisted
settings installer. Missing Actions secrets preserve existing VM values. The
installer validates all supplied secrets before changing the environment file,
atomically replaces it with mode 0600, and never prints credentials. Credentials
are sent only to each engine's fixed HTTPS API endpoint in authentication headers;
HTTP redirects are rejected.

The deployment installer currently enables global discovery and sets the shared
budget to 10 calls/day. A missing Brave key leaves Tavily operational and reports
Brave as `not_configured` if fallback is needed. Installing a key is required before
Brave can recover a failed Tavily search; deploying support alone cannot do so.

## Fallback, deadlines, and budgets

Tavily HTTP 401/403, 429, 5xx, transport errors and timeouts allow the next configured
engine to run. HTTP 400 and a successful empty result do not trigger another paid
search. Authentication/permission errors open a 15-minute process-local cooldown;
other transient errors open a 60-second cooldown. Calls during cooldown skip that
engine without spending budget, and the next request after expiry tests it again.
Cooldowns reset on process restart. Successful searches clear their engine's cooldown.

`WEB_SEARCH_TIMEOUT_MS` (default 15000, maximum 60000) bounds the entire search and
extraction operation. `WEB_SEARCH_PROVIDER_TIMEOUT_MS` (default 6000, maximum
30000) bounds each upstream call, leaving time for fallback within the combined
deadline. Caller cancellation stops fallback immediately. A successful Tavily search
may perform one extraction request for up to three URLs; Brave has no extraction
step. Failed extraction preserves search candidates and emits a partial outcome.

`WEB_SEARCH_MAX_CALLS_PER_DAY` is a shared UTC-day cap, persisted in SQLite. Every
attempt counts, including failures and Tavily extraction. Existing official-web
Tavily enrichment consumes the same cap. Atomic reservation checks aggregate usage
and provider usage together; switching engines cannot increase the total allowance.
`TAVILY_MAX_CALLS_PER_DAY` and `BRAVE_SEARCH_MAX_CALLS_PER_DAY` optionally cap each
engine below the shared total; their default is the shared cap. Zero disables paid
calls for the corresponding scope. Raising the cap does not erase prior usage.

## Content permissions and status

`GLOBAL_WEB_USE_POLICY_JSON` remains the existing Tavily-specific review. Tavily
candidates use `web-search-reviewed`; this policy is never assigned to Brave.
Brave candidates use `brave-search-unreviewed`: their titles and snippets can assist
identity matching and provide source links, but cannot become story evidence,
model input, generated narration, or cached source text. A Brave subscription does
not establish content reuse permission. No unreviewed policy is registered.

Outcomes retain the finite acquisition provider `global-web` and identify upstream
service through `engine: tavily|brave`. Outcomes include only bounded status/reason,
HTTP status, counts and durations; they never include queries, response bodies,
credentials, or exception text. `access_denied` identifies HTTP 401/403;
`cooldown: true` identifies a skipped known-failing engine. `configuredEngines`
on the search provider exposes only names for health/configuration diagnostics.

## Direct official materials

Official discovery runs for a selected place even when Wikipedia already supplies
its story. It uses OSM/Wikidata identity websites (including Wikidata P856), or an
explicit official-website template on the linked Wikipedia page. Arbitrary external
references are not trusted as official websites. There is no per-country host list.

The server reads at most four public HTTPS pages, at most 512 KiB each, within eight
seconds. DNS answers are checked for private/special-use addresses and pinned to the
connection; redirects are revalidated, limited to two and kept on the same site.
Only static HTML links are inspected. Exhibition details are prioritized over nested
activities; linked external audio platforms are offered without fetching their audio.

The response provides `officialLinks`, `searchLinks`, and `discoveryStatus` separately
from generated story text. The UI fetches these independently, so AI rejection does
not hide a museum's original guide. Link labels do not assert that an exhibition is
current: visitors should check its official dates. This release links to original
museum texts/audio; it does not ingest whole copyrighted guides or automatically
turn them into new AI narration. JavaScript-only sites and PDF content parsing are
not implemented.

If useful official materials exist, paid search is skipped. Otherwise discovery can
use search even when historical Wikipedia evidence exists. Existing story evidence
is retained when search fails. Successful acquisition is cached within source policy
limits (up to six hours); unavailable web discovery is retried after a short cache
interval, still subject to engine cooldowns. The `tavily_daily_calls_*` metric names
remain for dashboard compatibility but report the shared multi-engine budget.

`Operations → official-source-test` performs a no-search-credit production probe of
the Zotov Wikipedia identity → official site → exhibition/audio links. No arbitrary
URLs or shell commands are accepted by that operation. A missing Brave secret is
reported by `diagnose` as `braveKeyConfigured:false`; no secret values are logged.
