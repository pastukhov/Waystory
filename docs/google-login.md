# Google login on ws.nayg.ru

All paid endpoints now require a server session. Without OAuth settings they are closed; public Wikipedia search still works. A Google account alone is not an invitation: its verified email must appear in `GOOGLE_ALLOWED_EMAILS`.

## Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select/create the Waystory project.
2. In Google Auth Platform configure Branding (Waystory, support/contact email) and Audience. For the pilot use External / Testing and add the invited Google accounts as test users.
3. Create a client of type **Web application**. Add this exact Authorized redirect URI:
   `https://ws.nayg.ru/auth/google/callback`
4. Only basic scopes are used: `openid`, `email`, `profile`. There is no Drive/Gmail access and no offline/refresh token request. This server redirect flow does not require an Authorized JavaScript origin.
5. Save the Client ID and Client secret. Put the secret only in the VM dotenv file; do not paste it into chat, repository files or GitHub logs.

Google's [web server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) explains client configuration. Testing users and Waystory's email allowlist are separate checks; configure both.

## Configure the existing VM

```bash
sudoedit /opt/waystory/.env
```

Add/update (replace the example values):

```dotenv
APP_ORIGIN=https://ws.nayg.ru
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_ALLOWED_EMAILS=your-address@gmail.com,another-invited-address@gmail.com
AUTH_DB_PATH=/app/data/waystory.sqlite
AI_USER_REQUESTS_PER_DAY=30
TTS_USER_REQUESTS_PER_DAY=100
AI_REQUESTS_PER_DAY=300
TTS_REQUESTS_PER_DAY=1000
```

Keep the existing Yandex settings. Never use `docker compose down -v` on production: that deletes accounts, sessions and usage counters. The data volume persists across normal deploys and recreations. Back up the SQLite database using its backup API or while the application is stopped, not by copying just the live main file and ignoring WAL.

After deploying this version, recreate the existing container with its current image and Compose file:

```bash
deploy_dir="$(sudo docker inspect waystory-waystory-1 --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
current_image="$(sudo docker inspect waystory-waystory-1 --format '{{.Config.Image}}')"
sudo env WAYSTORY_IMAGE="$current_image" docker compose \
  --project-directory "$deploy_dir" -p waystory \
  -f "$deploy_dir/compose.production.yaml" \
  up -d --no-build --force-recreate waystory
```

Open the site, choose Sign in → Continue with Google. Invited account should see its email and quotas. Guest requests to `/api/guide` and `/api/speech` return 401 when configured (503 before setup); logout invalidates the session. Google tokens stay server-side and are discarded after identity lookup.

## Limits and boundaries

Seven-day absolute sessions and daily counters are stored in SQLite. Quotas reset at midnight UTC, survive restart/logout and count requests even if a provider fails or a response is cached. Global counters apply across all invited users. Existing provider hourly/concurrency limits still apply. These are request ceilings, not a precise financial budget or DDoS protection. Removing an email from the allowlist and recreating the container blocks its existing sessions as well as new logins.

Favorites/history remain in this browser; this release does not synchronize them. Account deletion/self-service export and cloud library storage are not implemented yet. Administrators must handle deletion requests; do not open public enrollment on the strength of this pilot implementation.

No live Google login has been tested until real OAuth credentials are configured. CI uses deterministic Google responses, never real users or paid providers.
