# Waystory

**Every place has a story.**

A mobile-first city audio guide pilot. Explore a place, listen to its story, and change the level of detail while listening.

## Current status

This is a **demo pilot, not a production AI service**. The interface and sample stories currently use Russian. English content and localization are not implemented yet.

Implemented:

- Three prepared walking-guide examples from central Saint Petersburg.
- Browser text-to-speech, pause/resume, and independent speech-rate control.
- Short, standard, and detailed stories. Completed sections are not repeated when depth changes; an interrupted section restarts from its beginning.
- Prepared follow-up questions with a return to the main story.
- Wikipedia search and nearby-place discovery through browser geolocation.
- Favorites and listening history stored on the current device.
- Photo selection and local preview.

**Not connected:** AI-generated stories, open-ended AI questions, and photo recognition. No API keys are included or requested in the interface. The local server returns `ai: false`; AI requests return HTTP 503. Photo selection does not upload the image in this version.

The Wikipedia integration, actual phone audio, GPS walking behavior, and background playback still need live device testing. Keep the app open during this pilot.

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

Tests cover story depth, cancellation of stale speech callbacks, local storage recovery, and request-handler behavior. Request-handler tests do not open a socket; they are not a deployment integration test. The 22 tests cover the pilot plus environment loading and address validation; browser QA and container execution were blocked by the execution environment.

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

The optional credential placeholders in `.env.example` are for future backend work. **Setting an API key does not activate AI:** the current demo has no provider adapter.

Validation: Node tests and Compose configuration were checked. Docker image build and container healthcheck could not be executed because the environment denies access to the Docker daemon socket.

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
  speech.mjs           Cancellable browser speech playback
  wiki.mjs             Wikipedia search and article retrieval
  data.mjs             Prepared sample stories
  art.mjs, assets/     Original stylized SVG illustrations
server/index.mjs       Local static server and AI-unavailable responses
tests/                 Dependency-free Node tests
scripts/standalone.mjs Single-file HTML packaging
docs/PILOT.md          Scope and next steps
```

## Hosting and future AI integration

`dist/` can be hosted on an HTTPS static host. Asset paths currently assume a domain root; a GitHub Pages project subpath requires adapting them. Creating this repository does not publish a website.

To enable real AI, implement a server-side provider adapter and configure its secrets on the server. Never put provider keys in browser code. The UI has integration points for `/api/config` and `/api/guide`, but the provider backend is **not implemented**. Public AI hosting also needs authentication, persistent usage limits, and cost controls.

## Sources and privacy

Sample stories link to their Wikipedia sources; historical claims still need editorial verification before commercial use. Live Wikipedia text links back to its article, where attribution, revision history, and licensing terms can be found. Wikimedia images require a separate attribution/license audit before commercial launch. Sample illustrations are stylized drawings, not photographs.

Location is requested only after pressing the nearby button; there is no continuous tracking. Favorites and history use localStorage. A place enters listening history after a speech section finishes, not merely after opening its card. The user can clear listening history. Speech availability and processing depend on the browser and device.
