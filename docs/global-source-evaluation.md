# Global source evaluation

Implementation status: offline tests only. No paid provider has been benchmarked or enabled. The operator confirmed no search API subscription/key exists. Current prices, use permissions and real coverage are unverified. Tavily is the first implemented adapter; Brave and Exa remain evaluation alternatives, not installed fallbacks.

The release adds global edition references, bounded acquisition, classified outcomes, persistent policy-permitted evidence, automatic provider invocation when configured, exact identity checks and a model-plus-exact-quote grounding gate for web-derived stories. A grounding gate reduces errors; it does not prove truth.

## Candidate benchmark (not yet human-verified fixtures)

These public place names are a worklist, not claimed resolved identities or measured success. Resolve canonical IDs, locality, geometry and source URLs on the running system before scoring. Include negative same-name examples alongside them. Love Alanya must be resolved from the user's selected catalog record, not assigned a guessed OSM ID.

| Country | Candidate objects |
|---|---|
| Turkey | Love Alanya; Kızıl Kule; Alanya Castle; Alanya Archaeological Museum; Damlataş Cave; Alanya Shipyard; Süleymaniye Mosque (Alanya); Dim Cave; Hamaxia; Syedra |
| Vietnam | Tháp Rùa; Ngọc Sơn Temple; Ho Chi Minh Mausoleum; Temple of Literature (Hanoi); One Pillar Pagoda; Imperial City (Huế); Japanese Covered Bridge (Hội An); Mỹ Sơn; Po Nagar; Bến Thành Market |
| Haiti | Citadelle Laferrière; Sans-Souci Palace; MUPANAH; Marché en Fer (Port-au-Prince); Fort Jacques; Bassin Bleu; Saut-Mathurine; Notre-Dame cathedral ruins (Port-au-Prince); Notre-Dame cathedral (Cap-Haïtien); Place d'Armes (Cap-Haïtien) |

For each resolved item record: country/category, canonical ID, expected identity and scope, accepted/rejected source URLs and reasons, evidence count, story availability, unsupported assertions on human review, latency, provider calls/tokens and billed cost at the then-current tariff. Report denominators and country breakdown. No assumed 100% coverage.

## Activation gates

1. Provision one provider key on server; set a daily paid-call budget from a monetary budget and current pricing.
2. Review the chosen provider's actual terms for the intended content use. GLOBAL_WEB_USE_POLICY_JSON records the operator's reviewed decision; it is not a blanket license or a substitute for terms.
3. Exercise benchmark and same-name negatives with GLOBAL_SOURCE_DISCOVERY_ENABLED in a nonpublic test deployment before production activation.
4. No known wrong-object narratives or unsupported specific facts in reviewed samples; no budget overruns; meaningful coverage improvement versus open-only baseline.
5. Verify emitted source outcomes on live failures. Availability checks are not coverage or factual verification.

## Remaining limitations

- Administrative context is recovered through explicit Wikidata parent/country references with a one-second best-effort budget. OSM-only objects lacking these links or address metadata may still have missing locality; it is not guessed.
- One search plus one extraction call (up to three URLs) replaces two plain searches. Exact map-link coordinates from extracted content can establish location for unlinked pages. Pages without explicit identity links or compatible location evidence remain ambiguous; names alone do not verify them. Actual extraction coverage needs the live benchmark.
- No generic direct website fetcher is introduced. Search provider content is bounded, and arbitrary URLs are not fetched by the application.
- Historical stale reuse is limited to the underlying permission TTL and explicit history documents; stale visitor information is excluded.
- Final provider comparison and full 30-place human-labeled benchmark are blocked by missing credentials and external validation, not considered passed.

## Implementation review record

Independent review found wrong-edition browser fallback, weak alias-only matching,
unbounded language selection, repeated paid acquisition, long provider waiting,
and missing regional UI state. Reproductions were added and corrected; local
suite passes 43 test files. Review-driven fixes have dedicated regressions.

Delivery ruling: ship the cohesive, feature-gated implementation in one PR rather
than five interdependent deploys. Acquisition/UI contracts and policy gating are
reviewable together; paid activation remains a separate operator action. If this
choice is wrong, rollback reverts the complete feature rather than one subsystem.

Paid benchmark, provider comparison and actual production activation are not
complete. No API key, verified current provider terms, or monetary budget was
supplied. The 30 named candidates above are not represented as validated fixtures.
No generic page crawler, guessed identity merge, unlimited search or automatic
country-site configuration was introduced.
