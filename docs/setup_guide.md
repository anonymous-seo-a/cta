# Step 2: GAS × GA4 Data API × GSC API データ取得

---

## Part 1: API有効化手順（初回のみ）

### 1-1. GASプロジェクトの作成
1. Google Spreadsheetを新規作成（名前: `soico_cvr_weekly_report`）
2. メニュー → 拡張機能 → Apps Script を開く

### 1-2. Google Cloud Projectとの紐付け
1. Apps Scriptエディタ左側 → ⚙ プロジェクトの設定
2. 「Google Cloud Platform（GCP）プロジェクト」セクション → 「プロジェクトを変更」
3. **GCPプロジェクトが既にある場合** → プロジェクト番号を入力
4. **GCPプロジェクトがない場合** → https://console.cloud.google.com/ で新規作成し、プロジェクト番号をコピーして入力

### 1-3. APIの有効化（GCPコンソール）
1. https://console.cloud.google.com/ を開く
2. 上部のプロジェクト選択で、紐付けたプロジェクトを選ぶ
3. 左メニュー → 「APIとサービス」→「ライブラリ」
4. 以下の2つを検索して有効化:
   - **Google Analytics Data API** （`analyticsdata.googleapis.com`）
   - **Google Search Console API** （`searchconsole.googleapis.com`）

### 1-4. Apps Scriptのサービス追加
1. Apps Scriptエディタ左側 → 「サービス」の横の「＋」
2. 以下を追加:
   - **Google Analytics Data API** → バージョン: v1beta → ID: `AnalyticsData`（デフォルト）
   - ※GSC APIはUrlFetchAppで直接叩くのでサービス追加不要

### 1-5. OAuth同意画面の設定（初回のみ）
1. GCPコンソール → APIとサービス → OAuth同意画面
2. User Type: 内部（Google Workspaceの場合）または外部
3. アプリ名・メールアドレスを入力して保存
4. スコープは自動で設定されるので操作不要

### 1-6. 動作確認
- Apps Scriptエディタで `testGA4Connection` を実行
- 初回実行時にOAuth認証ダイアログが出るので許可する
- ログにGA4のデータが表示されれば成功

---

## Part 2: GASスクリプト

以下を Apps Script エディタに貼り付ける。ファイル名は `main.gs` でよい。

