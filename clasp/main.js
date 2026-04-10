// ============================================================
// 共有設定・ユーティリティ
//
// CTA挿入パイプラインとリライトパイプラインの両方が使用する
// 設定定数・API接続・ユーティリティ関数。
// ============================================================

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  GA4_PROPERTY_ID: '516785717',
  GSC_SITE_URL: 'https://www.soico.jp/no1/',
  DATE_RANGE_DAYS: 28,
  SHEET_NAME_PREFIX: 'weekly_',
  AFFILIATE_CLICK_EVENT: 'affiliate_click',
  WP_REST_BASE: 'https://www.soico.jp/no1/wp-json/wp/v2',
};

const CLAUDE_CONFIG = {
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 4096,
  API_URL: 'https://api.anthropic.com/v1/messages',
};

// ============================================================
// ThirstyAffiliates REST API: 提携済み案件を全件取得
// ============================================================
function fetchAllThirstyLinks() {
  const allLinks = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${CONFIG.WP_REST_BASE}/thirstylink?per_page=${perPage}&page=${page}`;

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
      });

      if (response.getResponseCode() !== 200) break;

      const data = JSON.parse(response.getContentText());
      if (!data || data.length === 0) break;

      data.forEach(item => {
        allLinks.push({
          slug: item.slug,
          name: item.title.rendered,
          recommendsUrl: `/no1/recommends/${item.slug}`,
          destinationUrl: item._ta_destination_url || '',
          categories: item._ta_categories || [],
        });
      });

      if (data.length < perPage) break;
      page++;
    } catch (e) {
      Logger.log(`ThirstyAffiliates API取得エラー: ${e.message}`);
      break;
    }
  }

  return allLinks;
}

// ============================================================
// GA4 Data API: affiliate_clickイベント数を記事別に取得
// ============================================================
function fetchGA4AffiliateClicks(dateRange) {
  const request = AnalyticsData.newRunReportRequest();

  const dimPageUrl = AnalyticsData.newDimension();
  dimPageUrl.name = 'pageLocation';
  request.dimensions = [dimPageUrl];

  const metEventCount = AnalyticsData.newMetric();
  metEventCount.name = 'eventCount';
  request.metrics = [metEventCount];

  const dateRangeObj = AnalyticsData.newDateRange();
  dateRangeObj.startDate = dateRange.start;
  dateRangeObj.endDate = dateRange.end;
  request.dateRanges = [dateRangeObj];

  const filterExpr = AnalyticsData.newFilterExpression();
  const filter = AnalyticsData.newFilter();
  filter.fieldName = 'eventName';
  const stringFilter = AnalyticsData.newStringFilter();
  stringFilter.value = CONFIG.AFFILIATE_CLICK_EVENT;
  stringFilter.matchType = 'EXACT';
  filter.stringFilter = stringFilter;
  filterExpr.filter = filter;
  request.dimensionFilter = filterExpr;

  const response = AnalyticsData.Properties.runReport(
    request,
    `properties/${CONFIG.GA4_PROPERTY_ID}`
  );

  const result = {};
  if (response.rows) {
    response.rows.forEach(row => {
      const pageUrl = row.dimensionValues[0].value;
      const clicks = parseInt(row.metricValues[0].value, 10);
      if (pageUrl && pageUrl !== '(not set)') {
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
    if (response.getResponseCode() !== 200) break;

    const data = JSON.parse(response.getContentText());
    if (!data.rows || data.rows.length === 0) break;

    allRows.push(...data.rows);

    if (data.rows.length < batchSize) break;
    startRow += batchSize;
  }

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

    if (gsc.gscClicks === 0) return;

    const positionCoefficient = getPositionCoefficient(gsc.position);
    const score = (gsc.gscClicks * positionCoefficient) / (affiliateClicks + 1);

    articles.push({
      path: path,
      fullUrl: pathToFullUrl(path),
      impressions: gsc.impressions,
      gscClicks: gsc.gscClicks,
      position: Math.round(gsc.position * 10) / 10,
      affiliateClicks: affiliateClicks,
      score: Math.round(score * 100) / 100,
    });
  });

  articles.sort((a, b) => b.score - a.score);
  return articles;
}

function getPositionCoefficient(position) {
  if (position <= 3) return 1.0;
  if (position <= 10) return 0.7;
  return 0.3;
}

// ============================================================
// ユーティリティ
// ============================================================
function getDateRange(days) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);

  return {
    start: Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd'),
    end: Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd'),
  };
}

function normalizeUrl(url) {
  var clean = url.split('?')[0].split('#')[0];
  var match = clean.match(/https?:\/\/[^\/]+(\/.*)/);
  if (match) return match[1];
  return clean.startsWith('/') ? clean : '/' + clean;
}

function pathToFullUrl(path) {
  if (path.startsWith('/no1/')) {
    return 'https://www.soico.jp' + path;
  }
  return CONFIG.GSC_SITE_URL.replace(/\/$/, '') + path;
}

function detectArticleCategory(url) {
  const categoryPatterns = {
    'cardloan': ['cardloan', 'caching'],
    'fx': ['fx'],
    'cryptocurrency': ['cryptocurrency'],
    'securities': ['securities'],
    'realestate': ['realestate'],
    'funding': ['funding'],
    'hiring': ['hiring'],
  };

  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    for (const pattern of patterns) {
      if (url.includes(`/news/${pattern}/`) || url.includes(`/${pattern}/`)) {
        return category;
      }
    }
  }
  return 'other';
}
