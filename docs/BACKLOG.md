# バックログ

最終更新: 2026-04-10

---

## NOW（次のセッションでやるべき）

### CTA挿入強化（feature/cta-plugin-update）
- [x] **Phase A**: `buildCtaBlockComment` に `version: "2"` 付与 + S1-S3（挿入位置増加施策）
- [x] **Phase A 動作確認**: V2デザイン描画OK
- [x] **Phase A2**: CTA Gap Fill 機能（CTA空白セクション自動検出 + Claude intent判定 + ラウンドロビン配分）
  - `clasp/cta_gap_fill.js` 新規作成
  - `prompts/gap_fill_prompt.md` 新規作成
  - PARTNER_SLUG_MAP に不足slug追加、applyApprovedInsertions をシート名パラメータ化
- [x] **Phase A2 動作確認**: テスト3記事OK
- [x] **Phase B**: `cta_diagnosis_master` 永続台帳（2400記事投入済み、list_posts.php DB直接アクセスで高速化）
- [x] **Gap Fill 全記事拡張**: 台帳ベースのレジューム式 Gap Fill（`runGapFillBatch()`）
  - 台帳の gapFillStatus で実行済み/未実行を追跡
  - score 降順で処理、PV不足記事は自動スキップ
  - `cta_gap_fill_plan` シートに追記式で出力（バッチ実行で前回結果を保持）
- [ ] **Gap Fill 本番運用**: `runGapFillBatch` を5分間隔トリガーで実行 → 全記事処理完了まで自動継続
- [ ] **週次スコアリング トリガー設定**: `runWeeklyScoring` を週1回（月曜朝）に設定

---

## NEXT（1〜3セッション以内）

### サイトパフォーマンス
- [ ] Slick → Splide カルーセル移行
- [ ] CF7 / reCAPTCHA 条件付き読み込み（フォームページ以外で除外）

### SEOリライト機能の完成（注釈処理凍結解除後）
- [ ] 注釈処理の全文一括テスト（テスト記事14618で実行、commit 1c7ead6の検証）※**凍結中**
- [ ] 注釈テスト通過後、カードローン記事2〜3本でStep 1→4のフルフロー実行
- [ ] master_annotationsの他カテゴリ拡張（証券・暗号資産・FX）
- [ ] master_rulesの他カテゴリ拡充（クライアントレギュレーション受領後）

---

## LATER（必要だが急がない）

### CTA挿入拡張
- [ ] **Phase C**: runDiagnosisBatch レジューム式診断バッチ（マイクロコピー品質改善フェーズで復活。Gap Fillで代替済みのため当面不要）
- [ ] **Phase D**: フィルタUI（カテゴリ別/スコア順/ステータス別）
- [ ] **Phase E**: 結論ボックス・比較表ブロック対応（CVR診断プロンプト改修＋block builder拡張が必要、独立タスク）
- [ ] CVR診断プロンプトに「ブロック種別判定（inline/conclusion/comparison）」を追加
- [ ] soico-securities-cta に `/wp-json/soico-cta/v1/priorities` REST endpoint 追加（Gap Fill の partner 優先順位を動的取得）
- [ ] Microsoft Clarity 連携（ヒートマップ/スクロールデータを Gap Fill の intent 判定に注入、精度向上）

### SEOリライト拡張
- [ ] FXカテゴリのリライト対応
- [ ] 証券カテゴリのリライト対応
- [ ] リライト品質のA/Bテスト設計（GSCデータでbefore/after比較）

### サイトパフォーマンス
- [ ] Google Fonts 重複読み込み解消
- [ ] GTM 2コンテナ統合（GTM-M68ZMLP8 + GTM-N7V977XN）
- [ ] preconnect ディレクティブ追加（CDN、フォント、API等）
- [ ] wp-polyfill 除去

### 計測基盤
- [ ] ASPサブID計測の実装（ThirstyAffiliatesリダイレクトにsub_id付与）
- [ ] GA4×ASP CVデータの突合GAS（記事×商材別CVR算出）

### アーキテクチャ
- [ ] GAS → clasp ローカル管理への移行検討
- [ ] GAS 5分制限の回避策の体系化（現在: rewrite_progressシート再開方式）

---

## BLOCKED（他者依存で止まっている）

- [ ] Cloudflare CDN nameserver変更 → SOICOドメイン管理者に依頼必要
- [ ] master_specs（商材スペックデータ）→ エンジニアからのデータ回収待ち
- [ ] master_rulesの他カテゴリ → クライアントレギュレーション受領待ち

---

## DONE（完了済み。月1回アーカイブ）

- [x] Phase B: cta_diagnosis_master 永続台帳 + list_posts.php DB直接アクセ�� (2026-04-10)
- [x] Phase A2: CTA Gap Fill 機能（Claude intent判定 + 文脈マイクロコピー生成）(2026-04-10)
- [x] Phase A + S1-S3: V2対応 + 挿入位置増加施策 (2026-04-10)
- [x] Phase A: `buildCtaBlockComment` に `version: "2"` 付与（B-lazy方式） (2026-04-10)
- [x] clasp環境構築完了 + GASファイルを clasp/ に移行 (2026-04-01, 6c65895)
- [x] 注釈処理 セクション単位→全文一括処理に変更 (2026-03-27, 1c7ead6)
- [x] 注釈マスターデータシステム構築 annotation_master.gs (2026-03-26)
- [x] SEOリライト Step 1-4 パイプライン構築 (2026-03-25〜27)
- [x] カテゴリ均等選定（ラウンドロビン）実装 (2026-03-27)
- [x] Indexing API通知実装 (2026-03-27)
- [x] CTA自動挿入 完成・運用中 (2026-03-24)
- [x] CVR診断 完成・運用中 (2026-03-24)
- [x] gsc_master.gs GSCデータ一元管理 (2026-03-25)
- [x] LCP最適化（FV画像WebP化、FontAwesome除去、block-library CSS削減、preload追加）(2026-03)

---

## 運用ルール

1. セッション開始時: NOWを確認してから作業開始
2. セッション終了時: 完了タスクをDONEに移動、次にやるべきことをNOWに設定、commit
3. NOWは常に1〜2項目。多すぎたらNEXTに戻す
4. BLOCKEDが解除されたらNEXTに移動
