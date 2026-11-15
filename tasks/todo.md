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
