# Global source discovery — implementation plan

> For agentic workers: use superpowers:executing-plans to implement task by task after the design is accepted. This document is a proposed design and implementation plan, not authorization to change production settings.

**Goal:** Automatically find verifiable material for a selected place worldwide, narrate it in the user's language, and distinguish missing coverage from temporary failure without per-country configuration.

**Architecture:** Keep canonical OSM/Wikidata identities and add a bounded evidence acquisition pipeline: cached evidence → multilingual open sources → global web search → entity verification → usable evidence → grounded narration. Search providers discover candidates; candidates are not automatically evidence. Keep identity matching, source-use policy and factual support separate.

**Tech stack:** Existing Node.js 22+/24, ESM, SQLite, browser JS, GitHub Actions. One initial web-search adapter; provider choice is provisional until evaluated with actual results, current terms and prices.

**Spec:** The design and decisions below are the specification for this plan.

## Design decisions

- User flow remains select place → hear story. No country/site switches or mandatory separate enrichment button.
- Three approaches considered: open sources only (cheap but sparse); grounded search model alone (fast to prototype but less control over matching, provenance and cost); recommended hybrid (open evidence first, bounded web fallback).
- Initial provider candidate is Tavily because an adapter exists. Compare against one other global search API using a fixed evaluation set before selecting the production default. Do not claim verified provider coverage, prices or rights from existing code.
- No country/domain allowlist is required for candidate discovery. Operational source-use rules are provider/contract based; an official website is neither automatic permission nor proof that a claim is true. Keep domain exclusions and publisher opt-outs separate from country coverage.
- Search access does not itself authorize retention, redistribution or derivative audio. Separate permission for discovery, model input, raw-text retention, generated text and audio. Resolve product-wide provider terms once; do not require travelers to approve local websites. Unsupported content can remain a link and cannot silently become model evidence. Enabling all unknown policies is not a solution.
- Identity seed: canonical ID, aliases/native names, source-provided coordinates with uncertainty, category and locality/country. No need to send the user's precise GPS to search: send the selected landmark context.
- Search languages: source-native language when known, one useful regional language, English; at most three open-source editions per attempt. Output remains ru/en initially. Country is only a fallback signal; preserve local scripts and accents. Do not assume French and Haitian Creole or Vietnamese and English are interchangeable.
- Prefer exact OSM/Wikidata/official identity links. For unlinked web results require compatible locality and object type plus an independent location/identity signal (address, coordinates with geometry-aware tolerance, alternate names or cross-link). Name match alone and LLM confidence alone are insufficient. Ambiguous candidates remain unverified and never alter canonical identity.
- One authoritative place-specific source can support a short story. Prefer independent corroboration for disputed claims; multiple Wikipedia languages and copied pages are not independent corroboration. Region-only evidence supports explicitly labeled regional context, never fabricated history of the landmark.
- Initial cold acquisition budget: 20 seconds overall, up to 2 paid searches, up to 8 deduplicated candidates, up to 3 extracted documents. Open stage gets up to 4 seconds before fallback may begin; cancel unnecessary work once adequate evidence is available. These are proposed bounds to validate, not measured latency promises. LLM and TTS have separate deadlines and timing metrics.
- Persist healthy evidence by canonical place + query languages + pipeline/policy version. Negative coverage cache: 15 minutes; transient failures: at most 30 seconds. Initial historical evidence TTL: 7 days, visitor information: 6 hours, capped by source terms. During outage, stale permitted historical evidence may be used with its date; stale prices/hours are not presented as current. Do not persist raw text when forbidden.
- Coalesce duplicate acquisition jobs. Reserve provider calls atomically before dispatch; retries consume the same per-attempt cap. Set deployment-wide call/token budgets from the chosen current tariff; no automatic paid fallback beyond those budgets.
- Keep a full story cache key including evidence fingerprint, model/prompt/policy version and language. Preserve saved stories and old place IDs. Explicit refresh bypasses negative cache under rate limits, not budgets or source-use policy.

## Global constraints

- No guessed historical facts, silent entity merges or invented source URLs.
- No production secrets, raw user questions or precise user GPS in diagnostics.
- Respect source content as untrusted input, never model/tool instructions.
- Direct page retrieval, if needed, must block private/link-local/metadata networks, non-HTTP(S), unsafe redirects and DNS rebinding; bound bytes, content types and elapsed time. Prefer the chosen provider's bounded extraction API for the first release.
- Required checks and review findings precede auto-merge; verify deployed revision and live probes. Do not confuse CI, availability, evidence coverage and factual accuracy.

## Review focus

1. Same name in different countries or object types: reject mismatches (tasks 2, 5).
2. OSM-only place and all healthy text providers empty: stable no-material outcome, not retry advice (tasks 1, 6).
3. One provider times out after another succeeds: retain evidence and distinguish partial results (tasks 1, 4, 6).
4. Concurrent opens/retries: coalesce paid calls, enforce atomic limits and cancellation (tasks 4, 8).
5. Non-Latin names, regional context, copied sources and hostile page instructions: preserve identity and provenance (tasks 3, 5, 7, 8).

