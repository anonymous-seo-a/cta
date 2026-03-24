# 開発ログ

## 2026-03-24 初回実装

### 実装の流れ

#### Step 1: CTA判断基準の言語化
- Daikiの直感・経験ベースでは「悪いCTAの例」が少ない（購買意欲の高いKWで上位表示するスタイルのためCVR改善経験が少ない）
- → フレームワーク提示 → Daikiが「合ってる/違う」で判定する方式に変更
- 12項目のCTA判断基準を確定

**確定した12項目:**
1. 文脈CTA欠如
2. CTA空白地帯
3. 意思決定直後のCTA欠如
4. 購買ピーク無視
5. 検索意図とCTA訴求の不一致
6. マイクロコピー不足（CTAボタン文言「詳細はこちら」はレギュレーション固定）
7. 差別化要素の弱さ
8. 文脈と推し案件の属性不一致
9. CTAボックスの視認性不足
10. ボタン周辺の後押し不足
11. 途中離脱対策の欠如
12. 比較導線の断絶

**レギュレーション制約:** CTAボタンの文言は「詳細はこちら」で固定。マイクロコピーで補強する方針。

#### Step 2: GA4 × GSC データ取得スクリプト
- GA4 Data API + GSC Search Analytics API をGASから呼び出し
- GA4プロパティID: 516785717
- GSCサイトURL: https://www.soico.jp/no1/

**発生した問題と対処:**

| 問題 | 原因 | 対処 |
|---|---|---|
| GA4 403エラー | GASアカウントにGA4アクセス権なし | GA4管理画面で閲覧者権限を付与 |
| GSC 403エラー | OAuthスコープ不足 | appsscript.jsonに`webmasters.readonly`追加 |
| GA4 affiliate_click 0件 | `customEvent:page_url`にデータなし | `pageLocation`（ビルトインディメンション）に変更 |
| URLに`?gtm_debug=`残る | normalizeUrlでクエリ未除去 | 正規表現ベースのnormalizeUrlに書き換え |

**スコアリング計算式:**
```
改善スコア = （GSCクリック数 × 順位補正係数） ÷ （affiliate_click数 + 1）
順位補正: 1〜3位=1.0、4〜10位=0.7、11位以降=0.3
```

#### Step 3: Claude API診断
- 12項目判断基準をシステムプロンプトに組み込み
- Plan A（保守的）/ Plan B（積極的）/ Plan C（構造変更）の3パターン生成
- JSON出力形式

**発生した問題と対処:**

| 問題 | 原因 | 対処 |
|---|---|---|
| GAS 6分タイムアウト | 10記事×50秒≒8分 | 5分制限バッチ処理に変更。診断済みフラグで再開可能 |
| scrapeCtaStructure未定義 | main.gsの差し替え時に関数が消えた | main.gs完全版を再作成 |
| runDiagnosisが2つ定義 | 修正時に旧版が残った | main.gs完全版で統合 |

#### Step 4: 週次トリガー設定
- 月曜 9:00-10:00: runWeeklyReport
- 月曜 10:00-11:00: runDiagnosis（1回目）
- 月曜 11:00-12:00: runDiagnosis（2回目・残り分）

#### Step 5: プロンプト精度向上（フィードバック反映）

**Daikiからのフィードバック:**

1. 冒頭固定CTAの比較表への指摘は不要（プラグイン共通テンプレートなので記事単位で変更不可）
2. 提携していない案件のCTAを提案されても実装できない
3. 存在しないCTAテンプレート形式を提案されても実装できない

**対処: 3つの制約を追加**

- **制約A:** 固定CTA（冒頭結論ボックス、プラグイン共通比較表）は診断対象外
- **制約B:** 提携済み案件リストを動的に渡し、未提携案件には`requires_partnership: true`フラグ
- **制約C:** 利用可能なCTAテンプレート（単品CTAボックス・テキストリンク）を明示。新形式には`requires_new_template: true`フラグ

**提携済み案件リストの動的取得:**
- ThirstyAffiliates REST API: `https://www.soico.jp/no1/wp-json/wp/v2/thirstylink?per_page=100`
- ページネーション対応で全186件取得
- 記事カテゴリに応じて関連案件のみをプロンプトに渡す（トークン効率）

