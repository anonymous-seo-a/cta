# システムアーキテクチャ

## 全体フロー

```
┌─────────────────────────────────────────────────────────┐
│                    週次自動処理                           │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ GA4 Data │    │ GSC API  │    │ ThirstyAffiliates│   │
│  │   API    │    │          │    │    REST API      │   │
│  └────┬─────┘    └────┬─────┘    └────────┬─────────┘   │
│       │               │                   │             │
│       └───────┬───────┘                   │             │
│               ↓                           │             │
│  ┌────────────────────┐                   │             │
│  │   mergeAndScore    │                   │             │
│  │  (スコアリング)     │                   │             │
│  └─────────┬──────────┘                   │             │
│            ↓                              │             │
│  ┌────────────────────┐                   │             │
│  │  writeToSheet      │                   │             │
│  │ (上位10記事出力)    │                   │             │
│  └─────────┬──────────┘                   │             │
│            ↓                              ↓             │
│  ┌────────────────────────────────────────────────┐     │
│  │              Claude API診断                     │     │
│  │  ・12項目CTA判断基準                             │     │
│  │  ・提携済み案件リスト（カテゴリフィルタ済み）       │     │
│  │  ・制約A/B/C/D                                  │     │
│  │  → problems + plan_a/b/c + partnership_recs     │     │
│  └─────────┬──────────────────────────────────────┘     │
│            ↓                                            │
│  ┌────────────────────┐                                 │
│  │  Spreadsheet出力    │                                 │
│  │  (weekly_* シート)  │                                 │
│  └─────────────────────┘                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    手動承認フロー                         │
│                                                         │
│  ┌────────────────────┐                                 │
│  │ generateCtaInser-  │                                 │
│  │ tionPlan           │                                 │
│  │  ・Plan Aパース     │                                 │
│  │  ・見出しマッチング  │                                 │
│  │  ・重複CTA検知      │                                 │
│  │  ・スラッグマッピング│                                 │
│  └─────────┬──────────┘                                 │
│            ↓                                            │
│  ┌────────────────────┐                                 │
│  │ cta_insertion_plan │   Daikiが目視確認                │
│  │ シート              │ → J列を「承認」に変更            │
│  └─────────┬──────────┘                                 │
│            ↓                                            │
│  ┌────────────────────┐    ┌─────────────────┐          │
│  │ applyApproved-     │───→│ WordPress       │          │
│  │ Insertions         │    │ REST API        │          │
│  │  ・正確な挿入位置    │    │ (記事更新)       │          │
│  │  ・後ろから挿入      │    └─────────────────┘          │
│  └────────────────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

## CTA挿入位置ロジック（findOptimalInsertPosition）

```
h2 「MEXCとは？海外取引所の基本情報」
│
├── h3 「運営会社とサービス概要」
│   └── paragraph, paragraph, paragraph
│
├── h3 「取扱銘柄数と主な特徴」
│   └── paragraph, html(box), paragraph
│
├── h3 「金融庁未登録であることの意味」
│   └── paragraph, html(box), paragraph, quote, paragraph
│       └── ★ ここにCTAを挿入 ← セクション内最後のコンテンツブロック直後
│
├── <!-- wp:soico-cta/crypto-inline-cta {"exchange":"bitflyer"} /--> ← 既存CTA（重複検知対象）
│
h2 「MEXCの評判」 ← 次の同レベル見出し（セクション境界）
```

## CTA診断プロンプトの制約構造

```
制約A: 固定CTA除外
  └── 冒頭結論ボックス、プラグイン共通比較表は診断対象外

制約B: 提携済み案件リスト
  ├── ThirstyAffiliates REST APIから動的取得（186件+）
  ├── 記事カテゴリに応じてフィルタ（トークン効率）
  └── 未提携案件は requires_partnership: true

制約C: CTAテンプレート制約
  ├── 利用可能: 単品CTAボックス、テキストリンク
  └── 新形式提案は requires_new_template: true

制約D: locationの正確性
  └── 記事のCTA構造データのheadings内textをそのまま使用（要約禁止）