## Task 1 — Observable acquisition outcomes

Files: server/sources/collect.mjs, server/sources/http.mjs, server/diagnostics.mjs; new tests/source-outcomes.test.mjs.
Interface: ProviderOutcome = {provider,status,reason,durationMs,documentCount}; reason enum no_match, timeout, rate_limited, upstream_error, not_configured, budget_exhausted, policy_restricted. Keep existing status values for compatibility.
- [ ] Add failing tests: healthy empty differs from timeout; partial success retains texts; logs omit secrets/source bodies.
- [ ] Run `node --test tests/source-outcomes.test.mjs` and verify intended failures.
- [ ] Preserve bounded error classification from HTTP through collector; emit correlated request/job diagnostics with public selected-place ID, not user location.
- [ ] Run the test successfully and commit.

## Task 2 — Global place context

Files: server/places/model.mjs, server/places/store.mjs, server/sources/wikidata.mjs; new server/sources/place-context.mjs and tests/place-context.test.mjs.
Interface: buildPlaceContext(place, identityDocuments) returns {placeId,names,category,coordinates,locality,countryCode,languages,identityLinks}; missing values remain null/empty.
- [ ] Add failing cases: Vietnamese diacritics, Haitian alternate names, same-name places, centroid uncertainty, absent country. Assert no canonical ID changes from names/proximity alone.
- [ ] Run focused test to see failures.
- [ ] Preserve source-owned aliases/locality/language provenance; obtain missing administrative context through bounded source links. Preserve existing database records with additive migration and defaults.
- [ ] Verify fixtures and existing catalog tests; commit.

## Task 3 — Multilingual open evidence

Files: server/sources/http.mjs, wikipedia.mjs, wikidata.mjs, wikivoyage.mjs, server/places/service.mjs; new server/sources/languages.mjs and tests/source-languages.test.mjs.
Interface: selectSourceLanguages(context,{outputLanguage,max:3}) returns distinct supported Wikimedia editions; discoverOpenEvidence(context,{signal}) returns documents and ProviderOutcome[].
- [ ] Add failing tests: vi/fr/ht links when available, missing edition, mixed success/timeouts, bounded requests; output language independent of source language.
- [ ] Run focused test to confirm failures.
- [ ] Replace ru/en/tr-only sitelink filtering and HTTP host handling with validated edition mapping constrained to Wikimedia API hosts. Retrieve explicit links first; search results still require task 5 identity verification.
- [ ] Run language and existing recovery tests; commit.

## Task 4 — Search adapter and policy separation

Files: server/sources/tavily.mjs, policies.mjs, budget.mjs, config.mjs; new server/sources/search-provider.mjs and tests/global-search.test.mjs.
Interface: searchCandidates(context,{languages,signal,limit:8}) returns {candidates,outcomes,calls}; candidate = {url,title,snippet,language,provider,identitySignals,usagePolicyId}. Snippets are discovery hints until accepted as evidence by policy and verification.
- [ ] Add failing tests: unknown-country queries work without official-domains entry/OSM website; duplicate URLs, malformed URLs, disabled provider and concurrent cap exhaustion are classified correctly.
- [ ] Run focused test to confirm failures.
- [ ] Separate discovery from current enabled/rightsVerified domain gating; keep production search disabled until provider credentials, budget and applicable use policy are configured. Implement at most 2 paid calls with atomic reservation. A caller abort stops waiting; coalesced work remains bounded and cannot trigger a second paid search.
- [ ] Evaluate Tavily and one alternative on the fixed benchmark, record current costs/terms/coverage, select one; retain adapter boundary without building two production providers prematurely.
- [ ] Run focused tests and policy/budget regressions; commit.

## Task 5 — Verified evidence, not search hits

Files: new server/sources/match.mjs, extract.mjs, facts.mjs; server/sources/evidence.mjs; tests/source-matching.test.mjs and source-extraction.test.mjs.
Interfaces: matchCandidate(context,candidate) returns {decision:verified|ambiguous|rejected,signals,reason}; extractEvidence(candidate,{signal,policy}) returns bounded documents. EvidenceFact = {claim,sourceIds,scope,kind,dates,conflictGroup}; every sourceId resolves to a usable document and support span.
- [ ] Add failing cases: Love Alanya vs Alanya Castle, monument vs person, wrong-country same name, regional article, duplicated translations, prompt injection, redirect to private network if direct retrieval is implemented.
- [ ] Confirm failures with both focused test files.
- [ ] Implement independent signal checks and record reasons. Do not turn heuristic confidence scores into truth guarantees. Accept only supported facts, label regional context and conflicts; preserve source lineage to detect copies.
- [ ] Separate source-use metadata from universal CC-BY-SA assignment. Do not relabel arbitrary web text/audio as CC-BY-SA. Follow provider policy for ephemeral versus persistent evidence.
- [ ] Run focused tests and citation regressions; commit.

