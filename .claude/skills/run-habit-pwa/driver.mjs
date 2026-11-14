#!/usr/bin/env node
// 習慣トラッカー(PWA)を headless Chromium で実際に操作するドライバー。
//
//   node .claude/skills/run-habit-pwa/driver.mjs [シナリオ...] [--url URL] [--shots DIR] [--headed]
//
// シナリオ(省略時は all):
//   smoke    習慣を追加 → 今日をチェック → 過去の日をチェック → 前の月へ → スクリーンショット
//   import   sample-backup.json を読み込む(確認ダイアログで一度キャンセル → OK)
//   export   書き出したファイルを受け取り、中身を確かめる
//   delete   習慣を削除する(確認ダイアログで OK)
//   offline  Service Worker が有効になってからサーバーを止め、再読み込みして表示とデータを確かめる
//   all      上の全部を順に
//
// --url を省略すると、このプロジェクトを python3 -m http.server で 127.0.0.1 の空きポートから配信する。
// --url https://ftsujikawa.github.io/habit-pwa/ のように公開版も操作できる(offline はネットワーク遮断で代用)。
//
// 日時は 2026-11-14 10:00(Asia/Tokyo)に固定する。sample-backup.json の連続日数が毎回同じになるように。
// Playwright は ~/.cache/habit-pwa-driver に入れる(アプリの package.json には入れない)。

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PW_DIR = process.env.HABIT_PW_DIR ?? join(homedir(), '.cache/habit-pwa-driver');
// Playwright 1.55 は Ubuntu 26.04 を知らないので 24.04 のビルドを使わせる
process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-x64';

let chromium;
try {
  ({ chromium } = createRequire(join(PW_DIR, 'package.json'))('playwright'));
} catch {
  console.error(`playwright が見つかりません: ${PW_DIR}\nSKILL.md の「Prerequisites」を実行してください。`);
  process.exit(2);
}

// ---- 引数 ----
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true; };
const urlArg = opt('--url');
const SHOTS = resolve(opt('--shots') ?? '/tmp/habit-pwa-shots');
const headed = flag('--headed');
const ALL = ['smoke', 'import', 'export', 'delete', 'offline'];
let scenarios = args.length ? args : ['all'];
if (scenarios.includes('all')) scenarios = ALL;
for (const s of scenarios) if (!ALL.includes(s)) { console.error(`知らないシナリオ: ${s}(${ALL.join(' / ')} / all)`); process.exit(2); }
mkdirSync(SHOTS, { recursive: true });

const FIXED_NOW = new Date('2026-11-14T10:00:00+09:00');