```javascript
// ============================================================
// 設定
// ============================================================
const CONFIG = {
  GA4_PROPERTY_ID: '516785717',
  GSC_SITE_URL: 'https://www.soico.jp/no1/',
  DATE_RANGE_DAYS: 28,
  TOP_N_ARTICLES: 10,
  SHEET_NAME_PREFIX: 'weekly_',
  AFFILIATE_CLICK_EVENT: 'affiliate_click',
};

// ============================================================
// メイン処理
// ============================================================
function runWeeklyReport() {
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);

  // Step 1: GA4からaffiliate_clickデータ取得
  Logger.log('=== GA4データ取得開始 ===');
  const ga4Data = fetchGA4AffiliateClicks(dateRange);
  Logger.log(`GA4: ${Object.keys(ga4Data).length} 記事のクリックデータ取得`);

  // Step 2: GSCから検索パフォーマンスデータ取得
  Logger.log('=== GSCデータ取得開始 ===');
  const gscData = fetchGSCData(dateRange);
  Logger.log(`GSC: ${Object.keys(gscData).length} 記事の検索データ取得`);

  // Step 3: データ統合 + スコアリング
  Logger.log('=== スコアリング開始 ===');
  const scored = mergeAndScore(ga4Data, gscData);
  Logger.log(`スコアリング完了: ${scored.length} 記事`);

  // Step 4: 上位N記事をSpreadsheetに出力
  const topArticles = scored.slice(0, CONFIG.TOP_N_ARTICLES);
  writeToSheet(topArticles, dateRange);

  Logger.log('=== 週次レポート完了 ===');
}

// ============================================================
// GA4 Data API: affiliate_clickイベント数を記事別に取得
// ============================================================
function fetchGA4AffiliateClicks(dateRange) {
  const request = AnalyticsData.newRunReportRequest();

  // ディメンション: page_url（どの記事でクリックされたか）
  const dimPageUrl = AnalyticsData.newDimension();
  dimPageUrl.name = 'customEvent:page_url';
  request.dimensions = [dimPageUrl];

  // メトリクス: イベント数
  const metEventCount = AnalyticsData.newMetric();
  metEventCount.name = 'eventCount';
  request.metrics = [metEventCount];

  // 日付範囲
  const dateRangeObj = AnalyticsData.newDateRange();
  dateRangeObj.startDate = dateRange.start;
  dateRangeObj.endDate = dateRange.end;
  request.dateRanges = [dateRangeObj];

  // イベント名フィルター: affiliate_click のみ
  const filterExpr = AnalyticsData.newFilterExpression();
  const filter = AnalyticsData.newFilter();
  filter.fieldName = 'eventName';
  const stringFilter = AnalyticsData.newStringFilter();
  stringFilter.value = CONFIG.AFFILIATE_CLICK_EVENT;
  stringFilter.matchType = 'EXACT';
  filter.stringFilter = stringFilter;
  filterExpr.filter = filter;
  request.dimensionFilter = filterExpr;

  // リクエスト実行
  const response = AnalyticsData.Properties.runReport(
    request,
    `properties/${CONFIG.GA4_PROPERTY_ID}`
  );

  // 結果をオブジェクトに変換 { "記事URL": クリック数 }
  const result = {};
  if (response.rows) {
    response.rows.forEach(row => {
      const pageUrl = row.dimensionValues[0].value;
      const clicks = parseInt(row.metricValues[0].value, 10);
      if (pageUrl && pageUrl !== '(not set)') {
        // URLを正規化（パス部分のみに統一）
        const path = normalizeUrl(pageUrl);
        result[path] = (result[path] || 0) + clicks;
      }
    });
  }

  return result;
}

// ============================================================
// GSC Search Analytics API: 記事別の検索パフォーマンス取得
// ============================================================
function fetchGSCData(dateRange) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(CONFIG.GSC_SITE_URL)}/searchAnalytics/query`;

  const payload = {
    startDate: dateRange.start,
    endDate: dateRange.end,
    dimensions: ['page'],
    rowLimit: 1000,
    startRow: 0,
  };

  const allRows = [];
  let startRow = 0;
  const batchSize = 1000;

  // ページネーション対応
  while (true) {
    payload.startRow = startRow;
    payload.rowLimit = batchSize;

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      Logger.log(`GSC APIエラー: ${responseCode} - ${response.getContentText()}`);
      break;
    }

    const data = JSON.parse(response.getContentText());
    if (!data.rows || data.rows.length === 0) break;

    allRows.push(...data.rows);

    if (data.rows.length < batchSize) break;
    startRow += batchSize;
  }

  // 結果をオブジェクトに変換
  const result = {};
  allRows.forEach(row => {
    const pageUrl = row.keys[0];
    const path = normalizeUrl(pageUrl);
    result[path] = {
      impressions: row.impressions,
      gscClicks: row.clicks,
      position: row.position,
    };
  });

  return result;
}

