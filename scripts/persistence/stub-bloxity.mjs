/**
 * A STAND-IN FOR BLOXITY'S TOKEN VERIFY ROUTE, for `verify:persistence`.
 *
 * Preloaded into the test server with `node --import`, so the production code
 * runs exactly as built - it calls `fetch` on the real URL - and only this one
 * URL is answered locally. Every other fetch goes to the network as normal.
 *
 * The token decides the answer, which is how a test asks for each outcome
 * without a switch in production code:
 *
 *   valid:<id>   200 { user: { _id } }     the documented success shape
 *   bare:<id>    200 { _id }               the other documented success shape
 *   noid:<x>     200 { user: {} }          a 2xx with no id: must NOT verify
 *   down:<x>     503                       Bloxity is down: "unavailable"
 *   hang:<x>     never answers             a timeout: "unavailable"
 *   neterr:<x>   network error             "unavailable"
 *   anything else 401 GAME_TOKEN_INVALID   a forged token: a guest
 *
 * A request naming the wrong gameSlug is rejected whatever its token, as the
 * real route does for a token minted for another game.
 */
const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';
const EXPECTED_SLUG = process.env.STUB_GAME_SLUG ?? 'godspeed-escape';

const realFetch = globalThis.fetch;

const headerOf = (init, name) => {
  const headers = init?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== VERIFY_URL) return realFetch(input, init);

  if ((init?.method ?? 'GET') !== 'POST') return json(404, { message: 'Route not found', statusCode: 404 });

  let body = {};
  try {
    body = JSON.parse(init?.body ?? '{}');
  } catch {
    /* an unparseable body is no gameSlug */
  }
  const authorization = headerOf(init, 'authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  if (!token) return json(401, { code: 'GAME_TOKEN_REQUIRED', error: 'A game capability is required' });
  if (body.gameSlug !== EXPECTED_SLUG) {
    return json(401, { code: 'GAME_TOKEN_INVALID', error: `token is not for ${body.gameSlug}` });
  }

  const at = token.indexOf(':');
  const kind = at >= 0 ? token.slice(0, at) : token;
  const id = at >= 0 ? token.slice(at + 1) : '';
  switch (kind) {
    case 'valid':
      return id ? json(200, { user: { _id: id, username: `user_${id}` } }) : json(401, { code: 'GAME_TOKEN_INVALID' });
    case 'bare':
      return id ? json(200, { _id: id, username: `user_${id}` }) : json(401, { code: 'GAME_TOKEN_INVALID' });
    case 'noid':
      return json(200, { user: { username: 'nobody' } });
    case 'down':
      return json(503, { error: 'maintenance' });
    case 'hang':
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
      });
    case 'neterr':
      throw new TypeError('fetch failed');
    default:
      return json(401, { code: 'GAME_TOKEN_INVALID', error: 'The game capability is invalid or expired' });
  }
};

console.log(`[stub] Bloxity token verify is stubbed for gameSlug "${EXPECTED_SLUG}"`);
