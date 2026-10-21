#!/usr/bin/env node
/**
 * Narrow, privileged helper for the "Release ke Caddy" feature in
 * ruang-vraxen. Runs as root on the VPS host (outside Docker) because only
 * root can edit /etc/caddy/Caddyfile and reload the Caddy systemd service.
 * The api container (unprivileged, inside Docker) talks to this over a
 * Unix socket bind-mounted into it - see docker-compose.prod.yml.
 *
 * Deliberately NOT a general command runner: exactly two operations
 * (add a release site block, remove one), both validated before touching
 * anything on disk, with the Caddyfile re-validated via `caddy validate`
 * before a reload is ever triggered (a bad block must never break every
 * other site already live on this box - mcp, coworking, medistrax, ...).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// NOT under /run (tmpfs, wiped on reboot) - the bind-mounted path must
// already exist as a regular file the moment `docker compose up` first
// creates the api container, or Docker silently creates a directory there
// instead of a socket. Living under /opt/ruang-vraxen keeps it on real disk,
// so once created it survives reboots even before this service restarts.
const SOCKET_PATH = process.env.CADDY_RELEASE_HELPER_SOCKET || "/opt/ruang-vraxen/caddy-release-helper.sock";
const TOKEN = process.env.CADDY_RELEASE_HELPER_TOKEN || "";
const CADDYFILE_PATH = process.env.CADDYFILE_PATH || "/etc/caddy/Caddyfile";
const ALLOWED_BASE_DOMAINS = (process.env.ALLOWED_BASE_DOMAINS || "vraxen-group.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_RELEASES_ROOT = fs.realpathSync(process.env.ALLOWED_RELEASES_ROOT || "/opt/ruang-vraxen/releases-data");

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function markerStart(subdomain) {
  return `# >>> release:${subdomain} >>>`;
}
function markerEnd(subdomain) {
  return `# <<< release:${subdomain} <<<`;
}

function stripExistingBlock(content, subdomain) {
  const start = markerStart(subdomain);
  const end = markerEnd(subdomain);
  const startIdx = content.indexOf(start);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(end, startIdx);
  if (endIdx === -1) return content;
  const endOfBlock = endIdx + end.length;
  // also eat one trailing newline so repeated add/remove doesn't accumulate blank lines
  let tail = content.slice(endOfBlock);
  if (tail.startsWith("\n")) tail = tail.slice(1);
  return content.slice(0, startIdx) + tail;
}

function buildBlock(subdomain, baseDomain, rootDir) {
  return [
    markerStart(subdomain),
    `${subdomain}.${baseDomain} {`,
    `    root * ${rootDir}`,
    `    encode gzip zstd`,
    `    try_files {path} {path}.html /index.html`,
    `    file_server`,
    `}`,
    markerEnd(subdomain),
    "",
  ].join("\n");
}

function readCaddyfile() {
  return fs.readFileSync(CADDYFILE_PATH, "utf-8");
}

function writeCaddyfileAtomic(content) {
  const tmp = CADDYFILE_PATH + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, CADDYFILE_PATH);
}

function validateCaddyfile() {
  // throws if invalid; stdout/stderr captured in the error for the caller
  execFileSync("/usr/bin/caddy", ["validate", "--config", CADDYFILE_PATH], { stdio: "pipe" });
}

function reloadCaddy() {
  execFileSync("/usr/bin/systemctl", ["reload", "caddy"], { stdio: "pipe" });
}

function applyCaddyfileChange(mutate) {
  const original = readCaddyfile();
  const next = mutate(original);
  if (next === original) return; // nothing to do
  writeCaddyfileAtomic(next);
  try {
    validateCaddyfile();
  } catch (err) {
    writeCaddyfileAtomic(original); // roll back before surfacing the error
    const detail = (err.stderr || err.stdout || err.message || "").toString();
    throw new HelperError(400, "Caddyfile tidak valid, dibatalkan: " + detail);
  }
  try {
    reloadCaddy();
  } catch (err) {
    writeCaddyfileAtomic(original);
    const detail = (err.stderr || err.stdout || err.message || "").toString();
    throw new HelperError(500, "Gagal reload Caddy, perubahan dibatalkan: " + detail);
  }
}

class HelperError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertValidSubdomain(subdomain) {
  if (typeof subdomain !== "string" || !SUBDOMAIN_RE.test(subdomain)) {
    throw new HelperError(400, "subdomain tidak valid");
  }
}

function assertAllowedBaseDomain(baseDomain) {
  if (!ALLOWED_BASE_DOMAINS.includes(baseDomain)) {
    throw new HelperError(400, "baseDomain tidak diizinkan");
  }
}

function assertRootDirWithinAllowed(rootDir) {
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new HelperError(400, "rootDir wajib diisi");
  }
  // rootDir may not exist yet on a fresh release with no staged content -
  // resolve its parent chain manually instead of requiring realpath to succeed.
  const resolved = path.resolve(rootDir);
  const rel = path.relative(ALLOWED_RELEASES_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new HelperError(400, "rootDir harus berada di dalam direktori releases yang diizinkan");
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new HelperError(413, "body terlalu besar"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HelperError(400, "body bukan JSON valid"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
    res.end(payload);
  };

  try {
    if (TOKEN && req.headers["x-release-token"] !== TOKEN) {
      return send(401, { ok: false, error: "unauthorized" });
    }

    if (req.method === "POST" && req.url === "/add") {
      const body = await readJsonBody(req);
      const { subdomain, baseDomain, rootDir } = body;
      assertValidSubdomain(subdomain);
      assertAllowedBaseDomain(baseDomain);
      assertRootDirWithinAllowed(rootDir);
      applyCaddyfileChange((content) => {
        const stripped = stripExistingBlock(content, subdomain);
        const sep = stripped.endsWith("\n") || stripped.length === 0 ? "" : "\n";
        return stripped + sep + "\n" + buildBlock(subdomain, baseDomain, rootDir);
      });
      return send(200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/remove") {
      const body = await readJsonBody(req);
      const { subdomain } = body;
      assertValidSubdomain(subdomain);
      applyCaddyfileChange((content) => stripExistingBlock(content, subdomain));
      return send(200, { ok: true });
    }

    return send(404, { ok: false, error: "not found" });
  } catch (err) {
    if (err instanceof HelperError) return send(err.status, { ok: false, error: err.message });
    console.error("[caddy-release-helper] unexpected error", err);
    return send(500, { ok: false, error: "internal error" });
  }
});

if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o666); // reachable by the unprivileged api container via the bind-mounted socket file
  console.log(`[caddy-release-helper] listening on ${SOCKET_PATH}`);
});

process.on("SIGTERM", () => {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
  process.exit(0);
});