// ============================================================
// データ統合 + スコアリング
// ============================================================
function mergeAndScore(ga4Data, gscData) {
  const allPaths = new Set([
    ...Object.keys(ga4Data),
    ...Object.keys(gscData),
  ]);

  const articles = [];

  allPaths.forEach(path => {
    const affiliateClicks = ga4Data[path] || 0;
    const gsc = gscData[path] || { impressions: 0, gscClicks: 0, position: 0 };

    // GSCクリックが0の記事はスキップ（流入がないのでCVR改善の対象外）
    if (gsc.gscClicks === 0) return;

    // 順位補正係数
    const positionCoefficient = getPositionCoefficient(gsc.position);

    // 改善スコア = （GSC流入クリック数 × 順位補正係数） ÷ （affiliate_click数 + 1）
    // スコアが高い = 流入があるのにaffiliate_clickが少ない = CVR改善余地が大きい
    const score = (gsc.gscClicks * positionCoefficient) / (affiliateClicks + 1);

    // CTR（参考値）
    const ctr = gsc.impressions > 0
      ? (gsc.gscClicks / gsc.impressions * 100)
      : 0;

    // 簡易CVR（参考値）
    const cvr = gsc.gscClicks > 0
      ? (affiliateClicks / gsc.gscClicks * 100)
      : 0;

    articles.push({
      path: path,
      fullUrl: CONFIG.GSC_SITE_URL.replace(/\/$/, '') + path,
      impressions: gsc.impressions,
      gscClicks: gsc.gscClicks,
      position: Math.round(gsc.position * 10) / 10,
      positionCoefficient: positionCoefficient,
      affiliateClicks: affiliateClicks,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      score: Math.round(score * 100) / 100,
    });
  });

  // スコア降順でソート
  articles.sort((a, b) => b.score - a.score);

  return articles;
}

// 順位補正係数
function getPositionCoefficient(position) {
  if (position <= 3) return 1.0;
  if (position <= 10) return 0.7;
  return 0.3;
}

// ============================================================
// Spreadsheet出力
// ============================================================
function writeToSheet(articles, dateRange) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = CONFIG.SHEET_NAME_PREFIX + dateRange.end;

  // 既存シートがあれば削除して再作成
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  // ヘッダー
  const headers = [
    '順位',
    '記事URL',
    '改善スコア',
    'GSC表示回数',
    'GSCクリック数',
    '平均掲載順位',
    '順位補正',
    'affiliate_click数',
    'CTR(%)',
    '簡易CVR(%)',
    '診断ステータス',
    '問題点',
    '改善案A',
    '改善案B',
    '改善案C',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダー書式
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4472C4');
  headerRange.setFontColor('#FFFFFF');

  // データ行
  if (articles.length === 0) {
    Logger.log('出力対象の記事が0件です');
    return;
  }

  const rows = articles.map((article, index) => [
    index + 1,
    article.fullUrl,
    article.score,
    article.impressions,
    article.gscClicks,
    article.position,
    article.positionCoefficient,
    article.affiliateClicks,
    article.ctr,
    article.cvr,
    '未診断', // Claude API診断後に更新
    '',       // 問題点
    '',       // 改善案A
    '',       // 改善案B
    '',       // 改善案C
  ]);

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // 列幅調整
  sheet.setColumnWidth(2, 400); // URL列
  sheet.setColumnWidth(12, 300); // 問題点列
  sheet.setColumnWidth(13, 300); // 改善案A
  sheet.setColumnWidth(14, 300); // 改善案B
  sheet.setColumnWidth(15, 300); // 改善案C

  // 条件付き書式: スコア上位はハイライト
  const scoreRange = sheet.getRange(2, 3, rows.length, 1);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(articles[Math.min(2, articles.length - 1)].score)
    .setBackground('#FFF2CC')
    .setRanges([scoreRange])
    .build();
  sheet.setConditionalFormatRules([rule]);

  Logger.log(`シート「${sheetName}」に ${rows.length} 件出力完了`);
}

// ============================================================
// ユーティリティ
// ============================================================

// 日付範囲を生成
function getDateRange(days) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // 昨日まで
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);

  return {
    start: Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd'),
    end: Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd'),
  };
}

// URLを正規化（パス部分に統一）
function normalizeUrl(url) {
  try {
    // フルURLの場合はパスを抽出
    if (url.startsWith('http')) {
      const urlObj = new URL(url);
      return urlObj.pathname;
    }
    // 既にパスの場合はそのまま
    return url.startsWith('/') ? url : '/' + url;
  } catch (e) {
    return url;
  }
}

// ============================================================
// テスト用関数
// ============================================================

