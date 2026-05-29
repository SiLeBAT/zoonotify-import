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
 * Creates a custom API token granted the two import-admin route actions. The
 * `is-import-token` policy accepts any custom-type token; Strapi's api-token
 * strategy additionally requires the token to carry the route permissions.
 */
export async function createImportToken(baseUrl: string, jwt: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/api-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      name: `import-integration-${Date.now()}`,
      description: 'Integration-test Import token',
      type: 'custom',
      lifespan: null,
      permissions: [
        'api::import-admin.import-admin.truncate',
        'api::import-admin.import-admin.bulkCreate',
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`api-token create failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { data: { accessKey: string } }).data.accessKey;
}

interface CmResult {
  results: Array<{ id: number; name?: string; iri?: string }>;
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
