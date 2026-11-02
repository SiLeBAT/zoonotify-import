/**
 * Thin HTTP helpers for driving a live Strapi instance from the integration
 * test: provision the dedicated custom Import token, and read collection state
 * back through the admin content-manager API (the Import token itself has no
 * public-REST read access, per CONTEXT.md § Import role).
 */

const ADMIN = {
  email: 'integration@zoonotify.test',
  password: 'Integration1!',
  firstname: 'Integration',
};

/** Polls `GET /_health` until Strapi answers or the deadline passes. */
export async function waitForStrapi(baseUrl: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${baseUrl}/_health`;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 204) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Strapi did not become healthy within ${timeoutMs}ms at ${url}`);
    }
    await delay(2000);
  }
}

/** Registers the first admin (or logs in if one already exists) and returns an admin JWT. */
export async function adminJwt(baseUrl: string): Promise<string> {
  const register = await fetch(`${baseUrl}/admin/register-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (register.ok) {
    return ((await register.json()) as { data: { token: string } }).data.token;
  }
  // Already registered — log in instead.
  const login = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  if (!login.ok) {
    throw new Error(`admin login failed: ${login.status} ${await login.text()}`);
  }
  return ((await login.json()) as { data: { token: string } }).data.token;
}

/**
 * The token the CMS `is-import-token` policy accepts — it mirrors `importToken`
 * in zoonotify-cms `config/permissions.mjs`. The policy refuses, with a 403
 * `PolicyError` naming the mismatch, any token that is not of type `custom`,
 * not named exactly `Import`, or whose grants are not exactly these actions.
 */
const IMPORT_TOKEN = {
  name: 'Import',
  type: 'custom',
  actions: [
    'api::import-admin.import-admin.truncate',
    'api::import-admin.import-admin.bulkCreate',
    'api::import-admin.import-admin.recordImport',
  ],
} as const;

/**
 * Creates the Import token exactly as the strict `is-import-token` policy
 * expects (see IMPORT_TOKEN). Token names are unique in Strapi, so an `Import`
 * token left over from an earlier run against the same database is deleted
 * first; the docker-compose stack normally starts from a fresh database.
 */
export async function createImportToken(baseUrl: string, jwt: string): Promise<string> {
  const auth = { authorization: `Bearer ${jwt}` };
  const list = await fetch(`${baseUrl}/admin/api-tokens`, { headers: auth });
  if (!list.ok) {
    throw new Error(`api-token list failed: ${list.status} ${await list.text()}`);
  }
  const existing = ((await list.json()) as { data: Array<{ id: number; name: string }> }).data;
  for (const token of existing.filter((t) => t.name === IMPORT_TOKEN.name)) {
    const del = await fetch(`${baseUrl}/admin/api-tokens/${token.id}`, {
      method: 'DELETE',
      headers: auth,
    });
    if (!del.ok) {
      throw new Error(`api-token delete failed: ${del.status} ${await del.text()}`);
    }
  }

  const res = await fetch(`${baseUrl}/admin/api-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      name: IMPORT_TOKEN.name,
      description: 'Integration-test Import token',
      type: IMPORT_TOKEN.type,
      lifespan: null,
      permissions: IMPORT_TOKEN.actions,
    }),
  });
  if (!res.ok) {
    throw new Error(`api-token create failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { data: { accessKey: string } }).data.accessKey;
}

/**
 * Ensures a non-default locale (e.g. `de`) exists, via the i18n admin API.
 * Idempotent: a fresh Strapi seeds only the default `en`, so the Import CLI's
 * DE localizations would silently land nowhere until `de` is registered — this
 * mirrors the production CMS, where `de` is configured in the admin panel.
 */
export async function ensureLocale(
  baseUrl: string,
  jwt: string,
  code: string,
  name: string,
): Promise<void> {
  const auth = { authorization: `Bearer ${jwt}` };
  const existing = await fetch(`${baseUrl}/i18n/locales`, { headers: auth });
  if (!existing.ok) {
    throw new Error(`i18n locales list failed: ${existing.status} ${await existing.text()}`);
  }
  const locales = (await existing.json()) as Array<{ code: string }>;
  if (locales.some((l) => l.code === code)) return;

  const res = await fetch(`${baseUrl}/i18n/locales`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ code, name, isDefault: false }),
  });
  if (!res.ok) {
    throw new Error(`i18n locale create (${code}) failed: ${res.status} ${await res.text()}`);
  }
}

interface CmResult {
  results: Array<{ id: number; name?: string; iri?: string; [field: string]: unknown }>;
  pagination: { total: number };
}

/** Reads a collection's rows for one locale via the content-manager API. */
export async function listCollection(
  baseUrl: string,
  jwt: string,
  collection: string,
  locale: 'en' | 'de',
): Promise<CmResult> {
  const uid = `api::${collection}.${collection}`;
  const url = `${baseUrl}/content-manager/collection-types/${uid}?locale=${locale}&page=1&pageSize=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${jwt}` } });
  if (!res.ok) {
    throw new Error(`content-manager list ${collection}/${locale} failed: ${res.status}`);
  }
  return (await res.json()) as CmResult;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