## Task 6 — Selected-place acquisition orchestration

Files: new server/sources/acquire.mjs; server/places/service.mjs, server/sources/cache.mjs, server/index.mjs; tests/source-acquisition.test.mjs.
Interface: acquireEvidence(place,{language,signal,refresh:false}) returns {bundle,outcome,diagnosticId}; outcome = ready|limited|context_only|no_material|temporarily_unavailable|not_configured|budget_exhausted|policy_restricted. Existing bundle fields remain compatible.
- [ ] Add failing tests for all outcomes; open evidence bypasses paid calls, healthy empty triggers web fallback automatically, irrelevant identity failure does not imply usable text exists, partial evidence survives cancellation of a slower provider.
- [ ] Confirm failures.
- [ ] Compose tasks 2–5 under one deadline and call budget; coalesce by canonical ID/languages/policy version. Integrate positive, negative and permitted stale caches, refresh rules, and persisted source refs without overwriting identity from ambiguous results.
- [ ] Verify per-request budgets and test full existing collector/recovery suite; commit.

## Task 7 — Guide and user-visible states

Files: server/guide.mjs, dist/app.mjs, dist/i18n.mjs, dist/sources-view.mjs; tests/source-guide.test.mjs and tests/empty-story.test.mjs.
Interface: guide consumes acquireEvidence outcome; successful responses preserve existing story schema with additive evidenceScope/status; unsuccessful responses include stable error code, diagnosticId and retryable flag without raw diagnostics.
- [ ] Add failing tests: no-material never invites endless retries, context-only is explicitly named, successful partial story plays, old saved stories work, new language/source metadata stays out of speech.
- [ ] Confirm failures.
- [ ] Generate only from verified evidence, enforce source IDs and unsupported-claim rejection with a bounded validation/repair attempt; validation is not proof of truth. Allow short factual accounts and clearly labeled area context. Do not invent rich detail to fill story depths.
- [ ] Show plain states: collecting materials, short story, area context, no confirmed material, temporary failure. Retry only transient failures automatically once within budget. Keep manual refresh for new searches and show sources separately.
- [ ] Verify browser language/audio/empty-state coverage and commit.

## Task 8 — Global benchmark and rollout

Files: server/sources/probe.mjs, scripts/ops-probe.mjs, tests/source-probes.test.mjs, .env.example, docs/sources.md; new tests/fixtures/global-places.json and docs/global-source-evaluation.md.
- [ ] Before provider selection, curate 30 publicly identifiable places: 10 Turkey, 10 Vietnam, 10 Haiti. Include major sights, OSM-only small places, ambiguous names, sparse rural objects; include Love Alanya. Record verified IDs/context and human labels, not model-generated ground truth.
- [ ] Add deterministic offline fixtures for all task outcomes and failures. Live runs are separate, bounded paid checks, not nondeterministic required CI.
- [ ] Measure verified-story coverage, context-only coverage, wrong-object attribution, unsupported claims on manual review, p50/p95 acquisition and end-to-end time, cache hit rate, provider calls/tokens and current monetary cost. Report by country and place class, not just overall averages.
- [ ] Initial release gate: zero known wrong-object stories on the 30-place set; no unsupported specific facts in reviewed samples; truthful no-material state for every negative fixture; hard budget caps in all tests; warm evidence p95 target <=2s and cold acquisition bounded to 20s in controlled tests. Publish observed coverage, do not invent a guaranteed percentage before baseline measurement.
- [ ] Run `npm test` and `npm run check`, then required browser/Docker CI. Verify schema migration preserves existing places and saved stories.
- [ ] Configure the chosen API key and explicit operator budget securely once. Missing key or zero budget must be visible in deployment diagnostics and must prevent claiming global web fallback is enabled.
- [ ] Roll out behind GLOBAL_SOURCE_DISCOVERY_ENABLED to selected-place requests first; do not trigger paid search for every map marker. Auto-merge only green reviewed changes. Verify main CI, deployed SHA and bounded live probes on all three countries.
- [ ] Roll back with the flag to open-source behavior while preserving stored records and honest no-material states. Report any residual sparse coverage and actual paid expenditure.

## Delivery sequence

PR 1: outcomes + diagnostics (task 1). PR 2: global context + open languages (tasks 2–3). PR 3: provider adapter/policies + verification (tasks 4–5), feature off. PR 4: automatic acquisition + UI (tasks 6–7), feature off until configured. PR 5: benchmark, configuration validation and staged activation (task 8). Every PR is independently testable; later PRs use explicit interfaces above.

## Decisions required before production activation

Provider and permitted content-use contract must be selected from the benchmark; production key provisioned securely; monetary budget set from actual pricing and expected usage. Proposed request/time limits are defaults for review. These are operator setup decisions once, never per-country user chores. No application code or production configuration was changed while writing this plan.