```

## SEOリライト全体フロー

```
┌─────────────────────────────────────────────────────────┐
│                  SEOリライトパイプライン                    │
│                                                         │
│  Phase 1: runRewritePhase1()                            │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │gsc_master│───→│  候補選定 │───→│ Yahoo検索で      │   │
│  │ シート    │    │（TOP 10） │    │ 競合URL取得      │   │
│  └──────────┘    └──────────┘    └────────┬─────────┘   │
│                                           ↓             │
│  Phase 2: runRewritePhase2()    competitor_cacheシート   │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │自サイト+競合      │───→│ Claude API       │           │
│  │スクレイプ         │    │ リライト分析      │           │
│  └──────────────────┘    └────────┬─────────┘           │
│                                   ↓                     │
│                    rewrite_*シート + rewrite_planシート   │
│                                   ↓                     │
│  Phase 2.5: runRewritePhase25()                         │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │WP REST API       │───→│ Claude API       │           │
│  │rawコンテンツ取得   │    │ Gutenbergマーク  │           │
│  │+ rewrite_*分析    │    │ アップ生成       │           │
│  └──────────────────┘    └────────┬─────────┘           │
│                                   ↓                     │
│                    rewrite_markup_*シート                 │
│                    （変更ごとに1行、承認待ち）             │
│                                   ↓                     │
│                    人間が目視確認 → 「承認」に変更         │
│                                   ↓                     │
│  Phase 3: applyApprovedMarkup()                         │
│  ┌──────────────────┐    ┌─────────────────┐           │
│  │承認済みマークアップ│───→│ WordPress       │           │
│  │をコンテンツに適用  │    │ REST API更新     │           │
│  └──────────────────┘    └─────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

## GAS Script Properties

| キー | 用途 | セキュリティ |
|---|---|---|
| CLAUDE_API_KEY | Claude API認証 | コードに直書き禁止 |
| WP_USERNAME | WordPress REST API認証 | コードに直書き禁止 |
| WP_APP_PASSWORD | WordPress REST API認証 | コードに直書き禁止 |

## GASトリガー設定

| 関数 | タイプ | 曜日 | 時刻 |
|---|---|---|---|
| runWeeklyReport | 週ベース | 月曜 | 9:00-10:00 |
| runDiagnosis (1回目) | 週ベース | 月曜 | 10:00-11:00 |
| runDiagnosis (2回目) | 週ベース | 月曜 | 11:00-12:00 |

## WordPress CTAブロック対応表

### soico-securities-ctaプラグイン

| カテゴリ | ブロック名 | 用途 |
|---|---|---|
| 証券 | conclusion-box | 結論ボックス（冒頭用） |
| 証券 | inline-cta | インラインCTA（記事中） |
| 証券 | single-button | CTAボタン |
| 証券 | comparison-table | 比較表 |
| 証券 | subtle-banner | テキストリンクバナー |
| カードローン | cardloan-conclusion-box | 結論ボックス |
| カードローン | cardloan-inline-cta | インラインCTA |
| カードローン | cardloan-single-button | CTAボタン |
| カードローン | cardloan-comparison-table | 比較表 |
| カードローン | cardloan-subtle-banner | テキストリンクバナー |
| 暗号資産 | crypto-conclusion-box | 結論ボックス |
| 暗号資産 | crypto-inline-cta | インラインCTA |
| 暗号資産 | crypto-single-button | CTAボタン |
| 暗号資産 | crypto-comparison-table | 比較表 |
| 暗号資産 | crypto-subtle-banner | テキストリンクバナー |

### CTA挿入で使用するブロック

自動挿入では `inline-cta` 系を使用:
- 証券: `<!-- wp:soico-cta/inline-cta {"company":"sbi","featureText":"..."} /-->`
- カードローン: `<!-- wp:soico-cta/cardloan-inline-cta {"company":"promise","featureText":"..."} /-->`
- 暗号資産: `<!-- wp:soico-cta/crypto-inline-cta {"exchange":"bitflyer","featureText":"..."} /-->`

### スラッグマッピング（ThirstyAffiliates → プラグイン内部）

ThirstyAffiliatesのslug（ハイフン区切り）とプラグイン内部slug（アンダースコア区切り）が異なる場合がある。
`PARTNER_SLUG_MAP` オブジェクトで変換。

例:
- `gmo-coin` → `gmo_coin`
- `sbivc-trade` → `sbi_vc`
- `bitflyer_checked` → `bitflyer`

---

## SEOリライトパイプライン（現行: 4ステップ構成）

※ 上部のフロー図（Phase 1/2/2.5/3）は旧設計。以下が現行設計。

