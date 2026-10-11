# Google sign-in for the pilot

Goal: let invited users sign in with Google and prevent anonymous visitors from spending AI credits. Public Wikipedia search remains available. This step delivers login, account summary, logout and persistent per-user/global daily request quotas; cloud library synchronization and billing are separate steps.

Use server-side OAuth authorization-code exchange with PKCE and browser-bound, single-use state. Read identity from Google's fixed HTTPS userinfo endpoint using the freshly exchanged access token; never accept client-supplied identity or decode an unverified ID token. Request only openid/email/profile, no offline access. Discard Google tokens after identity lookup. Identify users by Google's stable sub, require verified email and a server-configured exact email allowlist. Empty allowlist denies access.

Session identifiers contain 256 random bits; store only hashes in SQLite. HTTPS cookies are HttpOnly, Secure, SameSite=Lax, Path=/ with __Host prefix. Sessions expire after seven days, logout revokes server-side. Check allowlist on every session use. Canonical APP_ORIGIN determines redirects and mutation origin checks, never arbitrary Host/forwarded headers. No OAuth configuration means paid routes fail closed.

SQLite lives on a persistent Docker volume outside served files. Atomic daily counters cover both per-user and global API requests (including cache hits/failed requests), in addition to existing provider hourly/concurrency limits. Counters use UTC dates and survive logout/restart. Defaults: 30 AI and 100 speech requests per user/day; 300 AI and 1000 speech requests total/day. These are request quotas, not a currency budget. No per-IP/DDoS protection claimed.

Frontend shows a Google sign-in link for guests, account dialog and quotas for signed-in users. AI, photo recognition, metadata translation and cloud speech require server session. Library remains device-local, explicitly labeled. Do not silently promise cloud sync. OAuth errors return a generic localized message without exposing tokens.

Validation: deterministic fake Google endpoint responses exercise state binding/replay, PKCE, identity, allowlist, session expiry/revocation and restart persistence. Paid endpoints must reject anonymous calls before reading body or calling providers; CSRF and quota exhaustion are tested. Browser tests cover guest search, login affordance/account/logout and authenticated narration. Docker tests verify writable persistent data volume with read-only root.
