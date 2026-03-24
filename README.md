# soico CVR改善 AI自動化システム

soico（金融アフィリエイトメディア）のCVR改善を自動化するシステム。
GA4/GSCデータに基づくCVR診断 → CTA自動挿入 → 承認フロー → WordPress反映を一気通貫で実行する。

## システム構成

```
GSC（検索データ）  GA4（クリックデータ）  ThirstyAffiliates（提携案件）
       ↓                    ↓                        ↓
       └────── GAS（データ取得・統合・スコアリング） ──────┘
                            ↓
              Claude API（CVR診断・改善案生成）
                            ↓
              Google Spreadsheet（週次レポート + 挿入計画）
                            ↓
              Daikiが確認・承認（判断のみ）
                            ↓
              WordPress REST API（CTA自動挿入）
```

## ディレクトリ構成

```
.
├── gas/                    # Google Apps Script
│   ├── main.gs             # メインスクリプト（データ取得・診断・週次レポート）
│   └── cta_insertion.gs    # CTA挿入スクリプト（計画生成・承認・WordPress反映）
├── prompts/                # Claude APIプロンプト
│   ├── cvr_diagnosis_prompt_v1.md    # 初期版（12項目判断基準）
│   └── buildSystemPrompt_latest.gs  # 最新版（制約A/B/C/D + 提携案件動的注入）
├── docs/                   # ドキュメント
│   ├── setup_guide.md      # API有効化・GAS初期セットアップ手順
│   ├── development_log.md  # 開発ログ（全変更履歴）
│   └── architecture.md     # システムアーキテクチャ詳細
├── wordpress-plugin/       # CTAプラグイン参照（soico-securities-cta）
└── README.md
```

## 対応カテゴリ

| カテゴリ | CVR診断 | CTA挿入 | CTAブロック |
|---|---|---|---|
| カードローン | ✅ | ✅ | soico-cta/cardloan-* |
| 暗号資産 | ✅ | ✅ | soico-cta/crypto-* |
| 証券 | ✅ | ✅ | soico-cta/* |
| FX | ✅ | ❌（ブロック未対応） | パターンブロックで別管理 |
| クレジットカード | ✅ | ❌（ブロック未対応） | 未実装 |

## GASの主要関数

### main.gs

| 関数 | 用途 | 実行タイミング |
|---|---|---|
| `runWeeklyReport` | GA4/GSCデータ取得→スコアリング→Spreadsheet出力 | 毎週月曜 9:00（自動） |
| `runDiagnosis` | 上位10記事をClaude APIで診断→Spreadsheet書き込み | 毎週月曜 10:00, 11:00（自動、5分制限バッチ） |
| `fetchAllThirstyLinks` | 提携済み案件をWP REST APIから全件取得 | runDiagnosis内で自動呼び出し |

### cta_insertion.gs

| 関数 | 用途 | 実行タイミング |
|---|---|---|
| `generateCtaInsertionPlan` | 診断結果Plan Aから挿入計画を生成→Spreadsheet出力 | 手動（診断完了後） |
| `applyApprovedInsertions` | 承認済みのCTAをWordPressに挿入 | 手動（承認後） |

## 運用フロー

### 週次（自動）
1. 月曜 9:00: `runWeeklyReport` → GA4/GSCデータ取得、スコアリング、上位10記事抽出
2. 月曜 10:00-12:00: `runDiagnosis` × 2回 → Claude API診断、Spreadsheet書き込み

### 手動（承認フロー）
3. Daikiが `weekly_*` シートの診断結果を確認
4. `generateCtaInsertionPlan` を実行 → `cta_insertion_plan` シート生成
5. 挿入計画を確認、問題なければJ列を「承認」に変更
6. `applyApprovedInsertions` を実行 → WordPressに反映

## Script Properties（GAS）

| キー | 値 | 用途 |
|---|---|---|
| `CLAUDE_API_KEY` | Anthropic APIキー | Claude API診断 |
| `WP_USERNAME` | WordPressユーザー名 | WordPress REST API認証 |
| `WP_APP_PASSWORD` | Application Password | WordPress REST API認証 |

## 技術スタック

- **実行環境**: Google Apps Script
- **データソース**: GA4 Data API, GSC Search Analytics API, ThirstyAffiliates REST API
- **AI診断**: Claude API (claude-sonnet-4-20250514)
- **CMS**: WordPress + Gutenbergブロック + soico-securities-ctaプラグイン
- **出力**: Google Spreadsheet
