# Tavily production rollout

The owner supplied a Free account with a current balance of 1,500 credits and
installed its key in `/opt/waystory/.env`. Deployment now reads the repository
Actions secret `TAVILY_API_KEY`. Add it once under Settings → Secrets and
variables → Actions; subsequent deployments update the VM credential. An empty
GitHub secret preserves the existing VM key during migration. No credential is
stored in git, build context, command arguments, or diagnostic output.

`sync-deploy-settings.py` runs only with `WAYSTORY_SYNC_SEARCH_SETTINGS=true`
(the production workflow opts in), after the stale-main check. It atomically
replaces the environment file with mode 0600, preserves unrelated assignments,
and installs the versioned search settings. The runner must own the environment
directory and be able to replace its file. Other credentials retain their
existing delivery mechanism; they are not silently migrated.

## Budget

Production uses a shared SQLite limit of 10 Tavily calls per UTC day. The global
adapter uses basic Search (1 credit), then basic Extract for at most 3 URLs
(at most 1 credit). Reservations include failed calls, so this conservatively
bounds this application's usage by 310 credits in a 31-day month. This is not a
measurement of the account's actual credit balance, and does not include other
clients using the key. No paid plan or automatic top-up is enabled by this code.

Pricing reference, checked 2026-10-11:
https://docs.tavily.com/documentation/api-credits

## Source use

Operational review dated 2026-10-11:
https://www.tavily.com/terms (updated 2026-05-04), sections 2, 3, 6, 9 and 10.
Tavily permits API integration in customer applications. It does not grant a
blanket copyright licence to third-party pages. The configured flags describe
Waystory's use of factual material for original summaries and generated speech;
they do not assert that a subscription transfers publishers' rights. Source
links and attribution are retained, raw web text is not persisted in the
acquisition cache (`allowTextCache=false`, TTL 0), and the guide prompt requires
original wording rather than reproduction of source descriptions. Existing
identity matching and grounding checks remain active. Model checks cannot
guarantee truth or perfect paraphrasing.

## Verification and rollback

The one-time `global-source-test` operation uses the real cached Love Alanya
place and at most one search plus one extract call. It reports API outcomes,
candidate counts and identity-match counts separately. API success with zero
verified matches is not successful story coverage. It does not invoke the AI or
speech services and never prints returned page text or the key.

To disable search temporarily, set `GLOBAL_SOURCE_DISCOVERY_ENABLED=false` in
the VM environment and recreate the container; the next production deployment
reapplies the versioned settings, so change the deployment script for a lasting
rollback. The existing free-source fallback remains available.
