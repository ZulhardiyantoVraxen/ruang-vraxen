import { createSign } from "node:crypto";

/**
 * Thin, framework-free Google Sheets + Drive client - same philosophy as
 * GitHubClient: one external service, one place that talks to it, plain
 * `fetch` calls instead of pulling in the full `googleapis` SDK.
 *
 * Auth is a service account JWT (RFC 7523) signed locally with Node's
 * built-in `crypto`, exchanged for a short-lived access token - no OAuth
 * consent flow needed since this never acts as a real person, only as the
 * platform's own "Ruang Vraxen Finance" identity.
 *
 * "Finance membuat dokumen per project di Google Sheets" - this creates one
 * spreadsheet per call (per budget task) inside a folder the director has
 * already shared with the service account, so every sheet it makes shows up
 * in the director's own Drive without any further sharing step per file.
 */
export class GoogleSheetsClient {
  private readonly clientEmail: string;
  private readonly privateKey: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: { clientEmail: string; privateKey: string }) {
    this.clientEmail = config.clientEmail;
    // .env stores the PEM with literal "\n" sequences (real newlines aren't
    // valid in a single env var line) - undo that before handing it to crypto.
    this.privateKey = config.privateKey.includes("\\n") ? config.privateKey.replace(/\\n/g, "\n") : config.privateKey;
  }

  private base64url(input: Buffer | string): string {
    return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30) return this.cachedToken.token;

    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: this.clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${this.base64url(JSON.stringify(header))}.${this.base64url(JSON.stringify(claims))}`;
    const signature = createSign("RSA-SHA256").update(signingInput).sign(this.privateKey);
    const assertion = `${signingInput}.${this.base64url(signature)}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth token gagal (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }

  /**
   * Returns the id of an existing child folder of `parentFolderId` named
   * exactly `name`, or null if none exists yet.
   *
   * `includeItemsFromAllDrives`+`supportsAllDrives` are required the moment
   * `parentFolderId` lives inside a Drive bersama (Shared Drive) rather than
   * someone's My Drive - without them the Drive API silently excludes Shared
   * Drive content from search results instead of erroring, which would make
   * every project look "new" and spawn duplicate subfolders.
   */
  async findFolderByName(name: string, parentFolderId: string): Promise<string | null> {
    const token = await this.getAccessToken();
    const q = encodeURIComponent(
      `name='${name.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&includeItemsFromAllDrives=true&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Google Drive cari folder gagal (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { files?: { id: string }[] };
    return body.files?.[0]?.id ?? null;
  }

  /** Creates a new subfolder named `name` directly inside `parentFolderId` (e.g. "Semua Project" -> one folder per project) and returns its id. */
  async createFolder(name: string, parentFolderId: string): Promise<string> {
    const token = await this.getAccessToken();
    const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId] }),
    });
    if (!res.ok) throw new Error(`Google Drive buat folder gagal (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  /**
   * Creates a new spreadsheet with one sheet of `rows`, directly inside
   * `parentFolderId`, and returns its id + editable Drive URL.
   *
   * Deliberately created via the DRIVE API (files.create with `parents` set
   * up front) rather than Sheets API's own `spreadsheets.create` - a plain
   * service account has zero Drive storage quota of its own
   * (`about.storageQuota.limit === "0"`), so a file that materializes in its
   * own My Drive first (as spreadsheets.create always does, with no way to
   * set a parent at creation) is rejected outright with a bare 403
   * "The caller does not have permission" before it can even be moved.
   *
   * `parentFolderId` MUST be inside a Drive bersama (Shared Drive), not a
   * regular My Drive folder. A file a service account creates inside someone
   * else's ordinary folder is still quota-charged to the CREATOR, not the
   * folder owner - so it fails with 403 storageQuotaExceeded even when the
   * folder owner's own Drive has plenty of room, because the service account
   * itself has 0 bytes of quota. Inside a Shared Drive, new files are charged
   * to the Shared Drive's own (org-pooled) storage instead, which has no
   * single "creator" to run out of room - this is why `supportsAllDrives`
   * is required on both calls below.
   */
  async createSpreadsheet(
    title: string,
    rows: (string | number)[][],
    parentFolderId: string,
  ): Promise<{ spreadsheetId: string; url: string }> {
    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentFolderId],
      }),
    });
    if (!createRes.ok) throw new Error(`Google Drive buat spreadsheet gagal (${createRes.status}): ${await createRes.text()}`);
    const created = (await createRes.json()) as { id: string };
    const spreadsheetId = created.id;

    // A spreadsheet created via the Drive API (rather than Sheets API) gets
    // Google's default first-tab name, "Sheet1". The Sheets API's
    // values.update endpoint has no Shared Drive flag of its own to set -
    // it works against any spreadsheet the caller can already edit.
    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`,
      { method: "PUT", headers, body: JSON.stringify({ values: rows }) },
    );
    if (!valuesRes.ok) throw new Error(`Google Sheets isi nilai gagal (${valuesRes.status}): ${await valuesRes.text()}`);

    return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }
}
