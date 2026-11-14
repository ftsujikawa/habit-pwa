# 習慣トラッカー

スマホのホーム画面に追加して使う、オフライン対応の習慣トラッカー(PWA)。
データは端末の中(localStorage)にだけ保存し、外部のサービスやライブラリは使わない。

## できること

- 習慣の追加・削除
- 今日のチェック、カレンダーから過去の日のチェック(前の月にも戻れる)
- 連続日数(今日が未チェックでも、昨日まで続いていれば途切れない)
- 月ごとの記録の表示
- データの書き出し・読み込み(読み込みは今のデータとの置き換え)

## ファイル構成

| ファイル | 内容 |
|---|---|
| `habits.js` | 画面に関係しない処理(日付計算・記録の更新・連続日数・保存形式の検証) |
| `habits.test.js` | `habits.js` のテスト |
| `app.js` / `index.html` / `style.css` | 画面と操作 |
| `sw.js` | オフライン用の Service Worker |
| `manifest.webmanifest` / `icons/` | ホーム画面に追加するための設定とアイコン |
| `tools/make-icons.py` | アイコンを作り直すスクリプト(`python3 tools/make-icons.py`) |
| `sample-backup.json` | 読み込みを試すための練習用データ |

## 動かし方

```bash
npm start   # python3 -m http.server 8000 と同じ
```

ブラウザで `http://localhost:8000/` を開く。`file://` で直接開くと動かない。

## テスト

```bash
npm test    # node --test
```

## 保存形式(version 1)

書き出しファイルは次の形。localStorage にも `exportedAt` を除いた同じ形で保存する。
`records` には記録した日付(YYYY-MM-DD)だけを昇順で入れる。

```json
{
  "version": 1,
  "exportedAt": "2026-11-14T00:00:00.000Z",
  "habits": [
    { "id": "h1", "name": "朝の散歩", "createdAt": "2026-10-31", "records": ["2026-11-01", "2026-11-02"] }
  ]
}
```

## オフラインで開けるかの確認手順

Windows の Chrome または Edge で、WSL から配信する前提。

### 1. サーバーを起動する

```bash
cd /home/tsu/cc-practice/14-habit
python3 -m http.server 8000
```

`Serving HTTP on 0.0.0.0 port 8000` と出たら、ターミナルは開いたままにする。

### 2. 開いて、オフラインの準備ができたか確かめる

1. Chrome で `http://localhost:8000/` を開き、画面と今日の日付が出ることを確かめる。
2. F12 で開発者ツールを開き、**Application** タブを選ぶ(なければ `»` の中)。
3. 左の **Service workers** で次を確かめる。
   - Source が `sw.js`
   - Status が緑の丸と「activated and is running」
   - 上部の「Offline」「Update on reload」「Bypass for network」のチェックがすべて外れている
4. 左の **Storage → Cache storage → `habit-tracker-v4`**(番号は `sw.js` の `CACHE_NAME` と同じ)に、次の9件があることを確かめる。
   `/`、`index.html`、`style.css`、`app.js`、`habits.js`、`manifest.webmanifest`、`icons/` の PNG 3つ
5. 習慣を1つ追加して、今日をチェックしておく。

### 3. オフラインにして開き直す

1. サーバーのターミナルで **Ctrl+C** を押して止める。
2. ブラウザで普通に再読み込み(**F5**)する。Shift+F5 や Ctrl+Shift+R はキャッシュを飛ばすので使わない。
3. 画面が表示され、手順2-5 の習慣とチェックが残っていれば成功。
4. **Network** タブを開いて F5 し、各ファイルの Size 欄が「(ServiceWorker)」になっていることを確かめる。
5. タブを閉じ、新しいタブで `http://localhost:8000/` を開き直しても表示されることを確かめる。
6. オフラインのままチェックやカレンダーの日付を押して F5 し、押した状態が残ることを確かめる。
   保存先は Application → **Local storage → `http://localhost:8000`** の `habit-tracker:v1` で見られる。

確認が終わったら、サーバーをもう一度起動する。

### うまくいかないとき

- **`localhost:8000` が開けない**:WSL から Windows への転送が効いていない可能性がある。WSL の IP アドレスで開くと安全な接続と見なされず、Service Worker が動かない。
- **別のアプリの `sw.js` が出る、またはキャッシュが9件と違う**:同じ `localhost:8000` で別の練習を開いたときの Service Worker やデータが残っている。Application → **Storage → 「Clear site data」** で消してから手順2をやり直す。`localhost:8000` に保存した習慣のデータも消えるので、必要なら先に「書き出す」で控えを取る。
- **Status が activated にならない**:Console タブの赤いエラーを確認する。

## 気をつけること

- **アプリのファイルを変えたら `sw.js` の `CACHE_NAME` の番号を上げる。** 上げないと、インストール済みの端末に古い画面が出続ける。
- スマホでホーム画面に追加するには HTTPS で配信する必要がある(localhost だけは例外)。
- データは端末の中にしかない。機種変更の前には「書き出す」で控えを取る。
- iPhone でホーム画面から開いたときの書き出しは、プレビューが開いて「ファイルに保存」する流れになることがある。