// ---- 小道具 ----
let step = 0;
const ok = (msg) => console.log(`  OK  ${msg}`);
function expect(cond, msg) { if (!cond) throw new Error(`期待と違う: ${msg}`); ok(msg); }
async function shot(page, name) {
  step += 1;
  const file = join(SHOTS, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📷  ${file}`);
}

async function freePort() {
  return new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}

async function startServer() {
  const port = await freePort();
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', UNIT], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(url)).ok) return { url, stop: () => child.kill() }; } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('http.server が起動しませんでした');
}

async function openApp(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 くらい
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.clock.install({ time: FIXED_NOW });
  await page.goto(url);
  await page.locator('#today').filter({ hasText: '11月14日(土)' }).waitFor();
  return { context, page, errors };
}

const card = (page, name) => page.locator('li.card').filter({ has: page.locator('h2', { hasText: name }) });
const streakOf = async (page, name) => (await card(page, name).locator('.streak').textContent()).trim();
const message = async (page) => (await page.locator('#message').textContent()).trim();

async function addHabit(page, name) {
  await page.fill('#habit-name', name);
  await page.click('#add-form button[type=submit]');
  await card(page, name).waitFor();
}

// ---- シナリオ ----
const run = {
  async smoke({ page }) {
    await shot(page, 'empty');
    expect(await page.locator('#empty').isVisible(), '最初は「まだ習慣がありません」が出る');

    await page.click('#add-form button[type=submit]');
    expect((await message(page)).includes('名前を入力'), '空のまま追加するとエラー文が出る');

    await addHabit(page, '朝の散歩');
    expect(await streakOf(page, '朝の散歩') === '連続記録なし', '追加直後は「連続記録なし」');

    await card(page, '朝の散歩').locator('button.check').click();
    expect(await card(page, '朝の散歩').locator('button.check').getAttribute('aria-pressed') === 'true', '今日のボタンが押された状態になる');
    expect(await streakOf(page, '朝の散歩') === '1日連続', 'チェックで「1日連続」');

    await card(page, '朝の散歩').locator('button.cal-day[data-date="2026-11-13"]').click();
    expect(await streakOf(page, '朝の散歩') === '2日連続', '昨日(11/13)をカレンダーで付けると「2日連続」');
    expect((await message(page)).includes('11月13日(金)を記録しました'), '過去の日を付けた旨のメッセージが出る');
    // 未来の日はボタンではなく data-date も持たない span
    expect(await card(page, '朝の散歩').locator('button[data-date="2026-11-15"]').count() === 0
      && await card(page, '朝の散歩').locator('span.cal-day.is-future', { hasText: /^15$/ }).count() === 1, '未来の日(11/15)は押せない');
    expect((await card(page, '朝の散歩').locator('.month-summary').textContent()).includes('2 / 14日'), '月の集計が「2 / 14日」');
    await shot(page, 'checked');

    await page.click('#prev-month');
    expect((await page.locator('#month-label').textContent()) === '10月', '「‹」で10月に戻る');
    await card(page, '朝の散歩').locator('button.cal-day[data-date="2026-10-31"]').click();
    await page.click('#next-month');
    expect(await page.locator('#next-month').isDisabled(), '今月に戻ると「›」は押せない');
    expect(await streakOf(page, '朝の散歩') === '2日連続', '10/31 は 11/13 とつながらないので連続は 2 のまま');

    await page.reload();
    await card(page, '朝の散歩').waitFor();
    expect(await streakOf(page, '朝の散歩') === '2日連続', '再読み込みしても記録が残る(localStorage)');
  },

  async import({ page }) {
    const sample = join(UNIT, 'sample-backup.json');
    const pick = async () => {
      const chooser = page.waitForEvent('filechooser');
      await page.click('#import-button');
      await (await chooser).setFiles(sample);
    };
    let dialogText = '';
    page.once('dialog', (d) => { dialogText = d.message(); d.dismiss(); });
    await pick();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    expect(dialogText.includes('習慣3件・記録26日分'), '確認ダイアログにファイルの件数が出る');
    expect(!(await card(page, '朝の散歩(練習用)').count()), 'キャンセルすると置き換わらない');

    page.once('dialog', (d) => d.accept());
    await pick();
    await card(page, '朝の散歩(練習用)').waitFor();
    expect((await message(page)).includes('習慣3件・記録26日分を読み込みました'), '読み込み完了のメッセージ');
    expect(await streakOf(page, '朝の散歩(練習用)') === '5日連続', '朝の散歩(練習用) は 5日連続');
    expect(await streakOf(page, '読書15分(練習用)') === '連続記録なし', '読書15分(練習用) は連続記録なし');
    expect(await page.locator('li.card').count() === 3, 'カードが3件');
    await shot(page, 'imported');
  },

  async export({ page }) {
    if (!(await page.locator('li.card').count())) await addHabit(page, '書き出し用');
    const download = page.waitForEvent('download');
    await page.click('#export-button');
    const file = await download;
    const text = readFileSync(await file.path(), 'utf8');
    const data = JSON.parse(text);
    expect(file.suggestedFilename() === 'habit-backup-2026-11-14.json', `ファイル名 ${file.suggestedFilename()}`);
    expect(data.version === 1 && typeof data.exportedAt === 'string' && Array.isArray(data.habits), '中身は version 1 の形');
    expect(data.habits.length === (await page.locator('li.card').count()), '画面の習慣の数と一致');
  },

  async delete({ page }) {
    if (!(await page.locator('li.card').count())) await addHabit(page, '消す用');
    const before = await page.locator('li.card').count();
    const name = (await page.locator('li.card h2').first().textContent()).trim();
    let dialogText = '';
    page.once('dialog', (d) => { dialogText = d.message(); d.accept(); });
    await page.locator('li.card').first().locator('button.remove').click();
    await page.waitForFunction((n) => document.querySelectorAll('li.card').length === n, before - 1);
    expect(dialogText.includes('元に戻せません'), '削除前に確認ダイアログが出る');
    expect((await message(page)).includes(`「${name}」を削除しました`), `「${name}」を削除できた`);
  },

  async offline({ page, context, server, url }) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // SW の管理下で読み直す
    await page.locator('#today').waitFor();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    expect(controlled, 'Service Worker がページを管理している');
    const cached = await page.evaluate(async () => (await (await caches.open('habit-tracker-app')).keys()).length);
    expect(cached >= 9, `キャッシュ habit-tracker-app に ${cached} 件`);
    if (!(await page.locator('li.card').count())) await addHabit(page, 'オフライン確認');
    const cardsBefore = await page.locator('li.card').count();

    if (server) server.stop(); else await context.setOffline(true);
    console.log(server ? '      (サーバーを停止)' : '      (ネットワークを遮断)');
    await page.reload();
    await page.locator('#today').filter({ hasText: '11月14日' }).waitFor();
    expect(await page.locator('li.card').count() === cardsBefore, `オフラインで再読み込みしても習慣 ${cardsBefore} 件が表示される`);
    await page.locator('li.card').first().locator('button.check').click();
    await page.reload();
    await page.locator('li.card').first().waitFor();
    ok('オフラインのままチェックして再読み込みできる');
    await shot(page, 'offline');
  },
};

// ---- 実行 ----
const server = urlArg ? null : await startServer();
const url = urlArg ?? server.url;
const browser = await chromium.launch({ headless: !headed });
let failed = false;
console.log(`URL: ${url}\nスクリーンショット: ${SHOTS}\n`);
try {
  const ctx = await openApp(browser, url);
  for (const name of scenarios) {
    console.log(`▶ ${name}`);
    await run[name]({ ...ctx, server, url });
  }
  if (ctx.errors.length) { failed = true; console.log(`\nブラウザのエラー:\n  ${ctx.errors.join('\n  ')}`); }
} catch (err) {
  failed = true;
  console.error(`\n✖ ${err.message}`);
} finally {
  await browser.close();
  server?.stop();
}
console.log(failed ? '\n失敗' : '\nすべて成功');
process.exit(failed ? 1 : 0);
