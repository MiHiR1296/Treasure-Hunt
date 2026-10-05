const input = process.env.SMOKE_ORIGIN;
let origin;
try { origin = new URL(input); } catch { throw new Error('Set SMOKE_ORIGIN to the deployed V3 origin.'); }
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
if (origin.origin !== input || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))) {
  throw new Error('SMOKE_ORIGIN must be an exact HTTPS origin (HTTP is allowed only for loopback).');
}

async function json(pathname) {
  const response = await fetch(new URL(pathname, origin), {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`V3 smoke check failed for ${pathname} (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new Error(`V3 smoke check received a non-JSON response for ${pathname}.`);
  }
  return response.json();
}

const health = await json('/api/v3/health');
if (health.status !== 'ok' || health.engine !== 'v3') throw new Error('The endpoint is not a healthy V3 engine.');
const listing = await json('/api/v3/hunts');
if (!Array.isArray(listing.hunts)) throw new Error('The V3 hunt listing response is invalid.');

const boardSlug = process.env.SMOKE_PUBLIC_BOARD_SLUG;
if (boardSlug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(boardSlug)) throw new Error('SMOKE_PUBLIC_BOARD_SLUG is invalid.');
  const board = await json(`/api/v3/public-board/${boardSlug}`);
  const privateKeys = new Set(['membername', 'member_name', 'privateseed', 'private_seed', 'recognitionvotes', 'recognition_votes', 'pinhash', 'pin_hash']);
  const containsPrivateKey = value => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(containsPrivateKey);
    return Object.entries(value).some(([key, child]) => privateKeys.has(key.toLowerCase()) || containsPrivateKey(child));
  };
  if (containsPrivateKey(board)) {
    throw new Error('The public board response contains a private field.');
  }
}
console.log(`V3 read-only smoke passed at ${origin.origin}; ${listing.hunts.length} playable hunt(s) listed.`);
