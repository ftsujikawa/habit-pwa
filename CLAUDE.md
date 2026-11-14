# 習慣トラッカー(PWA)の決まり

- データは localStorage だけに保存する。外部のサーバーやサービスへ送らない
- sw.js はネットワーク優先なので、ファイルを変えてもキャッシュ名(habit-tracker-app)は変えない
- 確認は file:// ではなく python3 -m http.server 8000 で配信して行う
- 画面に関係しない処理は habits.js に置き、変えたら node --test を通す
