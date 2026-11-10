// Build the web app for Cloudflare (used by `pnpm cf:build`).
//
// The normal build pre-renders one page per game by asking the API at PUBLIC_API_URL
// (default http://localhost:4321). For Cloudflare we point it at an address that does not
// answer, so no data from your local database ends up in the deployed files: every game page
// is served from its client-side shell and loads its data from the live API instead.
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['--filter', '@gametuoitho/web', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PUBLIC_API_URL: 'http://127.0.0.1:9/api/v1' },
});

process.exit(result.status ?? 1);