**追加機能:**
- `detectArticleCategory(url)`: 記事URLからカテゴリ自動判定
- `formatPartnerListForPrompt(partnerList, articleCategory)`: カテゴリフィルタ付き案件リスト
- 未提携案件の検出・提携推奨（`partnership_recommendations`フィールド）

**対象カテゴリのフィルタリング:**
- cardloan, fx, cryptocurrency, securities, creditcard のみを診断対象
- hiring等の非金融カテゴリを除外（`isTargetCategory()`関数追加）

#### CTA自動挿入の実装

**WordPress REST API認証:**
- Application Password方式
- ユーザー名: futaa0521@gmail.com
- Script Propertiesに保存（コードに直書きしない）

**CTAプラグイン（soico-securities-cta）の構造確認:**
- 3カテゴリ対応: 証券（5ブロック）、カードローン（5ブロック）、暗号資産（5ブロック）
- FX・クレジットカードは未対応（FXはパターンブロックで別管理）
- Gutenbergブロック形式: `<!-- wp:soico-cta/crypto-inline-cta {"exchange":"bitflyer"} /-->`

**挿入位置の問題と修正:**

| バージョン | 挿入位置 | 問題 |
|---|---|---|
| v1 | h2見出しタグの直後 | セクション冒頭に入り不自然 |
| v2 | 次のh2のstartPosition直前 | 再利用ブロック(wp:block ref)の後に入ることがある |
| v3（最終） | セクション内の最後のコンテンツブロック直後 | ✅ 本文最後の段落の直後。CVR最適 |

**v3の挿入位置ロジック（`findOptimalInsertPosition`）:**
1. 対象見出しから次の同レベル以上見出しまでの範囲を特定
2. 範囲内のコンテンツブロック（paragraph/html/quote/list等）の終了位置を探索
3. 最後のコンテンツブロック終了直後を挿入位置とする
4. wp:block（再利用ブロック）やsoico-cta（既存CTA）の前に入る

**見出しマッチングの問題と修正:**

| 問題 | 原因 | 対処 |
|---|---|---|
| 全件「見出し不一致」 | Claudeが生成するlocation（「MEXCの基本情報セクション直後」）と実際の見出し（「MEXCとは？海外取引所の基本情報」）が不一致 | 制約D追加: locationに記事内の正確な見出しテキストを使用させる |
| キーワード分割が粗い | 日本語助詞で分割していなかった | 助詞（の/を/に/は/が/と/で）で分割するよう改善 |

**制約D（プロンプトに追加）:**
> locationフィールドには、【記事のCTA構造】データ内のheadingsに含まれるtextをそのまま引用すること。要約・言い換え・省略は禁止。

**重複CTA検知（`detectExistingCtaNearPosition`）:**
- 挿入位置の前500文字以内にsoico-ctaブロックまたはThirstyAffiliatesリンクが存在する場合
- ステータスを「CTA既存（crypto-inline-cta:bitflyer）」に設定しスキップ

**スラッグマッピング:**
- ThirstyAffiliatesのslug（例: `gmo-coin`）→ プラグイン内部slug（例: `gmo_coin`）
- `PARTNER_SLUG_MAP` オブジェクトで変換
- マッピングにないslugはハイフン→アンダースコア変換で対応

---

## 未実装・今後の予定

### SEOリライト（次フェーズ）
- Google Custom Search JSON API で競合上位5記事のURLを取得（無料枠: 100クエリ/日）
- 競合記事をスクレイプし、自サイト記事との構成・情報の過不足を検出
- Claude APIでリライト案を生成
- WordPress REST APIで記事を更新（承認フロー付き）

### FX/クレジットカード対応
- FX: パターンブロックで管理されている。挿入ロジックの調整が必要
- クレジットカード: CTAブロック自体の新規開発が必要

### CTA挿入の自動化
- `generateCtaInsertionPlan` の週次トリガー追加
- 承認フローのSlack/LINE通知

### appsscript.json

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "AnalyticsData",
        "version": "v1beta",
        "serviceId": "analyticsdata"
      }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/webmasters.readonly"
  ]
}
```
