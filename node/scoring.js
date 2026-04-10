/**
 * スコアリング: GA4 + GSC データ取得 → 改善優先度スコア算出
 *
 * GAS版の mergeAndScore ロジックを Node.js に移植。
 * Google APIs のサービスアカウント認証で GA4/GSC に直接アクセス。
 */
const { google } = require('googleapis');
const path = require('path');
const config = require('./config');

const KEY_FILE = path.join(__dirname, 'service-account-key.json');
const GA4_PROPERTY_ID = '516785717';
const GSC_SITE_URL = 'https://www.soico.jp/no1/';
const DATE_RANGE_DAYS = 28;

// ============================================================
// Google Auth
// ============================================================
function getAuthClient() {
  return new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ],
  });
}

// ============================================================
// GA4: affiliate_click イベント数を記事別に取得
// ============================================================
async function fetchGA4AffiliateClicks() {
  const auth = getAuthClient();
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

  const res = await analyticsData.properties.runReport({
    property: `properties/${GA4_PROPERTY_ID}`,
    requestBody: {
      dateRanges: [{ startDate: `${DATE_RANGE_DAYS}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'pageLocation' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: 'affiliate_click' },
        },
      },
      limit: 10000,
    },
  });

  const result = {};
  if (res.data.rows) {
    for (const row of res.data.rows) {
      const pageUrl = row.dimensionValues[0].value;
      const clicks = parseInt(row.metricValues[0].value, 10);
      if (pageUrl && pageUrl !== '(not set)') {
        const p = normalizeUrl(pageUrl);
        result[p] = (result[p] || 0) + clicks;
      }
    }
  }
  return result;
}

// ============================================================
// GSC: 記事別の検索パフォーマンス取得
// ============================================================
async function fetchGSCData() {
  const auth = getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - DATE_RANGE_DAYS + 1);

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const allRows = [];
  let startRow = 0;
  const batchSize = 5000;

  while (true) {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE_URL,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: batchSize,
        startRow,
      },
    });

    if (!res.data.rows || res.data.rows.length === 0) break;
    allRows.push(...res.data.rows);
    if (res.data.rows.length < batchSize) break;
    startRow += batchSize;
  }

  const result = {};
  for (const row of allRows) {
    const p = normalizeUrl(row.keys[0]);
    result[p] = {
      impressions: row.impressions,
      gscClicks: row.clicks,
      position: row.position,
    };
  }
  return result;
}

// ============================================================
// スコアリング: GA4 + GSC → 改善優先度スコア
// ============================================================
function mergeAndScore(ga4Data, gscData) {
  const allPaths = new Set([...Object.keys(ga4Data), ...Object.keys(gscData)]);
  const articles = [];

  for (const p of allPaths) {
    const affiliateClicks = ga4Data[p] || 0;
    const gsc = gscData[p] || { impressions: 0, gscClicks: 0, position: 0 };
    if (gsc.gscClicks === 0) continue;

    const posCoeff = gsc.position <= 3 ? 1.0 : gsc.position <= 10 ? 0.7 : 0.3;
    const score = (gsc.gscClicks * posCoeff) / (affiliateClicks + 1);

    articles.push({
      path: p,
      fullUrl: pathToFullUrl(p),
      impressions: gsc.impressions,
      gscClicks: gsc.gscClicks,
      position: Math.round(gsc.position * 10) / 10,
      affiliateClicks,
      score: Math.round(score * 100) / 100,
    });
  }

  articles.sort((a, b) => b.score - a.score);
  return articles;
}

// ============================================================
// メイン: スコアリング実行
// ============================================================
async function runScoring() {
  console.log('=== スコアリング開始 ===');

  console.log('GA4 データ取得中...');
  const ga4Data = await fetchGA4AffiliateClicks();
  console.log(`GA4: ${Object.keys(ga4Data).length} 記事`);

  console.log('GSC データ取得中...');
  const gscData = await fetchGSCData();
  console.log(`GSC: ${Object.keys(gscData).length} 記事`);

  const scored = mergeAndScore(ga4Data, gscData);
  console.log(`スコアリング完了: ${scored.length} 記事`);

  return scored;
}

// ============================================================
// ユーティリティ
// ============================================================
function normalizeUrl(url) {
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/https?:\/\/[^\/]+(\/.*)/);
  if (match) return match[1];
  return clean.startsWith('/') ? clean : '/' + clean;
}

function pathToFullUrl(p) {
  if (p.startsWith('/no1/')) return 'https://www.soico.jp' + p;
  return GSC_SITE_URL.replace(/\/$/, '') + p;
}

module.exports = { runScoring };
