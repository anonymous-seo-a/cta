# 開発ログ

## 2026-03-25: Session 3

### 機能3: SEOリライト — Phase 2.5 実装

**完了した作業:**
- seo_rewrite_markup.gs 新設（Phase 2.5: Gutenbergマークアップ生成）
- `runRewritePhase25()`: rewrite_plan「承認待ち」→ WP rawコンテンツ取得 → Claude APIでGutenbergマークアップ生成 → rewrite_markup_*シート出力
- `applyApprovedMarkup()`: Phase 3改。rewrite_markup_*シートの「承認」行をWPに反映
- デザインパターンテンプレートをシステムプロンプトに組み込み（box-004/006/008、比較表、Q&A、ステップ、要約ボックス等）
- MAX_TOKENS 8192（rawコンテンツ＋分析結果を処理するため増量）

**設計ポイント:**
- 1記事/実行の制約を維持
- WPコンテンツは40,000文字上限で切り詰め
- CTAプラグインブロック・再利用ブロックは変更対象外
- 変更ごとに1行出力 → 人間が個別に承認/スキップ可能
- `replaceSectionContent()`: 見出し〜次の同レベル見出しまでのセクション置換

**次のタスク:**
- GASエディタにコピーしてテスト実行
- プロンプト品質の確認（生成されるマークアップがWPで正常表示されるか）
- 必要に応じてデザインパターンテンプレートの微調整

---

## 2026-03-25: Session 2

### 機能3: SEOリライト — Phase 1-2 完了

**完了した作業:**
- Google Custom Search API 403問題の調査 → Yahoo検索スクレイプに方針変更
- gsc_master.gs 新設（GSCデータ一元管理、日次バッチ。全機能がシート参照に統一）
- seo_rewrite.gs v5（Bot対策サイト除外、競合フォールバック、1記事/実行制限）
- Phase 1（候補選定 + Yahoo検索で競合URL取得）動作確認済み
- Phase 2（自サイト+競合スクレイプ → Claude APIリライト案生成）動作確認済み

**解決した技術課題:**
- GSC API page×query全組み合わせ取得でタイムアウト → gsc_masterシート参照に変更
- bitflyer.comスクレイプで6分間ハング → SKIP_DOMAINSで事前除外
- readGscMasterをループ内で毎回呼び出し → ループ外で1回だけ
- writeRewriteResultSheetが毎回シート作り直し → 追記モードに変更

**次のタスク:**
- Phase 2.5: Gutenbergマークアップ生成 → Spreadsheet出力
- Phase 3: 承認済みマークアップの自動入稿

### 機能1: CVR診断 / 機能2: CTA挿入 — 変更なし
前回セッションで完了済み。運用中。

---

## 2026-03-24: Session 1

### 機能1: CVR診断 — 完了 ✅
- main.gs: GA4×GSCデータ取得 → スコアリング → Claude API 12項目診断 → 週次レポート
- 制約A/B/C/D の全プロンプト改善完了
- 提携案件動的注入（ThirstyAffiliates REST API）
- カテゴリフィルタ: cardloan, fx, cryptocurrency, securities, creditcard
- 週次トリガー設定済み（月曜9:00-12:00）

### 機能2: CTA自動挿入 — 完了 ✅
- cta_insertion.gs: CVR診断結果 → CTA挿入計画 → 承認 → WordPress反映
- CTAプラグイン3カテゴリ対応（証券・カードローン・暗号資産、各5ブロック）
- 見出しマッチング + 重複CTA検知 + 承認フロー
- テスト成功確認済み（3カテゴリ）

### 機能3: SEOリライト — 基盤構築
- seo_rewrite.gs 初版: 3フェーズ構成の設計
- Google Custom Search API 設定（403問題が発生、Session 2で解決）

詳細: /mnt/transcripts/2026-03-24-09-52-16-soico-cvr-seo-automation-system.txt
