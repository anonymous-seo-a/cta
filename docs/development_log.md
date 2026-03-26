# 開発ログ

## 2026-03-26: Session 4

### 機能3: SEOリライト — テスト実行＋注釈マスターデータ＋バグ修正

**テスト実行結果:**
- Step 2（runRewritePhase2）: 成功。rewrite_designシートに設計書出力（ペルソナ・検索意図・セクション計画）
- Step 3（runRewriteStep3）: 15セクションの記事を3回の実行で全セクション処理完了。Google Drive保存も成功

**新規実装: 注釈マスターデータシステム（annotation_master.gs）**
- master_annotationsシート: 商材別必須注釈（カードローン4社15件）
- master_rulesシート: 禁止表現・必須表現・正式表記ルール（21件）
- 問題A（既存注釈を消さない）: プレースホルダー退避→復元方式
  - 形式: `[KEEP_ANNOTATION_xxx]`（`%%ANNOT_xxx%%`はClaude APIに壊されるため変更）
- 問題B（新規テキストに注釈を挿入）: 案C（Claude APIプロンプト注入＋ポスト処理検証）
  - Claude APIにmaster_annotations/rulesを渡してルール遵守を指示
  - 出力後にpostProcessAnnotationsで禁止表現削除・必須表現置換・不足注釈補完
  - スペック表パターンブロック内に※a/※p等の定義がある場合は記号参照のみ、なければインライン注釈

**解決したバグ:**
- MAX_TOKENS 4096不足 → 8192に増量＋切れたJSON修復処理（repairTruncatedJson）
- HTMLエンティティ（&amp;等）をClaude APIが「文字化け」と誤認 → decodeHtmlEntities関数追加
- GAS定数名衝突（STEP3_CONFIG重複）→ REWRITE_STEP3にリネーム
- GAS 5分タイムアウト → rewrite_progressシートによる再開可能設計
- Spreadsheetセル50,000文字制限 → Google Drive保存に変更
- Google Drive APIが未有効化 → GCPプロジェクトでDrive API有効化で解決
- プレースホルダー `%%ANNOT_xxx%%` がClaude APIで壊れる → `[KEEP_ANNOTATION_xxx]` に変更

**未完了・後日対応:**
- master_annotationsの他カテゴリ拡張（証券・暗号資産・FX）
- master_specs（商材スペック）: エンジニアからのデータ回収待ち
- master_rulesの拡充: 他カテゴリのクライアントレギュレーション受領後
- 生成された全文マークアップのWP表示確認
- カードローン記事での注釈処理の実動作検証

**GCPプロジェクト設定メモ:**
- プロジェクトID: 377655326123
- 有効化済みAPI: Analytics Data API, Search Console API, **Google Drive API**（Session 4で追加）

---

## 2026-03-25: Session 3

### 機能3: SEOリライト — 全面再設計

**問題点（旧設計）:**
- Phase 2の分析が見出し構造の比較止まり（ペルソナ・検索意図の分析がない）
- Phase 2.5の出力が断片パッチ（記事全文のマークアップが得られない）
- フローが冗長で中間成果物の確認ステップが不明確

**新設計（4ステップ）:**
- Step 1: 競合調査（既存Phase 1、変更なし）
- Step 2: リライト設計書の生成（Phase 2プロンプト大幅強化）
  - ペルソナ推定（KWからClaude APIが推定）
  - 検索意図分析
  - H2セクション単位の変更指示
  - 表現・言い回しの最適化指示
  - 古い情報の特定
  → rewrite_designシート出力、人間が確認・追加メモ→「承認」
- Step 3: セクション別リライト → 全文結合（seo_rewrite_markup.gs全面書き直し）
  - H2で記事を分割
  - セクションごとにClaude API呼び出し（設計書の指示+ペルソナ+デザインパターン）
  - CTA・再利用ブロックは一字一句保持
  - 全セクション結合 → rewrite_fulltextシートに全文出力
- Step 4: 全文確認 → WP入稿
  - Spreadsheetで全文マークアップを確認→「承認」→ WP REST API

**変更したファイル:**
- seo_rewrite.gs: buildRewriteSystemPrompt強化、writeRewriteDesignSheet新設、旧applyApprovedRewrites/applyRewriteToContent削除
- seo_rewrite_markup.gs: 全面書き直し（runRewriteStep3, applyApprovedFulltext, splitByH2等）

**次のタスク:**
- GASエディタにコピーしてStep 2（runRewritePhase2）のテスト実行
- rewrite_designシートの出力品質確認
- Step 3（runRewriteStep3）のテスト実行
- 全文マークアップのWP表示確認

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
