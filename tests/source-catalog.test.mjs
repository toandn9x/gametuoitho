// scripts/update-source-catalog.mjs on a synthetic bundle (no network, catalog file untouched).
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanName, extractFromBundle, findBundlePath, fixMojibake, isUsableFilename, mergeCatalog, toCatalogEntry } from '../scripts/update-source-catalog.mjs';

const entry = (id, filename, extra = '') =>
  `{id:"${id}",name:"Game ${id}",developer:"Dev ${id}",category:"Phiêu lưu",categoryKey:"adventure",year:2009,icon:"/icon-game/category/${id}.png",`
  + `description:{vi:"Mô tả ${id}",en:"About ${id}"},tags:["Game Java"],tags_en:[],screenshots:[],filename:"${filename}",settings:{phone:"Nokia S40",width:"176",height:"208"}${extra}}`;
const existing = Array.from({ length: 1000 }, (_, i) => toCatalogEntry({
  id: `Old${i}`, name: `Old ${i}`, filename: `old/${i}.jar`, category: 'Hành động', categoryKey: 'action', year: 2007, icon: `/icon-game/old-${i}.png`,
  description: { vi: `Cũ ${i}` }, settings: { phone: 'Nokia', width: '240', height: '320' },
}));
const upstreamOld = existing.slice(1).map((g) => entry(g.id, g.filename)).join(',');
const bundle = `const M={NewA:"/icon-game/new-a.png",X1:"/icon-game/x1.png",X2:"/icon-game/x2.png",X3:"/icon-game/x3.png",X4:"/icon-game/x4.png",X5:"/icon-game/x5.png"};`
  + `const list=[${upstreamOld},${entry('NewA', 'bisduck-imported/new-a.jar')},${entry('NewB', 'category/Game Việt/New B.jar')},`
  + `${entry('Old5', 'other/old5-v2.jar')},${entry('Copy', 'old/7.jar')},${entry('Off', 'off.jar', ',disabled:!0')},`
  + `${entry('Bad1', '../escape.jar')},${entry('Bad2', 'https://evil.example/x.jar')},${entry('Bad3', '/abs.jar')}];`
  + 'const notAGame={id:"x",filename:"readme.txt"};';

test('extracts every game object and the icon map without running the bundle', () => {
  const { games, icons } = extractFromBundle(bundle);
  assert.equal(games.length, 999 + 8);
  assert.equal(icons.NewA, '/icon-game/new-a.png');
  assert.ok(!games.some((g) => g.filename === 'readme.txt'));
  assert.equal(games.find((g) => g.id === 'Off').disabled, true);
});

test('appends only new usable games; existing entries are unchanged and keep their order', () => {
  const { games, icons } = extractFromBundle(bundle);
  const before = JSON.stringify(existing);
  const { catalog, added, skipped, goneUpstream } = mergeCatalog(existing, games, icons);
  assert.equal(JSON.stringify(existing), before, 'input not mutated');
  assert.deepEqual(catalog.slice(0, existing.length), existing);
  assert.deepEqual(added.map((g) => g.id), ['NewA', 'NewB', 'Old5-2']);
  assert.deepEqual(catalog.slice(existing.length), added);
  assert.deepEqual(skipped.map((s) => s.reason), [
    'file này đã có trong catalog', 'nguồn đang tắt game này',
    'đường dẫn file không tải được qua crawler', 'đường dẫn file không tải được qua crawler', 'đường dẫn file không tải được qua crawler',
  ]);
  assert.deepEqual(goneUpstream.map((g) => g.id), ['Old0']);
});

