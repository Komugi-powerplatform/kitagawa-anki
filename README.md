# KitagawaAnki

iPhone のホーム画面から使う、個人用の暗記カードアプリ（PWA）。
出題の計算は [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（FSRS-6, MIT License）を使っています。Anki 本体のコードは使っていません。

- 公開先: https://komugi-powerplatform.github.io/kitagawa-anki/
- データは端末のブラウザの中だけに保存します（サーバーには送りません）。設定画面からバックアップを書き出せます。
- ノートの型: 基本／基本（逆向きも）／穴埋め（`{{c1::答え}}`・`{{c1::答え::ヒント}}`）
- 復習中の編集・保留（翌朝まで）・停止・取り消し、一覧の検索と絞り込み、デッキごとの1日の上限

## iPhone で使う
1. Safari で上の URL を開き、共有ボタン →「ホーム画面に追加」
2. ホーム画面のアイコンから開き、「設定」→「ファイルを選ぶ」でカードの JSON を取り込む

## Mac の Anki からカードを移す
```sh
python3 scripts/export_from_anki.py ~/Desktop/anki.import.json
```
「基本」型のノートの1番目の項目を表、2番目を裏として書き出します（Anki のデータは書き換えません）。

## 開発
```sh
npm install
npm run dev      # 開発サーバー
npm test         # Vitest
npm run build    # 型チェック + ビルド
python3 -m unittest discover -s scripts -p 'test_*.py'
```
`main` に push すると GitHub Actions がテストしてから GitHub Pages に公開します。
