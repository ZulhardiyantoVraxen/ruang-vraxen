/**
 * Thin, framework-free GitHub Contents API client - commits agent-generated
 * source code straight to a dedicated output repo ("Satu repo baru khusus
 * hasil kerja agent", separate from this platform's own repo), the same way
 * OpenRouterClient/ObjectStorageClient are the one place each external
 * service gets talked to.
 *
 * Uses the platform's global `fetch` (Node 20+) rather than a GitHub SDK -
 * this client only ever needs "read a file's sha" and "create/update a
 * file", both single REST calls.
 */
export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;

  constructor(config: { owner: string; repo: string; token: string }) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "ruang-vraxen-worker",
    };
  }

  /** Returns the blob sha of an existing file at `path`, or null if it doesn't exist yet (needed to UPDATE rather than create). */
  private async getExistingSha(path: string): Promise<string | null> {
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET contents gagal (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  }

  /** Creates or updates a single file at `path` with `content`, in one commit. */
  async putFile(path: string, content: string, commitMessage: string): Promise<{ commitSha: string; htmlUrl: string }> {
    const sha = await this.getExistingSha(path);
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({
          message: commitMessage,
          content: Buffer.from(content, "utf-8").toString("base64"),
          ...(sha ? { sha } : {}),
        }),
      },
    );
    if (!res.ok) throw new Error(`GitHub PUT contents gagal (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { commit: { sha: string }; content: { html_url: string } };
    return { commitSha: body.commit.sha, htmlUrl: body.content.html_url };
  }
}
