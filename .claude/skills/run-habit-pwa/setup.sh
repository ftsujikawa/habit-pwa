#!/usr/bin/env bash
# driver.mjs が使う Playwright と headless Chromium を ~/.cache に用意する。アプリの package.json には触れない。
# `npx playwright install` は Node 26 では zip の展開で止まるので、zip を curl で取ってきて python で展開する。
set -euo pipefail

PW_DIR="${HABIT_PW_DIR:-$HOME/.cache/habit-pwa-driver}"
PW_VERSION=1.55.0
REVISION=1187   # playwright-core@1.55.0 の browsers.json にある chromium-headless-shell の revision
DEST="$HOME/.cache/ms-playwright/chromium_headless_shell-$REVISION"
ZIP="$HOME/.cache/habit-pwa-driver/chromium-headless-shell-$REVISION.zip"
URL="https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/$REVISION/chromium-headless-shell-linux.zip"

mkdir -p "$PW_DIR"
if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  (cd "$PW_DIR" && { [ -f package.json ] || npm init -y >/dev/null; } && npm install --no-audit --no-fund "playwright@$PW_VERSION")
fi

if [ -f "$DEST/INSTALLATION_COMPLETE" ]; then
  echo "headless Chromium はインストール済み: $DEST"
else
  [ -f "$ZIP" ] || curl -fsSL --retry 3 -o "$ZIP" "$URL"
  rm -rf "$DEST" && mkdir -p "$DEST"
  python3 -I - "$ZIP" "$DEST" <<'PY'
import os, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
for info in z.infolist():
    path = z.extract(info, sys.argv[2])
    mode = (info.external_attr >> 16) & 0o777   # zipfile は実行権限を戻さないので自分で戻す
    if mode:
        os.chmod(path, mode)
PY
  touch "$DEST/INSTALLATION_COMPLETE"
  echo "展開しました: $DEST"
fi

missing=$(ldd "$DEST/chrome-linux/headless_shell" | grep "not found" || true)
if [ -n "$missing" ]; then
  echo "足りないライブラリがあります(apt-get で入れてください):"; echo "$missing"; exit 1
fi
echo "準備完了"
