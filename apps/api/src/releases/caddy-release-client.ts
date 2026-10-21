import { Injectable, Logger } from "@nestjs/common";
import * as http from "node:http";

/**
 * Talks to the narrow, privileged helper running as root on the VPS host
 * (infra/caddy-release-helper/server.js, outside Docker - see its own
 * header comment). The socket file is bind-mounted into this container at
 * the same path the helper listens on; see docker-compose.prod.yml.
 *
 * Only two operations exist on the other end: add a release site block, or
 * remove one. Neither this client nor the helper accepts arbitrary commands.
 */
@Injectable()
export class CaddyReleaseClient {
  private readonly logger = new Logger(CaddyReleaseClient.name);
  private readonly socketPath = process.env.CADDY_RELEASE_HELPER_SOCKET || "/opt/ruang-vraxen/caddy-release-helper.sock";
  private readonly token = process.env.CADDY_RELEASE_HELPER_TOKEN || "";

  private request(path: string, body: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "x-release-token": this.token,
          },
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => (chunks += c));
          res.on("end", () => {
            if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) return resolve();
            let message = chunks;
            try {
              message = JSON.parse(chunks).error ?? chunks;
            } catch {
              /* keep raw body */
            }
            reject(new Error(`Caddy release helper menolak permintaan (${res.statusCode}): ${message}`));
          });
        },
      );
      req.on("error", (err) => {
        this.logger.error(`Tidak bisa menghubungi Caddy release helper di ${this.socketPath}: ${err.message}`);
        reject(
          new Error(
            "Tidak bisa menghubungi layanan Caddy di VPS - fitur release belum tersambung di environment ini.",
          ),
        );
      });
      req.end(data);
    });
  }

  addSite(subdomain: string, baseDomain: string, rootDir: string): Promise<void> {
    return this.request("/add", { subdomain, baseDomain, rootDir });
  }

  removeSite(subdomain: string): Promise<void> {
    return this.request("/remove", { subdomain });
  }
}
