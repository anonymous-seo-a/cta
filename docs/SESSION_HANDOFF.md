# セッション引き継ぎ

最終更新: 2026-04-10（CTA挿入強化フェーズ開始）

---

## 現在の状態

**SEOリライトの注釈処理は一旦凍結**。CTA挿入強化に方針転換。

`feature/cta-plugin-update` ブランチで作業中。Phase A（プラグイン v1.1.0 互換対応）のローカル実装完了、`clasp push` と動作確認待ち。

### 各機能のステータス
| 機能 | 状態 | 備考 |
|---|---|---|
| CVR診断 | ✅ 運用中 | 週次自動トリガー稼働中。Phase B〜Cで全記事対応に拡張予定 |
| CTA自動挿入 | 🔧 強化中 | Phase A 実装完了（version="2"付与）。Phase B〜D 進行予定 |
| SEOリライト | ⏸️ 凍結 | 注釈処理の検証が進まないため凍結。Phase B以降で再開検討 |
| gsc_master | ✅ 運用中 | 日次バッチ |

---

## CTA挿入強化の全体方針

### 背景
1. soico-securities-cta プラグインが v1.1.0 で V2 レンダラー + ThirstyAffiliates 上書き機能に対応（[plugin commit dd1dd73](https://github.com/DaikiNozawa/soico-securities-cta/commit/dd1dd73)）
2. 現状の CVR診断は `TOP_N_ARTICLES: 10` で上位10記事のみ対象。soico.jp/no1/ の全約2000記事を対象にしたい

### 仕様書
プラグインの全15ブロック・属性スキーマ・URL解決優先順位は **soico-securities-cta/docs/GAS_INTEGRATION_SPEC.md** に集約。GAS側からは v1.1.0 と V2 レンダラーを前提に出力する。

### Phase 構成

| Phase | 目的 | ステータス |
|---|---|---|
| **A** | プラグイン v1.1.0 互換対応（`buildCtaBlockComment` に `version: "2"` 付与） | ✅ ローカル実装完了、`clasp push` + 動作確認待ち |
| **B** | `cta_diagnosis_master` 永続台帳新設、全2000記事スコアリング、PV閾値30フィルタ、snapshot差分検出 | 未着手 |
| **C** | `runDiagnosisBatch()` レジューム式バッチ化（GAS 5分制約対応） | 未着手 |
| **D** | `cta_insertion_plan` シートにフィルタUI追加 | 未着手 |
| E (LATER) | 結論ボックス・比較表ブロック対応 | LATER |

### 仕様確定事項（Daikiと合意済み）
- **対象記事**: 全2000本（`TOP_N_ARTICLES` 撤廃）
- **PV閾値**: 月間PV ≤ 30 を除外
- **指標変化検出**: impressions/clicks/affiliate_clicks ±10%以上変動で再診断対象
- **バッチ実行**: GAS 5分制約のためレジューム式、複数日にまたがってOK
- **承認方式**: フィルタUI付きシートで1行ずつ目視承認（手動承認は維持）
- **既CTA記事**: 再診断対象
- **プラグイン属性**: `version: "2"` 必須付与、URL解決はプラグイン会社データ層に委譲（B-lazy方式）
- **ブロック種別**: `inline-cta` のみ（結論ボックス・比較表は LATER）

---

## 次セッションの最初にやること

### 1. Phase A 動作確認（最優先）
- `cd ~/Projects/cta/clasp && clasp push` で GAS に反映
- 既存承認フローで記事1〜2本を反映 → WPフロントで以下を確認:
  - V2デザイン（soico.jp ブルー #164C95 ベース）で描画されているか
  - リンク先がプラグイン管理画面の thirsty_link 経由 URL になっているか
  - エディタを開いた時にブロックエラーが出ないか（出ても保存に影響しなければOK）
- 問題なければ Phase A を `feature/cta-plugin-update` で push → mainへPR

### 2. Phase B 着手
- `clasp/cta_diagnosis_master.js` 新規作成（永続台帳CRUD、snapshotハッシュ計算、status遷移）
- `clasp/main.js` の `TOP_N_ARTICLES` 撤廃、`runWeeklyScoring()` 実装
- 台帳に2000件初回投入、PV閾値とsnapshot動作確認（診断はまだ走らせない）

### 3. 注釈処理の凍結について
- BACKLOG の NEXT セクションに「凍結中」と明記済み
- Phase B 完了後、必要なら凍結解除を検討

---

## 環境情報

| 項目 | 値 |
|---|---|
| GCP Project ID | 377655326123 |
| 有効化済みAPI | Analytics Data API, Search Console API, Google Drive API |
| テスト用WP Post ID（リライト） | 14618 |
| GitHub | anonymous-seo-a/cta (main / feature/cta-plugin-update) |
| プラグインリポジトリ | DaikiNozawa/soico-securities-cta v1.1.0 |
| プラグイン仕様書 | soico-securities-cta/docs/GAS_INTEGRATION_SPEC.md |
| 最新commit (main) | 6c65895 (clasp環境構築) |

---

## このファイルの更新ルール

- セッション終了時に必ず更新してcommit
- 「現在の状態」「Phase進捗」「次にやること」の3つを必ず書く
- 詳細な作業記録は `development_log.md` に書く（このファイルは引き継ぎに必要な最小限のみ）
