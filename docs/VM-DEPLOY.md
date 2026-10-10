# Waystory on ws.nayg.ru

Target: Ubuntu x86_64, Docker/Compose, existing `dogovorovoi-nginx-1` and
`dogovorovoi-certbot-1`. Waystory joins `dogovorovoi_default` as `waystory-app`
and publishes no host ports. Nginx owns ports 80/443. The pilot is still in demo
mode; deploying it does not enable a real AI provider.

Run the VM commands as `artem`. Wait until the Waystory deployment PR and the
dogovorovoi persistent-sites PR are merged. Direct SSH from the coding environment
is unavailable, so these steps must be executed on the VM.

## 1. Prepare persistent directories and the app

```bash
sudo install -d -m 0755 /opt/nginx-sites
sudo install -d -o artem -g "$(id -gn)" -m 0700 /opt/waystory
test -e /opt/waystory/.env || (umask 077; touch /opt/waystory/.env)
git clone https://github.com/pastukhov/Waystory.git /opt/waystory/source
cd /opt/waystory/source
sudo -v
bash scripts/deploy-vm.sh
```

If the clone already exists, use `git -C /opt/waystory/source pull --ff-only`
instead of cloning again. Add any future AI credentials to `/opt/waystory/.env`
using an editor on the VM. This file is not stored in GitHub or copied into the
image. Production fixes the internal port at 5173 and host at 0.0.0.0.

## 2. Issue the certificate

The DNS A record for `ws.nayg.ru` must point to this VM, and any AAAA record must
also route here. The existing HTTP server serves the ACME challenge path.
Use the existing Certbot account email; do not change dogovorovoi's default
certificate or its `CERTBOT_DOMAINS` setting.

```bash
sudo docker exec dogovorovoi-certbot-1 sh -c '
  exec certbot certonly --non-interactive --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --server https://acme-v02.api.letsencrypt.org/directory \
    --webroot --webroot-path /var/www/certbot \
    --cert-name ws.nayg.ru -d ws.nayg.ru
'
```

If Certbot reports another instance is running, retry after its current renewal
finishes. Its existing `certbot renew` loop will renew this certificate too;
Nginx already reloads every six hours.

## 3. Connect the existing Nginx

The dogovorovoi change adds two things: an include inside `http {}` for
`/etc/nginx/sites-enabled/*.conf`, and the read-only bind mount from
`/opt/nginx-sites`. An empty directory is valid, so dogovorovoi can be deployed
before Waystory is installed. Wait for any running dogovorovoi deployment to
finish before these commands.

Only install the following site file after certificate issuance succeeds:

```bash
sudo install -m 0644 /opt/waystory/source/deploy/nginx/waystory.conf \
  /opt/nginx-sites/waystory.conf

cd /opt/actions-runner/_work/dogovorovoi/dogovorovoi
runner_owner="$(stat -c '%U' .git)"
sudo -u "$runner_owner" git -C "$PWD" status --short
```

If tracked files have local changes, preserve and reconcile them before updating.
For a clean checkout, update from the merged main branch and rebuild Nginx:

```bash
sudo -u "$runner_owner" git -C "$PWD" pull --ff-only origin main
sudo docker compose build nginx
sudo docker compose run --rm --no-deps nginx nginx -t
sudo docker compose up -d --no-deps nginx
curl --fail --show-error https://ws.nayg.ru/api/config
```

Run `up` only if `nginx -t` succeeds. Recreating this container briefly interrupts
both sites; the API, Redis and other containers are not recreated. Expected API
response: `{"ai":false,"mode":"demo"}`. Open the site on a phone and verify
geolocation and playback. Check the existing dogovorovoi domain too.

## 4. Register a separate Waystory runner

Create a separate directory and allow the runner account to manage Docker:

```bash
sudo install -d -o artem -g "$(id -gn)" -m 0755 /opt/actions-runner-waystory
sudo usermod -aG docker artem
```

Docker group membership grants administrative control of the VM. Log out and
back in before continuing, then confirm `docker info` works without sudo.

Open <https://github.com/pastukhov/Waystory/settings/actions/runners/new> and
select Linux / x64. In `/opt/actions-runner-waystory`, run the download and
checksum-verification commands supplied by GitHub. Run its `./config.sh` command
with the displayed short-lived registration token and these extra arguments:

```text
--name waystory-webserver --labels waystory --unattended
```

Do not run `config.sh` as root and do not reuse dogovorovoi's runner directory.
Install the configured runner as a service:

```bash
cd /opt/actions-runner-waystory
sudo ./svc.sh install artem
sudo ./svc.sh start
sudo ./svc.sh status
```

On a machine where `gh` is authenticated, confirm the runner is online and enable
deployments:

```bash
gh api repos/pastukhov/Waystory/actions/runners \
  --jq '.runners[] | {name,status,labels:[.labels[].name]}'
gh variable set WAYSTORY_DEPLOY_ENABLED --body true --repo pastukhov/Waystory
```

The next successful **push CI run on main** triggers Deploy. PR CI runs do not.
The deployment checks out the exact tested commit and skips it if main has
already advanced. No deployment runs before the repository variable is enabled.
To deploy an already-tested current main without a new commit, use the commands
in step 1 (update the source checkout first).

## Operations

Application images are tagged by Git commit. Builds finish before the container
is replaced, and deployment fails if the new container is not healthy. There is
no automatic rollback. To roll back, first disable automatic deployments:

```bash
gh variable set WAYSTORY_DEPLOY_ENABLED --body false --repo pastukhov/Waystory
```

On the VM, check out a known-good commit in `/opt/waystory/source` and run
`bash scripts/deploy-vm.sh`. Re-enable deployments after the fix reaches main.

To remove the Waystory route, move `/opt/nginx-sites/waystory.conf` to a filename
without the `.conf` extension, then validate and reload Nginx:

```bash
sudo docker exec dogovorovoi-nginx-1 nginx -t
sudo docker exec dogovorovoi-nginx-1 nginx -s reload
```

Future edits to `deploy/nginx/waystory.conf` must be installed into
`/opt/nginx-sites/waystory.conf`, validated, and reloaded explicitly; the app
runner updates only the Waystory container. Never run `docker compose down` in
the dogovorovoi project as part of a Waystory deployment.
