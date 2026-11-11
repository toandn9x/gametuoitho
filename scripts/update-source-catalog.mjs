#!/usr/bin/env node
// Refresh database/gametuoitho_cc_catalog.json (the list the admin crawler searches) from gametuoitho.cc.
//
// Source: the game list built into gametuoitho.cc's public JavaScript bundle (the same list its pages show).
// The bundle is parsed statically with the TypeScript parser; its code is never executed.
//
// Append-only: existing entries are never changed, reordered or removed. Their id + filename form the
// crawler's source_key (duplicate-import guard), so they must stay as they are. New games are added at the end.
//
// Usage:
//   node scripts/update-source-catalog.mjs                 preview what would change (writes nothing)
//   node scripts/update-source-catalog.mjs --write         update the catalog file
//   node scripts/update-source-catalog.mjs --bundle <file> use a saved bundle instead of downloading it
// Then rebuild/deploy (deploy.bat) so the API serves the new list.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(import.meta.url)('typescript');

export const SITE = 'https://gametuoitho.cc';
export const CATALOG_FILE = path.join(root, 'database', 'gametuoitho_cc_catalog.json');
const USER_AGENT = 'GameTuoiTho-catalog-updater/1.0';

/** Static value of a literal node; undefined for anything computed at runtime. */
function literal(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  // Minifiers write true/false as !0/!1.
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(node.operand)) {
    return !Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && property.name && 'text' in property.name) {
        out[property.name.text] = literal(property.initializer);
      }
    }
    return out;
  }
  return undefined;
}

/**
 * Every game object ({ id, filename: '*.jar', ... }) in the bundle, plus the icon map
 * ({ GameId: '/icon-game/...' }) that holds the real icon of some featured games.
 */
