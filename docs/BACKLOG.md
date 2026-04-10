# バックログ

最終更新: 2026-04-10

---

## NOW（次のセッションでやるべき）

### CTA挿入強化（feature/cta-plugin-update）
- [x] **Phase A**: `buildCtaBlockComment` に `version: "2"` 付与（B-lazy方式：URL解決はプラグイン会社データ層に委譲）
- [ ] **Phase A 動作確認**: `clasp push` → 既存承認フローで記事1〜2本に挿入 → V2デザインで描画されることをWPフロントで確認
- [ ] **Phase B**: `cta_diagnosis_master` シート新設（永続台帳。全2000記事 × PV閾値30 × snapshot差分検出）
  - `clasp/cta_diagnosis_master.js` 新規作成
  - `clasp/main.js` に `runWeeklyScoring()` 追加、`TOP_N_ARTICLES` 撤廃
- [ ] **Phase C**: `runDiagnosisBatch()` レジューム式バッチ化。台帳ベースで status=未診断/要再診断 を順次処理
- [ ] **Phase D**: `cta_insertion_plan` シートにフィルタUI追加（カテゴリ別/スコア順/ステータス別）

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
- [ ] **Phase E**: 結論ボックス・比較表ブロック対応（CVR診断プロンプト改修＋block builder拡張が必要、独立タスク）
- [ ] CVR診断プロンプトに「ブロック種別判定（inline/conclusion/comparison）」を追加

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
