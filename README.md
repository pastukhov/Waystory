# Waystory

**Every place has a story.**

A mobile-first city audio guide pilot. Explore a place, listen to its story, and change the level of detail while listening.

## Current status

This is a **pilot with an optional Yandex AI Studio backend**. The interface, titles/stories/answers, speech and voice questions follow the first supported browser language (Russian or English; English fallback). Google sign-in is required for AI stories, questions, photos and speech; authenticated AI/TTS request counts are unlimited.

Implemented:

- Search-first home with no preselected city. Open-data POIs from OSM, Wikidata, Wikipedia and Wikivoyage.
- Cloud MP3 playback with pause/resume and speech-rate control; automatic device voice fallback when cloud narration fails.
- Cumulative short, standard, and detailed stories. Higher levels append connected new material; thin sources honestly expose fewer levels. Completed sections are not repeated when depth changes; an interrupted section restarts from its beginning.
- AI follow-up questions with heard context and a return to the main story; prepared answers in demo mode.
- Server-side open-source search and nearby discovery, native/local names and Google Maps links.
- Favorites and listening history stored on the current device.
- Photo selection and recognition through a vision model when AI is configured.

Set `ROUTERAI_API_KEY` through GitHub Actions secrets to enable AI stories,
questions, photo recognition and cloud narration. See [RouterAI setup](docs/ROUTERAI.md). Without credentials AI is unavailable; open-data search remains available.
The browser never receives provider credentials. See [Yandex setup](docs/YANDEX-AI.md)
for model choices, limits, VM migration and live verification. Legacy Yandex settings remain available for an explicit rollback.

Provider coverage, story factual accuracy, actual phone audio and background playback require live testing. Keep the app open during this pilot.

## Run locally

Requires Node.js 22 or newer. No dependency installation is needed.

```sh
npm start
```

Open **http://127.0.0.1:5173**. The server binds to loopback by default. `npm start` automatically loads an optional `.env` from the working directory using Node's built-in loader; existing process environment variables take precedence.

```sh
npm test
npm run check
```

Tests cover story depth, cancellation of stale speech callbacks, local storage recovery, and request-handler behavior. Request-handler tests do not open a socket; they are not a deployment integration test. Tests also cover Yandex request contracts with a stubbed provider, malformed responses, cancellation, size limits and caching. They do not establish live model quality; browser QA was blocked locally. Docker build and runtime checks passed in GitHub Actions.

## Docker Compose

Requires Docker Engine and Docker Compose v2.

```sh
cp .env.example .env
# Edit .env with your settings; never commit real credentials.
docker compose up --build -d
```

Open **http://127.0.0.1:5173** (or the port selected in `.env`).

```sh
docker compose logs -f waystory
docker compose down
```

After changing `.env`, run `docker compose up -d --force-recreate` to pass the new values to the container. An image rebuild is not necessary for secret changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5173` | Local server port; in Compose, both container and published port |
| `HOST` | `127.0.0.1` locally | Listen address; Compose sets `0.0.0.0` inside the container |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface for the published Docker port; use `0.0.0.0` for access from other machines |

Compose injects `.env` at container startup via `env_file`. The file is excluded from Git and the Docker build context, and is never copied into the image. Runtime code reads these values from `process.env`; the browser receives no environment variables. Use single quotes for values containing `$` or `#`. Environment variables are visible to users with Docker administrative access; this is environment injection, not Docker secrets storage.

The image runs as the non-root `node` user with a healthcheck. Compose uses a read-only filesystem, drops Linux capabilities, and starts Node through an init process. No npm dependencies or build-time secrets are needed.

The Yandex settings in `.env.example` configure the server adapter. Both the API key and folder ID are required to enable live mode. Model names can be changed independently for stories, questions and photos.

Validation: Node tests and Compose configuration were checked. Docker image build, container healthcheck, HTTP responses, and runtime secret injection passed in GitHub Actions. The local environment still denies access to the Docker daemon socket.

## Standalone preview

```sh
node scripts/standalone.mjs
```

Open `artifacts/waystory-pilot.html` in a desktop browser. It embeds code, styles, and sample illustrations. Browser permissions and online features can behave differently on a local file; use HTTPS hosting for mobile testing.

## Project structure

```text
dist/                  Static app source, ready for hosting
  app.mjs              UI and interaction flow
  core.mjs             Story queue and storage helpers
  speech.mjs           Cancellable cloud/device speech playback
  wiki.mjs             Wikipedia search and article retrieval
  data.mjs             Legacy prepared sample stories
  art.mjs, assets/     Original stylized SVG illustrations
server/index.mjs       Static server and bounded AI API
server/guide.mjs       Yandex adapter, prompts, validation and story cache
server/tts.mjs         Cloud synthesis and bounded MP3 cache
server/places/        Source-aware place model, SQLite catalog and discovery
server/sources/       Open providers, policies, collection, optional paid enrichment
tests/                 Dependency-free Node tests
scripts/standalone.mjs Single-file HTML packaging
docs/PILOT.md          Scope and next steps
```

## Hosting and AI integration

`dist/` can be hosted on an HTTPS static host. Asset paths currently assume a domain root; a GitHub Pages project subpath requires adapting them. Creating this repository does not publish a website.

