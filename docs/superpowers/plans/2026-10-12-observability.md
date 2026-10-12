# Waystory Observability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. The user explicitly requested planning and immediate implementation in this session.

**Goal:** Diagnose failures and costs through VictoriaMetrics-compatible metrics and a portable Grafana dashboard.
**Architecture:** A bounded in-process Prometheus registry, AsyncLocalStorage request context, provider fetch instrumentation, explicit domain events and authenticated scrape endpoint. Infrastructure is connected later by the owner.
**Tech Stack:** Node 22+, native HTTP/crypto/async_hooks, Prometheus exposition, Grafana JSON, vmalert YAML.
**Spec:** `docs/superpowers/specs/2026-10-12-observability.md`

## Global constraints
- Existing application uses no runtime npm dependencies; retain that property.
- No private strings or unbounded labels. Observation failures never break business requests.
- /metrics requires its own token, disabled without it; no automatic paid probes.
- User-owned VictoriaMetrics/Grafana remain untouched; CI, auto-merge and deployment remain required.

## Review focus
- Concurrent requests must not share correlation IDs (task 1 integration test).
- Arbitrary URLs, methods and provider bodies must not increase label cardinality or leak (tasks 1/2 tests).
- Failed/aborted work and cache hits must not be counted as successful provider calls (task 2 tests).
- Restart/midnight and an empty metrics registry must not imply provider health or incorrect budget (tasks 1/3 tests).
- Dashboard filters and alerts must operate per instance and exclude ordinary no-material results from infrastructure failures (task 3 rule checks).

## Task 1: Registry, context and protected endpoint
Files: server/observability.mjs, server/request-context.mjs, server/index.mjs, tests/observability.test.mjs.
Interface: createObservability({env,write,now,budgetSnapshot}) -> {request(req,res,handler),wrapFetch(fn),render(),authorize(header),record(event,fields)}; observe(event,fields) forwards through request-local context.
- [x] Write failing tests for disabled/unauthorized/authorized scrape, histogram accumulation, HTTP status/latency, concurrent IDs, label allowlists and secret exclusion.
- [x] Implement typed counters/gauges/histograms with fixed schemas and provider/route classifiers; hook request lifecycle once, including abort.
- [x] Verify `node --test tests/observability.test.mjs` and full `npm test`; commit.

## Task 2: Domain telemetry and safe logs
Files: server/guide.mjs, server/tts.mjs, server/diagnostics.mjs, server/sources/{acquire,facts,collect}.mjs, server/places/service.mjs, tests/observability.test.mjs, tests/diagnostics.test.mjs.
Interface: observe emits only known event names and fields; fetch wrapper records each attempted HTTP call exactly once. Stage wrapper reports completed work separately from HTTP transport success.
- [x] Write failing regressions for Tavily403, rejected grounding, cache hit/no extra upstream call, correlated request/source events and missing token usage.
- [x] Instrument HTTP providers, discovery, acquisition/matching/cache, guide/review/TTS and available token usage; preserve provider httpStatus through safeLogLine.
- [x] Verify targeted tests then full suite and syntax checks; commit.

## Task 3: Dashboard, alerts, deployment and documentation
Files: monitoring/{grafana-dashboard.json,alerts.yml,vmagent.yml}, docs/observability.md, scripts/sync-deploy-settings.py, .github/workflows/{deploy,ci}.yml, compose.production.yaml, tests/{monitoring-assets,deploy-settings}.test.mjs.
- [x] Test dashboard structure/datasource references and all metric names against the registry; test optional metrics secret delivery and disabled default.
- [x] Build overview/provider/source/AI/TTS/cache/budget/resource rows; include no-success and last-status panels. Add alert rules with request volume guards and budget denominator guards.
- [x] Document setup, curl examples using token files, scrape network access, retention, resets, budget semantics and known limits.
- [x] Validate exposition with promtool and PromQL/rules with available validators, plus Grafana import against disposable local Grafana if Docker is available. Record unavailable checks honestly.
- [ ] Full CI, review, fix findings, auto-merge and verify deployment; endpoint remains disabled until owner supplies token.

## Validation ledger

- Local application suite: 229 passing tests.
- promtool 3.2.1: exposition, six alert rules and all 29 dashboard queries pass.
- vmalert 1.115.0: rule dry run passes.
- Grafana 11.6.0: real HTTP import and saved-dashboard round trip pass.
- Syntax, image history and settings import checks pass.
- Branch review, GitHub CI and deployment tracked in the pull request.
- Whole-branch review: two findings fixed and verified (initial access failures and technical review outcome).
- Promtool behavioral tests: initial 403s alert; idle counters, stable start time and zero budget do not alert.
