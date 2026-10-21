# Caddy release helper

Narrow, privileged helper for the "Release ke Caddy" feature (see
`apps/api/src/releases/`). Runs as root on the VPS host, **outside Docker**,
because only root can edit `/etc/caddy/Caddyfile` and reload the `caddy`
systemd unit - the `api` container (unprivileged) never gets that access
directly. It exposes exactly two operations over a Unix socket: add a
release's site block, or remove one. It is not a general command runner.

## One-time install on the VPS

```bash
mkdir -p /opt/caddy-release-helper /opt/ruang-vraxen/releases-data
cp server.js /opt/caddy-release-helper/server.js
cp caddy-release-helper.service /etc/systemd/system/caddy-release-helper.service

cat > /opt/ruang-vraxen/caddy-release-helper.env <<'EOF'
CADDY_RELEASE_HELPER_SOCKET=/opt/ruang-vraxen/caddy-release-helper.sock
CADDY_RELEASE_HELPER_TOKEN=<same random token as in .env.prod's CADDY_RELEASE_HELPER_TOKEN>
CADDYFILE_PATH=/etc/caddy/Caddyfile
ALLOWED_BASE_DOMAINS=vraxen-group.com
ALLOWED_RELEASES_ROOT=/opt/ruang-vraxen/releases-data
EOF
chmod 600 /opt/ruang-vraxen/caddy-release-helper.env

systemctl daemon-reload
systemctl enable --now caddy-release-helper
systemctl status caddy-release-helper --no-pager
```

The socket is deliberately **not** under `/run` (tmpfs, wiped on reboot): it
must already exist as a regular file the moment `docker compose up` first
creates the `api` container with that path bind-mounted in, or Docker
silently creates a *directory* there instead of a socket. Make sure this
service has started (and therefore created the socket) before the first
`docker compose up` that mounts it.

## What it will and won't do

- `POST /add {subdomain, baseDomain, rootDir}` - appends a
  `<subdomain>.<baseDomain> { root * <rootDir> ... file_server }` block
  (wrapped in `# >>> release:<subdomain> >>>` / `<<<` markers for clean
  removal later), validates the resulting Caddyfile with `caddy validate`
  before ever touching the live one, and only then runs
  `systemctl reload caddy`. Any failure rolls the file back to what it was.
- `POST /remove {subdomain}` - removes that marked block the same way.
- `baseDomain` must be in `ALLOWED_BASE_DOMAINS`; `rootDir` must resolve
  inside `ALLOWED_RELEASES_ROOT`. Nothing else is accepted, and there is no
  endpoint that runs an arbitrary command.
- Every other site already on this box (`mcp`, `coworking`, `medistrax`,
  ...) is left untouched - a bad release block fails `caddy validate` and
  is rolled back before it can take the whole box down.
