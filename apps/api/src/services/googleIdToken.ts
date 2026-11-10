/**
 * Verify a Google ID token ("credential" returned by Google Identity Services / Sign in with Google).
 * Uses only WebCrypto + fetch, so it runs the same on Node.js and Cloudflare Workers.
 *
 * Checks: RS256 signature against Google's published keys, issuer, audience (= our OAuth client id),
 * expiry / issued-at (60 s clock skew), and a verified email address.
 */

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const KEYS_TTL_MS = 60 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;

interface GoogleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}

// Google's signing keys, cached per process / Worker isolate.
const keyCache = new Map<string, { keys: GoogleJwk[]; fetchedAt: number }>();

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

async function loadGoogleKeys(jwksUrl: string, refresh: boolean): Promise<GoogleJwk[]> {
  const cached = keyCache.get(jwksUrl);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < (refresh ? MIN_REFRESH_MS : KEYS_TTL_MS)) {
    return cached.keys;
  }

  let response: Response;
  try {
    response = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GoogleTokenError('Không kết nối được tới Google để xác thực. Vui lòng thử lại.');
  }
  if (!response.ok) {
    throw new GoogleTokenError(`Không tải được khóa xác thực của Google (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  keyCache.set(jwksUrl, { keys, fetchedAt: now });
  return keys;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  options: { jwksUrl?: string; nowMs?: number } = {}
): Promise<GoogleIdentity> {
  const invalid = () => new GoogleTokenError('Phiên đăng nhập Google không hợp lệ. Vui lòng thử lại.');

  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw invalid();

  let header: any;
  let payload: any;
  try {
    header = decodeJsonPart(parts[0]);
    payload = decodeJsonPart(parts[1]);
  } catch {
    throw invalid();
  }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();

  // Signature: find the key by id, refreshing once in case Google rotated its keys.
  const jwksUrl = options.jwksUrl || GOOGLE_JWKS_URL;
  let jwk = (await loadGoogleKeys(jwksUrl, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await loadGoogleKeys(jwksUrl, true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw invalid();

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), signedData);
  if (!validSignature) throw invalid();

  // Claims.
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw invalid();
  const audienceOk = Array.isArray(payload.aud) ? payload.aud.includes(clientId) : payload.aud === clientId;
  if (!clientId || !audienceOk) throw invalid();
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new GoogleTokenError('Phiên đăng nhập Google đã hết hạn. Vui lòng thử lại.');
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > now) throw invalid();
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw invalid();
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (typeof payload.email !== 'string' || !emailVerified) {
    throw new GoogleTokenError('Tài khoản Google này chưa xác minh email.');
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}