test('new entries use the catalog format the crawler expects', () => {
  const { games, icons } = extractFromBundle(bundle);
  const { added } = mergeCatalog(existing, games, icons);
  assert.deepEqual(added[0], {
    id: 'NewA', name: 'Game NewA', developer: 'Dev NewA', category: 'Phiêu lưu', categoryKey: 'adventure', year: 2009,
    icon: '/icon-game/new-a.png', filename: 'bisduck-imported/new-a.jar', description: 'Mô tả NewA',
    phone: 'Nokia S40', width: 176, height: 208,
  });
  assert.deepEqual(Object.keys(added[1]), Object.keys(existing[0]), 'same field order as existing entries');
  assert.equal(added[1].icon, '/icon-game/category/NewB.png', 'falls back to the game\'s own icon');
  assert.equal(added[2].filename, 'other/old5-v2.jar', 'a different file under a used id is kept under a new id');
});

test('serialised output keeps the old part byte-for-byte', () => {
  const raw = JSON.stringify(existing, null, 2);
  const { games, icons } = extractFromBundle(bundle);
  const output = JSON.stringify(mergeCatalog(existing, games, icons).catalog, null, 2);
  assert.ok(output.startsWith(raw.slice(0, raw.lastIndexOf('}') + 1)));
});

test('refuses to write when the source looks broken', () => {
  const { games } = extractFromBundle(`const list=[${entry('A', 'a.jar')},${entry('B', 'b.jar')}];`);
  assert.throws(() => mergeCatalog(existing, games), /Chỉ đọc được 2 game/);
});

test('repairs Windows-1252 mojibake only when the result is valid UTF-8, and trims blog prefixes', () => {
  assert.equal(fixMojibake('Táº£i Game Java Snow Bros'), 'Tải Game Java Snow Bros');
  assert.equal(fixMojibake('Bleach - Heir of the Flame tiáº¿ng Viá»‡t'), 'Bleach - Heir of the Flame tiếng Việt');
  assert.equal(fixMojibake('Crazy Soccer Ä‘Ã¡ bÃ³ng vui nhá»™n'), 'Crazy Soccer đá bóng vui nhộn');
  assert.equal(fixMojibake('Age of Empires 3 - Ä\u0090áº¿ Cháº¿ 3'), 'Age of Empires 3 - Đế Chế 3');
  for (const keep of ['Ninja School 2', 'Đồi Câm Lặng', 'Café Ã', 'Phiêu lưu']) assert.equal(fixMojibake(keep), keep, keep);
  assert.equal(cleanName('Tải Game Java Zuma'), 'Zuma');
  assert.equal(cleanName('Tải Game Minecraft cho Java / J2ME'), 'Minecraft cho Java / J2ME');
  assert.equal(cleanName('Tải Courage The Cowardly Dog'), 'Courage The Cowardly Dog');
  assert.equal(cleanName('Tài Xỉu'), 'Tài Xỉu');
  const garbled = extractFromBundle(`const l=[{id:"G",name:"Táº£i Game Java Gauntlet",developer:"bisduckoPath",category:"Phiêu lưu",categoryKey:"adventure",year:2026,icon:"/i.png",description:{vi:"Tiáº¿ng Viá»‡t"},filename:"bisduck-imported/g.jar",settings:{}}];`).games;
  const fixed = toCatalogEntry(garbled[0]);
  assert.equal(fixed.name, 'Gauntlet');
  assert.equal(fixed.description, 'Tiếng Việt');
  assert.equal(fixed.phone, 'Nokia');
  assert.equal(fixed.width, 240);
});

test('filename and bundle path helpers', () => {
  for (const ok of ['DiamondRush_240x320.jar', 'category/Game Tiếng Anh 2/LM-X.JAR', 'bisduck-imported/b.jar']) assert.ok(isUsableFilename(ok), ok);
  for (const bad of ['../x.jar', 'a/../x.jar', '/x.jar', 'https://h/x.jar', 'a\\x.jar', 'x.zip', 'a//x.jar', '', null]) assert.ok(!isUsableFilename(bad), String(bad));
  assert.equal(findBundlePath('<script type="module" crossorigin src="/assets/index-8eYmdY_f.js"></script>'), '/assets/index-8eYmdY_f.js');
  assert.throws(() => findBundlePath('<html></html>'), /Không tìm thấy/);
});