// GA4接続テスト
function testGA4Connection() {
  const dateRange = getDateRange(7);
  Logger.log(`テスト期間: ${dateRange.start} 〜 ${dateRange.end}`);

  try {
    const data = fetchGA4AffiliateClicks(dateRange);
    Logger.log('GA4接続成功');
    Logger.log(`取得記事数: ${Object.keys(data).length}`);
    // 上位5件を表示
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    entries.slice(0, 5).forEach(([url, clicks]) => {
      Logger.log(`  ${url}: ${clicks} clicks`);
    });
  } catch (e) {
    Logger.log(`GA4接続エラー: ${e.message}`);
    Logger.log('確認事項:');
    Logger.log('1. Google Analytics Data API が有効化されているか');
    Logger.log('2. Apps ScriptにAnalyticsDataサービスが追加されているか');
    Logger.log('3. プロパティID 516785717 が正しいか');
  }
}

// GSC接続テスト
function testGSCConnection() {
  const dateRange = getDateRange(7);
  Logger.log(`テスト期間: ${dateRange.start} 〜 ${dateRange.end}`);

  try {
    const data = fetchGSCData(dateRange);
    Logger.log('GSC接続成功');
    Logger.log(`取得記事数: ${Object.keys(data).length}`);
    // 上位5件を表示
    const entries = Object.entries(data).sort((a, b) => b[1].gscClicks - a[1].gscClicks);
    entries.slice(0, 5).forEach(([url, d]) => {
      Logger.log(`  ${url}: ${d.gscClicks} clicks, pos ${Math.round(d.position * 10) / 10}`);
    });
  } catch (e) {
    Logger.log(`GSC接続エラー: ${e.message}`);
    Logger.log('確認事項:');
    Logger.log('1. Google Search Console API が有効化されているか');
    Logger.log('2. サイトURL https://www.soico.jp/no1/ がGSCに登録されているか');
    Logger.log('3. GASを実行しているGoogleアカウントにGSCのアクセス権があるか');
  }
}

// 統合テスト（フルフロー）
function testFullFlow() {
  Logger.log('=== 統合テスト開始 ===');
  runWeeklyReport();
  Logger.log('=== 統合テスト完了 ===');
}
```

---

## Part 3: 作業手順

### やること（この順番で）

1. **Spreadsheet作成** → `soico_cvr_weekly_report` という名前で新規作成
2. **Apps Script起動** → 拡張機能 → Apps Script
3. **GCPプロジェクト紐付け** → Part 1 の 1-2 を実行
4. **API有効化** → Part 1 の 1-3 を実行（GA4 Data API + Search Console API）
5. **サービス追加** → Part 1 の 1-4 を実行（AnalyticsData）
6. **スクリプト貼り付け** → Part 2 のコードを `main.gs` に貼り付け
7. **テスト実行**:
   - まず `testGA4Connection` を実行 → OAuth認証許可 → ログ確認
   - 次に `testGSCConnection` を実行 → ログ確認
   - 両方成功したら `testFullFlow` を実行

### OAuth認証で求められるスコープ
初回実行時に以下の権限を求められる。全て許可する:
- Google Analytics（読み取り）
- Google Search Console（読み取り）
- Google Spreadsheet（読み書き）
- 外部サービスへの接続（UrlFetchApp用）

---

## Part 4: トラブルシューティング

| エラー | 原因 | 対処 |
|---|---|---|
| `GoogleJsonResponseException: 403` | API未有効化 or 権限不足 | GCPコンソールでAPI有効化を確認。GASのGoogleアカウントがGA4/GSCにアクセス権を持っているか確認 |
| `AnalyticsData is not defined` | サービス未追加 | Apps Script → サービス → Google Analytics Data API を追加 |
| `HttpResponseException: 403` (GSC) | GSCのアクセス権不足 | GSCにログインし、該当サイトの権限を確認 |
| `(not set)` が大量に出る | GA4のカスタムディメンション未設定 or GTMの設定ミス | GA4管理画面でpage_urlカスタムディメンションが登録されているか確認 |
| 記事数が0件 | affiliate_clickイベントが未発火 | GTMプレビューモードで /recommends/ リンクをクリックし、イベント発火を確認 |
