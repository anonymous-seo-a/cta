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
