# soico CVR改善・SEOリライト AI自動化システム

soico（金融アフィリエイトメディア soico.jp/no1/）のCVR改善とSEO順位改善を自動化するシステム。
3つの独立した機能が連携して動作する。

## 3つの機能と進捗状況

| # | 機能 | 状態 | GASファイル | 概要 |
|---|---|---|---|---|
| 1 | **CVR診断** | ✅ 完了・運用中 | main.gs | GA4/GSCデータ→Claude API診断→週次レポート |
| 2 | **CTA自動挿入** | ✅ 完了・運用中 | cta_insertion.gs | 診断結果→CTA挿入計画→承認→WordPress反映 |
| 3 | **SEOリライト** | 🔧 Phase 2完了 | seo_rewrite.gs | 競合分析→リライト案→マークアップ生成→承認→入稿 |

共通基盤: **gsc_master.gs**（GSCデータ一元管理、日次バッチ）

---

## 機能1: CVR診断 ✅ 完了

GA4のアフィリエイトクリック数とGSCの検索データを組み合わせ、CVR改善余地が大きい記事を自動診断する。

### フロー
```
GSC + GA4 → スコアリング → 上位10記事抽出
    ↓
Claude API（12項目診断 + CTA挿入提案）
    ↓
weekly_* シートに結果出力
```

### 主要関数（main.gs）
| 関数 | 用途 | 実行 |
|---|---|---|
| `runWeeklyReport` | データ取得→スコアリング→Spreadsheet出力 | 毎週月曜9:00（自動） |
| `runDiagnosis` | Claude API診断→結果書き込み | 毎週月曜10:00-12:00（自動） |
| `fetchAllThirstyLinks` | 提携案件をWP REST APIから取得 | runDiagnosis内で自動呼び出し |

### 診断プロンプトの制約
- 制約A: 固定CTA除外
- 制約B: 提携済み案件を動的注入（ThirstyAffiliates REST API、186件+）
- 制約C: CTAテンプレート制約明示
- 制約D: locationに正確な見出しテキスト使用

---

## 機能2: CTA自動挿入 ✅ 完了

CVR診断のPlan A（CTA挿入提案）をもとに、Gutenbergブロック形式のCTAをWordPressに自動挿入する。

### フロー
```
CVR診断結果（Plan A）
    ↓
generateCtaInsertionPlan → cta_insertion_plan シート
    ↓
Daikiが確認 → J列を「承認」に変更
    ↓
applyApprovedInsertions → WordPress反映（公開状態維持）
```

### 主要関数（cta_insertion.gs）
| 関数 | 用途 | 実行 |
|---|---|---|
| `generateCtaInsertionPlan` | 診断結果から挿入計画を生成 | 手動 |
| `applyApprovedInsertions` | 承認済みCTAをWordPressに挿入 | 手動 |

### CTAプラグインブロック（soico-securities-cta）
| カテゴリ | ブロック | 状態 |
|---|---|---|
| カードローン | cardloan-conclusion-box, inline-cta, comparison-table, cv-box, cv-button | ✅ |
| 暗号資産 | crypto-conclusion-box, inline-cta, comparison-table, cv-box, cv-button | ✅ |
| 証券 | securities-conclusion-box, inline-cta, comparison-table, cv-box, cv-button | ✅ |
| FX | パターンブロックで別管理 | ❌ 未対応 |
| クレジットカード | 未実装 | ❌ 未対応 |

### 技術詳細
- Gutenbergブロック形式: `<!-- wp:soico-cta/crypto-inline-cta {"exchange":"bitflyer"} /-->`
- 見出しマッチング: 日本語助詞分割 + ベストマッチスコアリング
- 重複CTA検知: 挿入位置前500文字以内にsoico-ctaブロックまたはThirstyAffiliatesリンク検出
- スラッグマッピング: ThirstyAffiliatesスラッグ→プラグイン内部スラッグ変換

---

## 機能3: SEOリライト 🔧 開発中

gsc_masterから順位4-20位の改善余地がある記事を選定し、Yahoo検索で競合分析、Claude APIでリライト案を生成。最終的にGutenbergマークアップを出力して入稿する。

### 全体フロー
```
gsc_masterシート（日次更新）
    ↓
Phase 1: 候補選定 → Yahoo検索で競合URL取得（時間分散）     ✅ 完了
    ↓
Phase 2: 自サイト+競合スクレイプ → Claude APIリライト案生成  ✅ 完了
    ↓
Phase 2.5: Gutenbergマークアップ生成 → Spreadsheet出力       ← 次のタスク
    ↓
人間がSpreadsheetのマークアップをWPエディタに貼り付けて確認
    ↓
Phase 3: 承認済みマークアップを自動入稿                      未実装
```

### 主要関数（seo_rewrite.gs）
| 関数 | 用途 | 実行 |
|---|---|---|
| `runRewritePhase1` | 候補選定 + Yahoo検索で競合URL取得 | 手動 |
| `runRewritePhase2` | 競合分析 + Claude APIリライト案生成（1記事/実行） | 手動 |
| `applyApprovedRewrites` | 承認済みリライトをWordPress反映 | 手動（Phase 3） |

### 主要関数（gsc_master.gs）
| 関数 | 用途 | 実行 |
|---|---|---|
| `refreshGscMaster` | 全記事のGSCデータ+トップ10KWをシートに保存 | 日次6:00（自動） |
| `getRewriteCandidates` | 順位4-20位のリライト候補を取得 | Phase 1内で呼び出し |
| `readGscMaster` | gsc_masterシートからデータ読み取り | 各機能から参照 |

### 技術詳細
- Yahoo検索スクレイプ: 時間分散（15-30秒待機）、User-Agentローテーション（5種類）
- Bot対策サイト除外: SKIP_DOMAINS（bitflyer, coincheck, gmo等16ドメイン）
- 競合フォールバック: 5件の競合URLから順番に試行し2件成功するまで継続
- 1記事/実行制限（GAS 5分制限対策）
- rewrite_plan/rewrite_*シートに追記モードで出力

---

## ディレクトリ構成

```
.
├── gas/
│   ├── main.gs              # 機能1: CVR診断
│   ├── cta_insertion.gs     # 機能2: CTA挿入
│   ├── gsc_master.gs        # 共通: GSCデータ一元管理
│   ├── seo_rewrite.gs       # 機能3: SEOリライト
│   └── appsscript.json      # OAuthスコープ設定
├── prompts/
│   ├── cvr_diagnosis_prompt_v1.md
│   └── buildSystemPrompt_latest.gs
├── docs/
│   ├── setup_guide.md
│   ├── development_log.md
│   └── architecture.md
└── README.md
```

## Script Properties（GAS）

| キー | 用途 |
|---|---|
| `CLAUDE_API_KEY` | Claude API（診断・リライト） |
| `WP_USERNAME` | WordPress REST API認証 |
| `WP_APP_PASSWORD` | WordPress REST API認証 |

## 対象カテゴリ

cardloan, fx, cryptocurrency, securities, creditcard の5カテゴリ。
CTA挿入は3カテゴリ（cardloan, cryptocurrency, securities）のみ対応。

## 技術スタック

- **実行環境**: Google Apps Script
- **データソース**: GA4 Data API, GSC Search Analytics API, ThirstyAffiliates REST API, Yahoo検索
- **AI**: Claude API (claude-sonnet-4-20250514)
- **CMS**: WordPress + Gutenbergブロック + soico-securities-ctaプラグイン
- **出力**: Google Spreadsheet
