---
name: run-habit-pwa
description: Run, start, drive, and screenshot the habit tracker PWA (習慣トラッカー) in headless Chromium — add habits, check days, import/export JSON backups, delete, and verify offline/Service Worker behavior locally or against the GitHub Pages deploy. Use when asked to run the app, take a screenshot, test a UI change, check offline mode, or run its tests.
---

Vanilla HTML/JS の PWA(ビルドなし・依存なし)。エージェントは
`.claude/skills/run-habit-pwa/driver.mjs` で操作する:これが `python3 -m http.server` を空きポートで立て、
Playwright の headless Chromium(スマホ幅 390×844、日時は 2026-11-14 10:00 Asia/Tokyo に固定)で実際にクリックし、
スクリーンショットを撮る。

パスはすべてプロジェクトのルート(`package.json` のある場所)からの相対。

## Prerequisites

Node(このコンテナは v26.13.1)と python3 があればよい。sudo も apt-get も不要だった(Ubuntu 26.04 / WSL2 で
`ldd` に not found なし)。Playwright と Chromium は **アプリの外**(`~/.cache/habit-pwa-driver` と
`~/.cache/ms-playwright`)に入れる — このアプリは「外部ライブラリを使わない」方針なので `package.json` に足さないこと。

```bash
bash .claude/skills/run-habit-pwa/setup.sh
```

初回は約15秒(zip 104MB をダウンロード)。2回目以降は「インストール済み」で即終わる。

## Run (agent path)

```bash
node .claude/skills/run-habit-pwa/driver.mjs            # 全シナリオ(smoke import export delete offline)
node .claude/skills/run-habit-pwa/driver.mjs smoke      # 指定したシナリオだけ(複数可)
node .claude/skills/run-habit-pwa/driver.mjs --url https://ftsujikawa.github.io/habit-pwa/ --shots /tmp/habit-pwa-shots-live import offline
```

各チェックを `OK  …` で出し、最後に「すべて成功」(exit 0)/「失敗」(exit 1)。ブラウザの console error /
pageerror があっても失敗にする。サーバーは終了時に自分で止める。

スクリーンショット → `/tmp/habit-pwa-shots/NN-<name>.png`(`--shots DIR` で変更)。全ページ撮影。
**撮ったら Read で中身を見ること。**

| シナリオ | やること |
|---|---|
| `smoke` | 空状態 → 空欄で追加してエラー → 追加 → 今日チェック(1日連続)→ カレンダーで 11/13 を付ける(2日連続)→ 未来日が押せないこと → 前の月へ → 再読み込みで記録が残る |
| `import` | `sample-backup.json` を選ぶ → 確認ダイアログを一度キャンセル(置き換わらない)→ OK → 朝の散歩(練習用)が「5日連続」、カード3件 |
| `export` | 「書き出す」のダウンロードを受け取り、`habit-backup-2026-11-14.json`・version 1・件数一致を確かめる |
| `delete` | 先頭の習慣の「削除」→ 確認ダイアログ OK → 消えたこと |
| `offline` | SW がページを管理し、キャッシュ `habit-tracker-app` に 9 件あることを確認 → ローカルなら **サーバーを停止**、`--url` ならネットワーク遮断 → 再読み込みで表示とデータが出る → オフラインでチェックできる |

シナリオは同じページで順に走る(前のシナリオの状態を引き継ぐ)。新しいシナリオは `driver.mjs` の `run` に
関数を足す。ヘルパー `card(page, 名前)`・`streakOf`・`message`・`addHabit`・`shot` がある。

### Direct invocation(画面を通さずロジックだけ)

画面に関係しない処理はすべて `habits.js`(ESM)にある。PR の多くはここだけで確かめられる:

```bash
node -e "import('./habits.js').then(h => { const s = h.parseState(require('fs').readFileSync('sample-backup.json','utf8')); console.log(s.habits.map(x => [x.name, h.currentStreak(x, '2026-11-14')])); })"
```

→ `[ [ '朝の散歩(練習用)', 5 ], [ '読書15分(練習用)', 0 ], [ '日記を書く(練習用)', 0 ] ]`

## Run (human path)

```bash
npm start   # = python3 -m http.server 8000 → ブラウザで http://localhost:8000/ 。Ctrl+C で停止
```

## Test

```bash
npm test    # node --test(habits.test.js)。27 件 pass
```

## Gotchas

- **`npx playwright install` は Node 26 で zip 展開のまま永久に止まる**(ダウンロードは終わり、CPU 0%、
  ディレクトリに数ファイルだけ)。1.49.1 でも 1.55.0 でも再現。→ `setup.sh` が CDN から curl で取り、
  python `zipfile` で展開する。zipfile は実行権限を戻さないので `external_attr` から chmod している。
- **Playwright は Ubuntu 26.04 を知らない**:`ERROR: Playwright does not support chromium-headless-shell on
  ubuntu26.04-x64`。→ `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`(driver.mjs が自動で設定)。
- **未来の日付は `button` ではなく `span.cal-day.is-future` で、`data-date` を持たない**。
  `.cal-day[data-date="2026-11-15"]` を待つと 30 秒タイムアウトする。過去・今日だけが `button[data-date]`。
- **日時を固定しないと sample-backup.json の連続日数が日によって変わる**(記録は 11/1〜11/14)。
  driver は `page.clock.install({ time })` + `timezoneId: 'Asia/Tokyo'` で 2026-11-14 に固定している。
  別の日で試したいなら `FIXED_NOW` を変える。
- **確認は `window.confirm`**。`page.once('dialog', d => d.accept() / d.dismiss())` をクリックの前に登録する。
  登録し忘れると Playwright が自動で dismiss し、読み込み・削除が「何も起きない」ように見える。
- **オフライン確認は SW が controller になってから**:初回 `goto` 直後は `navigator.serviceWorker.controller`
  が null で、そのままオフラインにして reload すると `net::ERR_INTERNET_DISCONNECTED`。
  `navigator.serviceWorker.ready` を待って一度 reload してから遮断する(driver の `offline` がそうしている)。
- **ローカルのオフライン確認はサーバーを本当に止めている**(`setOffline` より実機に近い)。
  `sw.js` はネットワーク優先で、接続拒否なら即キャッシュ、応答なしなら 3 秒でキャッシュに切り替わる。
- **localStorage は origin ごと**。`ftsujikawa.github.io` 上の他のリポジトリのページと共有される。
  driver は毎回新しいブラウザコンテキストなので、実ユーザーのデータには触れない。
- **`pkill -f <パターン>` を使わない**:パターンが自分の bash コマンド行にも一致し、シェルごと落ちた(exit 144)。

## Troubleshooting

- **`playwright が見つかりません: ~/.cache/habit-pwa-driver`**(exit 2):`setup.sh` を未実行。
- **`知らないシナリオ: …`**(exit 2):シナリオ名の打ち間違い。`smoke / import / export / delete / offline / all`。
- **`期待と違う: …`**:そのチェックが失敗。直前の `📷` のスクリーンショットを Read して画面を見る。
