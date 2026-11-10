/**
 * Cloudflare Workers entry (see apps/api/wrangler.toml).
 *
 * One Worker serves the whole site on one domain:
 * - /api/v1/*        → the Hono API (D1 database + private Tigris storage; R2 optional)
 * - /admin, /admin/* → admin pages, only for ADMIN accounts (same rule as the Node server)
 * - /emulator/freej2me-web.jar → served with Range support (needed by the emulator on Safari/iPhone)
 * - everything else  → the built web app (Workers Static Assets). Cloudflare serves existing files
 *                      directly; the Worker only sees requests that match no file, and answers them
 *                      with the page shells (games added after the last web build) or the 404 page.
 *
 * Local Node.js still uses src/server.ts; nothing here runs there.
 */
import type { Context } from 'hono';
import { createApp } from './index';
import { ADMIN_PAGE_PATTERN, decideAdminPageAccess, FORBIDDEN_FALLBACK_HTML } from './middleware/adminPages';
import { RANGE_ASSET_PATHS, withByteRange } from './middleware/byteRange';
import type { AppEnv } from './types';

const app = createApp();

// Client-rendered shells for detail pages that did not exist when the web app was built.
const PAGE_SHELLS: [RegExp, string][] = [
  [/^\/play\/[^/]+\/?$/, '/play/_shell/'],
  [/^\/game\/[^/]+\/?$/, '/game/_shell/'],
  [/^\/categories\/[^/]+\/?$/, '/categories/_shell/'],
];

function assetRequest(c: Context<AppEnv>, pathname: string): Request {
  return new Request(new URL(pathname, c.req.url), { method: 'GET', headers: c.req.raw.headers });
}

async function withStatus(response: Response, status: number, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const out = new Response(response.body, { status, headers: response.headers });
  for (const [name, value] of Object.entries(extraHeaders)) out.headers.set(name, value);
  return out;
}

// Admin pages: decided here before any HTML leaves the Worker.
app.use('*', async (c, next) => {
  if (!ADMIN_PAGE_PATTERN.test(c.req.path) || !c.env.ASSETS) return next();

  const decision = decideAdminPageAccess(c);
  if (decision.kind === 'login') {
    return c.redirect(decision.location, 302);
  }
  if (decision.kind === 'forbidden') {
    const page = await c.env.ASSETS.fetch(assetRequest(c, '/403/'));
    return page.ok
      ? withStatus(page, 403, { 'Cache-Control': 'no-store' })
      : new Response(FORBIDDEN_FALLBACK_HTML, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  const page = await c.env.ASSETS.fetch(c.req.raw);
  return withStatus(page, page.status, { 'Cache-Control': 'no-store' });
});

// Emulator files read in byte ranges (Static Assets alone answer Range with the whole file).
for (const assetPath of RANGE_ASSET_PATHS) {
  app.get(assetPath, async (c) => {
    if (!c.env.ASSETS) return c.notFound();
    const range = c.req.header('Range');
    if (!range) return c.env.ASSETS.fetch(c.req.raw);
    // Ask for the plain file (no Range, no If-None-Match) so the slice is taken from a full 200 body.
    return withByteRange(range, await c.env.ASSETS.fetch(new Request(c.req.url)));
  });
}

// Requests that matched no static file (API routes registered earlier take precedence).
app.on(['GET', 'HEAD'], '*', async (c) => {
  if (c.req.path.startsWith('/api/') || !c.env.ASSETS) return c.notFound();

  for (const [pattern, shell] of PAGE_SHELLS) {
    if (pattern.test(c.req.path)) {
      return c.env.ASSETS.fetch(assetRequest(c, shell));
    }
  }

  const notFound = await c.env.ASSETS.fetch(assetRequest(c, '/404'));
  return notFound.ok ? withStatus(notFound, 404) : c.text('Not Found', 404);
});

export default app;