```
Step 1: runRewritePhase1()
  gsc_masterシート → 候補選定(TOP 10) → Yahoo検索で競合URL取得
  → competitor_cacheシート

Step 2: runRewritePhase2()
  自サイト＋競合スクレイプ → Claude API（ペルソナ推定・検索意図分析・セクション計画）
  → rewrite_designシート → 人間が確認・追加メモ →「承認」

Step 3: runRewriteStep3()
  H2で記事分割 → セクション別Claude APIリライト
  → 全セクション結合 → 注釈一括処理（extract→postProcess→restore）
  → Google Drive保存 → rewrite_fulltextシート
  * GAS 5分制限対策: rewrite_progressシートで再開可能
  * セル50K文字制限対策: Google Drive保存

Step 4: applyApprovedFulltext()
  rewrite_fulltextシートで「承認」→ WP REST API入稿 → Indexing API通知
```

### 注釈処理フロー（全文一括方式、commit 1c7ead6〜）

```
セクション別リライト完了
  ↓
全セクション結合（fullText）
  ↓
extractAnnotationsToPlaceholders(fullText)
  → 出典リンク・記号定義行を [KEEP_ANNOTATION_xxx] に退避
  → 商材注釈は除去（後で統一挿入するため）
  ↓
postProcessAnnotations(抽出済みテキスト, masterAnnotations, symbolMap, masterRules)
  → 全トリガーKW出現箇所に注釈を統一挿入
  → 禁止表現削除・必須表現置換
  → スペック表内は記号参照（※a等）、それ以外はインライン注釈
  ↓
restoreAnnotationsFromPlaceholders()
  → 退避した出典リンク・記号定義行を復元
  ↓
Google Drive保存
```

---

## GAS実行環境の制約

| 制約 | 対策 |
|---|---|
| 5分実行タイムアウト | rewrite_progressシートによる再開可能設計 |
| セル50,000文字制限 | Google Drive API でファイル保存 |
| Claude API出力切れ | MAX_TOKENS 8192 + stop_reason検知 + repairTruncatedJson |
| プレースホルダー破壊 | `%%ANNOT%%` → `[KEEP_ANNOTATION_xxx]` に変更（Claude APIに壊されない形式） |
| Claude API入力上限 | system + user合計 ~12K文字以内（MAX_TOKEN衝突回避） |
| Google Drive API | GCPプロジェクトで明示的に有効化が必要（appsscript.jsonのスコープだけでは不十分） |

---

## 設計判断の記録

大きな設計変更の理由と代替案を記録する。移管や再設計時の参照用。

### 2026-03-27: 注釈処理をセクション単位→全文一括に変更
- **問題**: 「維持」セクション（再利用ブロック含有）にpostProcessが走らず、注釈が元記事のまま残る
- **代替案A**: 維持セクションにもpostProcessを走らせる → 再利用ブロック内の注釈が壊れるリスク
- **代替案B**: 維持セクション内の注釈だけ手動更新 → スケールしない
- **決定**: 全文結合後に1回だけextract→postProcess→restoreを実行
- **影響**: seo_rewrite_markup.gs のみ。annotation_master.gsの関数は変更不要

### 2026-03-26: プレースホルダー形式を `%%ANNOT%%` → `[KEEP_ANNOTATION_xxx]` に変更
- **問題**: `%%` 区切りがClaude APIの出力で壊される（`%` が消える、スペースが入る等）
- **決定**: `[KEEP_ANNOTATION_xxx]` 形式。角括弧＋英字はClaude APIが安定して保持する
- **根拠**: テスト5回中5回で保持を確認

### 2026-03-25: Google Custom Search API → Yahoo検索スクレイプ
- **問題**: GCSE APIが403エラー（プログラマティック検索の制限）
- **代替案**: Bing Search API → 月額コスト発生
- **決定**: Yahoo検索のHTML解析（無料、Bot対策サイトはSKIP_DOMAINSで事前除外）

### 2026-03-25: GSCデータ取得を各機能の個別呼び出し → gsc_master.gs 一元管理
- **問題**: 各機能がGSC APIを個別呼び出し → タイムアウト頻発
- **決定**: gsc_masterシートに日次バッチで蓄積。全機能がシート参照に統一
- **効果**: API呼び出し回数削減＋5分制限回避

### 2026-03-24: CVR診断プロンプトのイテレーション
- **問題**: 初版プロンプトが一般的なSEOアドバイスを出す（soicoの提携案件・CTA構造を無視）
- **決定**: 制約A/B/C/Dの4層構造で具体的な制約を注入
- **特にBが重要**: ThirstyAffiliates REST APIから提携案件リストを動的取得し、カテゴリフィルタしてプロンプトに注入
