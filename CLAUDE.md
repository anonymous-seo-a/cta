# CLAUDE.md - soico CVR/SEO自動化システム

## プロジェクト概要

soico.jp/no1/（金融アフィリエイトメディア）のCVR改善とSEO順位改善を自動化するGoogle Apps Scriptシステム。

## 技術スタック

- **実行環境**: Google Apps Script（V8ランタイム）
- **外部API**: Claude API (claude-sonnet-4-6-20260312), WordPress REST API, GA4 Data API, GSC API, Google Drive API, Google Indexing API, ThirstyAffiliates REST API
- **データ**: Google Spreadsheet + Google Drive（大容量出力用）
- **CMS**: WordPress（Xserver、カスタムテーマ）
- **認証情報**: GAS Script Properties に格納（CLAUDE_API_KEY, WP_USERNAME, WP_APP_PASSWORD）

## ファイル構成

```
clasp/                    ← ★ GASファイルの正（clasp push でGASに反映）
  .clasp.json             - claspプロジェクト設定
  .claspignore            - push除外設定
  appsscript.json         - GASプロジェクト設定
  main.gs                 - CVR診断（機能1）+ 共通ユーティリティ
  cta_insertion.gs        - CTA自動挿入（機能2）
  seo_rewrite.gs          - SEOリライト Step 1-2（機能3前半）
  seo_rewrite_markup.gs   - SEOリライト Step 3-4（機能3後半）
  annotation_master.gs    - 注釈マスターデータ管理
  gsc_master.gs           - GSCデータ一元管理（日次バッチ）

gas/                      ← アーカイブ（clasp導入前のコピー。編集しない）

prompts/
  buildSystemPrompt_latest.gs - リライト用システムプロンプト
  cvr_diagnosis_prompt_v1.md  - CVR診断プロンプト

docs/
  BACKLOG.md              - 優先度付きタスク一覧（★毎セッション確認）
  SESSION_HANDOFF.md      - セッション引き継ぎ（★最初に読む）
  architecture.md         - システム設計 + 設計判断記録
  development_log.md      - セッション別の作業記録
  setup_dev_environment.md - 開発環境セットアップ手順
  setup_guide.md          - GAS環境構築手順
```

**重要: GASファイルの編集は必ず `clasp/` 内で行うこと。**
`gas/` ディレクトリは触らない。

## セッション開始手順

1. `docs/SESSION_HANDOFF.md` を読む
2. `docs/BACKLOG.md` の NOW を確認
3. 作業開始

## セッション終了手順

1. `docs/BACKLOG.md` 更新（完了→DONE、次→NOW）
2. `docs/SESSION_HANDOFF.md` 更新（状態・問題・次にやること）
3. 設計判断があれば `docs/architecture.md` に追記
4. 作業記録を `docs/development_log.md` に追記
5. git commit + push

## GAS固有の注意事項

- **clasp運用**: `clasp/` 内のファイルを編集 → `clasp push` でGASに反映。GASエディタでの直接編集は禁止
- **clasp push は全ファイル上書き**: GASエディタ側の手動変更は消える。ローカルが正
- **clasp pull**: GASエディタ側で緊急修正した場合のみ使用。pull後にgit commitすること
- **ビルドステップなし**: .gsファイルがそのまま実行される
- **5分実行制限**: 長時間処理はprogressシートで再開可能にする
- **セル50K文字制限**: 大きな出力はGoogle Driveに保存
- **スコープ衝突**: 全.gsファイルがグローバルスコープ。関数名・定数名の重複に注意

## Claude API呼び出しの制約

- system + user 合計 ~12K文字以内（MAX_TOKEN衝突回避）
- MAX_TOKENS: 8192（stop_reason: "max_tokens" で切れたら検知）
- プレースホルダー形式: `[KEEP_ANNOTATION_xxx]`（`%%` 系はClaude APIが壊す）
- モデル: claude-sonnet-4-6-20260312（デフォルト）

## コーディング規約

- 全変更は完全なファイル出力で提供（差分ではなくファイル全体）
- 関数の先頭にJSDocコメントで目的・引数・戻り値を記載
- Logger.log で処理ステップごとにログ出力（経過時間含む）
- エラーハンドリングは try/catch + Logger.log でスタックトレース出力