Live AI requires the Node server and server-side Yandex credentials. Stories use
Alice AI LLM, questions Alice AI LLM Flash, and photos Qwen3.6 35B by default.
The text/vision API permits at most two concurrent paid requests (including batched card translations) and 120 requests per hour
across all visitors, configurable in `.env`. Counters and the bounded 24-hour story
cache are in memory and reset on restart. These are request limits, not a monetary
budget or per-user billing. There is no account authentication in this pilot.

## Sources and privacy

Sample stories link to their Wikipedia sources; historical claims still need editorial verification before commercial use. Live Wikipedia text links back to its article, where attribution, revision history, and licensing terms can be found. Wikimedia images require a separate attribution/license audit before commercial launch. Sample illustrations are stylized drawings, not photographs.

Location is requested once when the page opens, subject to browser permission; there is no continuous tracking. Nearby places load automatically. If location is denied or unavailable, manual search remains available and the user can explicitly retry. Manual searches take precedence over late geolocation results. Favorites and history use localStorage. A place enters listening history after a speech section finishes, not merely after opening its card. The user can clear listening history. In cloud mode, spoken text is sent to the configured speech provider and audio is cached in server memory. Device voice is used in demo mode. Nearby discovery sends coordinates to Russian, English and Turkish Wikipedia, expanding from 1.5 to 5 and 10 km when fewer than five places are found; the UI reports radius and approximate GPS accuracy. Article coverage is not a complete map of sights. With AI enabled, source text and questions are sent to the configured AI provider; photos are sent only after pressing the recognition button. Photos are not saved by this server. Production uses RouterAI and its upstream providers; Yandex logging controls do not apply.

## Pull request checks

GitHub Actions runs on pull requests to `main`, pushes to `main`, and manual dispatch. It checks syntax and tests on Node.js 22 and 24, packages the standalone preview, then builds and runs the Docker container with a disposable `.env` fixture. No live credentials are needed. The stable aggregate job is **Required checks**.

See [main branch protection](docs/BRANCH-PROTECTION.md) for the proposed policy and the administrator command needed to apply it. The JSON file itself does not protect the branch.

## Deployment on your VM

For `ws.nayg.ru` behind the existing dogovorovoi Nginx, follow
[the VM deployment guide](docs/VM-DEPLOY.md). It covers the persistent `.env`,
TLS certificate, separate runner, and deployments after successful main CI.

## Browser language and narrative depth

Browser language preferences select Russian or English on page load. Narration
uses the configured cloud voice for the selected language. AI translates the place
heading and story, answers and photo descriptions into that language. Discovery
card names/descriptions from other editions are translated in batches using the
question model; these calls share the AI quota. Source links retain the original
article and language. If translation fails, the original is labeled and
foreign-language narration stays disabled. Offline examples remain original
Russian source material until AI is available.

The story is one ordered sequence: essentials (depth 0), continuing explanation
(depth 1), further detail (depth 2). Selecting a higher depth includes earlier
parts. Completed audio parts are not repeated when increasing depth mid-story.
The prompt targets 40–65 / 140–225 / 320–485 cumulative words when the source
supports that detail. Server validation requires each extra level to add at
least half of the preceding total word count, rejects duplicate sections and
wrong order, and allows short-only sources. Length validation cannot guarantee
semantic coherence; live stories still need editorial listening.

Language and story-format version are included in cache identity; saved AI
stories from older versions or other languages regenerate on opening. Estimated
time uses seconds and minutes. Unavailable detail levels are disabled with a
source-coverage explanation. GitHub CI tests both language flows in Chromium,
using deterministic fixtures rather than paid provider requests.

### Google sign-in

Paid AI and speech now require an invited Google account. Follow [Google OAuth setup](docs/google-login.md) to configure the Client ID, secret and allowed emails in the server `.env`. Accounts, sessions and daily request quotas use a persistent Docker volume. With missing OAuth settings paid calls fail closed; public Wikipedia search remains available. Favorites and listening history are still device-local.

Signed-in invited users have unlimited request counts by default (`AUTHENTICATED_REQUESTS_UNLIMITED=true`). Usage remains visible as daily statistics. Set this option to `false` to enforce the configured daily/hourly request quotas; authentication and concurrency limits are always enforced.

### Remote operations

[Operations workflow and runbook](docs/operations.md) provide diagnostics, small paid provider probes, restart and previous-image rollback through the existing GitHub Runner. An assistant can request these via `ops/request.json` in a PR; no manual SSH command is needed. Ordinary successful deployments run free diagnostics only.

Каталог дополнительных источников хранится отдельно от аккаунтов (`SOURCE_DB_PATH`).
Открытые источники включены по умолчанию; `MULTISOURCE_ENABLED=false` возвращает прежний поиск.
Места объединяются только по общим идентификаторам. Старые Wikipedia IDs сохраняются
как aliases; противоречащие координаты сохраняются для проверки.
Wikidata: CC0; OSM: ODbL, только метаданные. Тексты Wikimedia и производные рассказы
и аудио требуют атрибуции и CC BY-SA 4.0. Права на изображения проверяются отдельно.
Неизвестная лицензия запрещает передачу текста модели и кэширование текста.

Открытые POI и материалы: OSM, Wikidata, Wikipedia, Wikivoyage. Источники, местные
названия, лицензии и даты отображаются в карточке. Не для всех объектов есть рассказ.
См. [документацию источников](docs/sources.md). Платный поиск выключен до ключей и прав.