export function extractFromBundle(source) {
  const file = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const games = [];
  const icons = {};
  const seen = new Set();
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map((p) => (p.name && 'text' in p.name ? p.name.text : null));
      if (names.includes('id') && names.includes('filename')) {
        const game = literal(node);
        const key = `${game.id}\u0000${game.filename}`;
        if (typeof game.id === 'string' && typeof game.filename === 'string' && /\.jar$/i.test(game.filename) && !seen.has(key)) {
          seen.add(key);
          games.push(game);
        }
      }
      const values = node.properties.filter(ts.isPropertyAssignment).map((p) => p.initializer);
      if (values.length > 5 && values.every((v) => ts.isStringLiteralLike(v) && v.text.startsWith('/icon-game/'))) {
        Object.assign(icons, literal(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { games, icons };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

// Windows-1252 characters for bytes 0x80-0x9F (the rest of 0x00-0xFF maps to the same code point).
const CP1252 = new Map([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((char, i) => [char, [0x80, 0x82, 0x83, 0x84, 0x85, 0x86,
  0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f][i]]));
const MOJIBAKE = /Ã.|Â.|Ä.|Æ.|á[º»]|â€/u;

/**
 * Some source entries hold UTF-8 text that was decoded as Windows-1252 ("Táº£i" instead of "Tải").
 * Re-encode and decode again; keep the original unless the result is valid UTF-8.
 */
export function fixMojibake(value) {
  if (!MOJIBAKE.test(value)) return value;
  const bytes = [];
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (CP1252.has(char)) bytes.push(CP1252.get(char));
    else return value;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return value;
  }
}

/** Blog-style titles: "Tải Game Java Zuma" → "Zuma" (also helps the crawler's same-name check). */
export function cleanName(name) {
  const cleaned = name.replace(/^Tải\s+(?:Game\s+)?(?:Java\s+)?/iu, '').trim();
  return cleaned || name;
}

/** The crawler downloads https://gametuoitho.cc/games/<filename>; only plain relative .jar paths work. */
export function isUsableFilename(filename) {
  return typeof filename === 'string'
    && /\.jar$/i.test(filename)
    && !filename.startsWith('/')
    && !filename.includes('\\')
    && !filename.includes('://')
    && !filename.split('/').some((part) => part === '..' || part === '.' || part === '');
}

/** Same fields, order and defaults as the existing catalog entries. */
export function toCatalogEntry(game, icons = {}) {
  const settings = game.settings && typeof game.settings === 'object' ? game.settings : {};
  const description = typeof game.description === 'string'
    ? game.description
    : text(game.description?.vi) || text(game.description?.en);
  return {
    id: game.id,
    name: cleanName(fixMojibake(text(game.name))),
    developer: fixMojibake(text(game.developer)) || 'Unknown',
    category: text(game.category) || 'Giải trí',
    categoryKey: text(game.categoryKey) || 'giải-trí',
    year: positive(game.year, 2008),
    icon: icons[game.id] || text(game.icon) || '/placeholder.svg',
    filename: game.filename,
    description: fixMojibake(text(description)) || 'Chưa có mô tả.',
    phone: text(settings.phone) || 'Nokia',
    width: positive(settings.width, 240),
    height: positive(settings.height, 320),
  };
}

const pairKey = (game) => `${game.id}\u0000${game.filename}`;

/** Existing entries stay untouched; new upstream games are appended. */
export function mergeCatalog(existing, upstream, icons = {}) {
  if (upstream.length < 1000 || upstream.length < existing.length * 0.8) {
    throw new Error(`Chỉ đọc được ${upstream.length} game từ gametuoitho.cc (catalog hiện có ${existing.length}). `
      + 'Cấu trúc trang nguồn có thể đã đổi; không ghi gì để tránh làm hỏng catalog.');
  }
  const existingPairs = new Set(existing.map(pairKey));
  const usedIds = new Set(existing.map((g) => g.id));
  const usedFiles = new Set(existing.map((g) => g.filename));
  const added = [];
  const skipped = [];
  for (const game of upstream) {
    if (existingPairs.has(pairKey(game))) continue;
    const label = `${text(game.name) || game.id} (${game.filename})`;
    if (game.disabled === true) { skipped.push({ game: label, reason: 'nguồn đang tắt game này' }); continue; }
    if (!text(game.id) || !text(game.name)) { skipped.push({ game: label, reason: 'thiếu id hoặc tên' }); continue; }
    if (!isUsableFilename(game.filename)) { skipped.push({ game: label, reason: 'đường dẫn file không tải được qua crawler' }); continue; }
    if (usedFiles.has(game.filename)) { skipped.push({ game: label, reason: 'file này đã có trong catalog' }); continue; }
    const entry = toCatalogEntry(game, icons);
    // A different file under an id already in use gets its own id, so each entry stays importable.
    for (let n = 2; usedIds.has(entry.id); n++) entry.id = `${game.id}-${n}`;
    usedIds.add(entry.id);
    usedFiles.add(entry.filename);
    added.push(entry);
  }
  const upstreamPairs = new Set(upstream.map(pairKey));
  const goneUpstream = existing.filter((g) => !upstreamPairs.has(pairKey(g)));
  return { catalog: [...existing, ...added], added, skipped, goneUpstream };
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} trả HTTP ${response.status}`);
  return response.text();
}

/** The site's entry module (/assets/index-<hash>.js) from its home page. */
export function findBundlePath(html) {
  const match = html.match(/<script[^>]*type="module"[^>]*src="(\/assets\/index-[^"]+\.js)"/)
    || html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!match) throw new Error('Không tìm thấy file JavaScript chính trên trang chủ gametuoitho.cc.');
  return match[1];
}

async function main(args) {
  const write = args.includes('--write');
  const bundleIndex = args.indexOf('--bundle');
  let source;
  let from;
  if (bundleIndex >= 0) {
    from = args[bundleIndex + 1];
    if (!from) throw new Error('Thiếu đường dẫn sau --bundle.');
    source = readFileSync(from, 'utf8');
  } else {
    const bundleUrl = new URL(findBundlePath(await fetchText(`${SITE}/`, 30000)), SITE).toString();
    from = bundleUrl;
    source = await fetchText(bundleUrl, 120000);
  }

  const raw = readFileSync(CATALOG_FILE, 'utf8');
  const existing = JSON.parse(raw);
  const { games, icons } = extractFromBundle(source);
  const { catalog, added, skipped, goneUpstream } = mergeCatalog(existing, games, icons);

  console.log(`Nguồn: ${from}`);
  console.log(`Game đọc được từ gametuoitho.cc: ${games.length}`);
  console.log(`Catalog hiện tại: ${existing.length} game`);
  console.log(`Game mới sẽ thêm: ${added.length}`);
  for (const game of added.slice(0, 40)) console.log(`  + ${game.name}  [${game.category}]  ${game.filename}`);
  if (added.length > 40) console.log(`  ... và ${added.length - 40} game khác`);
  if (skipped.length) {
    console.log(`Bỏ qua: ${skipped.length}`);
    for (const item of skipped.slice(0, 20)) console.log(`  - ${item.game}: ${item.reason}`);
  }
  if (goneUpstream.length) {
    console.log(`Có trong catalog nhưng gametuoitho.cc không còn liệt kê (giữ nguyên): ${goneUpstream.length}`);
    for (const game of goneUpstream.slice(0, 20)) console.log(`  ~ ${game.name} (${game.filename})`);
  }

  if (!added.length) {
    console.log('Catalog đã đủ, không có gì để cập nhật.');
    return;
  }
  if (!write) {
    console.log('Chế độ xem trước: chưa ghi gì. Chạy lại với --write để cập nhật catalog.');
    return;
  }
  const output = JSON.stringify(catalog, null, 2);
  // Existing entries must come out byte-for-byte unchanged.
  if (!output.startsWith(raw.slice(0, raw.lastIndexOf('}') + 1))) {
    throw new Error('Phần catalog cũ bị thay đổi khi ghi; dừng lại để an toàn.');
  }
  writeFileSync(CATALOG_FILE, output);
  console.log(`Đã ghi ${CATALOG_FILE} (${catalog.length} game). Chạy deploy.bat để bản online dùng danh sách mới.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Lỗi: ${error.message}`);
    process.exit(1);
  });
}
