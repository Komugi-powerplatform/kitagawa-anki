# KitagawaAnki todo

計画: ~/.claude/plans/foamy-doodling-scone.md

## 受入基準
- [x] 新規カードで もう一度=1分 / 普通=10分 / 簡単=日単位（tests/scheduler.test.ts）
- [x] 保存→読み戻しで続きから計算できる（JSON の日時を Date に戻す）
- [x] 期限順の出題・1日の新規上限・朝4時区切り（tests/queue.test.ts）
- [x] Anki から書き出した31枚を取り込める・2回目は重複しない・壊れたファイルは拒否（tests/backup.test.ts, E2E）
- [x] 追加・編集・削除（E2E）
- [x] 再読み込み後も記録が残る・オフラインで開ける（E2E）
- [x] GitHub Pages に公開して URL で開ける（本番 URL で E2E 全項目パス・2026-11-15）
- [ ] iPhone で「ホーム画面に追加」→ 取り込み（本人の操作）

## メモ
- ts-fsrs 6.0.0 は新 API（DefaultScheduler / newCard / preview / review）。カードの日時は dueAt / lastReviewAt
- package の engines は Node 24 以上だが、Node 22.23.2 でもテストは通った。CI は Node 24
- npm audit の指摘6件はビルド用の依存（vite-plugin-pwa → workbox-build）のみ。配信物には入らない
- iCloud Drive がこの Mac で無効だったため、取り込み用 JSON は Gmail で本人宛に送付（2026-11-15）

## 結果（2026-11-15）
- Vitest 24件・Python 2件・型チェック・ビルド・E2E（ローカル／本番）すべてパス
- 公開: https://komugi-powerplatform.github.io/kitagawa-anki/

## 敵対検証の指摘への対応（2026-11-15）
- [x] 答えの表示状態がアプリ切り替えで別のカードに持ち越される → 表示中のカード ID で持つ
- [x] 復習カードが期日の時刻まで出ない → 復習カードは日単位（朝4時区切り）で判定（tests/queue.test.ts）
- [x] 取り消し（直前50回まで・セッション内）
- [x] バックアップは確認してから置き換える・件数を正しく表示
- [x] 保存失敗（容量オーバー）を知らせ、反映しない
- [x] 長い答えがボタン帯に隠れる → 復習画面の下余白を拡大
- [x] カードのタップで答えを出す
- [x] 最後のカードを消すと空のデッキも消す・回答記録は残す（新規枠が戻らない）（tests/backup.test.ts）
- 未対応（使い方次第）: 復習中の編集・保留、一覧の検索、デッキ名変更、復習の上限、統計、画像・音声・穴埋め・逆向き、端末間の同期

## 第2弾: 本家にある機能（2026-11-16）
計画: ~/.claude/plans/foamy-doodling-scone.md（統計・画像音声・同期は対象外とユーザーが指定）
- [x] データを version 2（ノート＋カード）に。第1弾のデータは読み込み時に移行し、カードID・出題予定・記録を保持（tests/migrate.test.ts, E2E A）
- [x] 逆向きカード・穴埋め（{{c1::答え::ヒント}}）（tests/note.test.ts, E2E B〜E）
- [x] 復習中の編集・保留・停止（取り消し可）（E2E F〜H）
- [x] 一覧の検索・デッキと状態で絞り込み（E2E I）
- [x] デッキの名前変更・削除・デッキごとの1日の新規/復習上限（tests/queue.test.ts, E2E J）
- [x] 先出し中のヘッダー件数が 0 0 0 になる表示を修正
- [x] リーチ: 8回忘れたら自動で停止＋印、再開後は4回ごとに再停止（tests/leech.test.ts, E2E leech）（2026-11-16）
- [x] 画面の描画で例外が出たら、黙って止まらずに原因と「ホームへ」を出す
