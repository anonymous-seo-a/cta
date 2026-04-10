// ============================================================
// CTA台帳: 全記事の Gap Fill 管理
//
// シート名: cta_diagnosis_master
//
// 列構造（簡素化版）:
//   A: postId (主キー)
//   B: url
//   C: category (cardloan/cryptocurrency/securities/etc.)
//   D: title
//   E: monthlyPv (GSC impressions で代替)
//   F: score (mergeAndScoreの算出値)
//   G: gapFillStatus (未実行/実行済み/承認済み)
//   H: lastGapFilledAt (最終Gap Fill実行日)
//   I: lastScoredAt (最終スコアリング日時)
// ============================================================

const MASTER_SHEET_NAME = 'cta_diagnosis_master';
const PV_THRESHOLD = 30;

const COL = {
  POST_ID: 0,         // A
  URL: 1,              // B
  CATEGORY: 2,         // C
  TITLE: 3,            // D
  MONTHLY_PV: 4,       // E
  SCORE: 5,            // F
  GAP_FILL_STATUS: 6,  // G
  LAST_GAP_FILLED: 7,  // H
  LAST_SCORED: 8,      // I
};
const MASTER_COL_COUNT = 9;

// ============================================================
// 台帳シートの取得 or 初期化
// ============================================================
function getOrCreateMasterSheet(ss) {
  let sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(MASTER_SHEET_NAME);

  const headers = [
    'postId', 'URL', 'カテゴリ', 'タイトル',
    '月間PV(imps)', 'スコア',
    'GapFillステータス', '最終GapFill日', '最終スコアリング日',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1565C0');
  headerRange.setFontColor('#FFFFFF');

  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 400);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 300);
  sheet.setColumnWidth(7, 130);

  Logger.log(`「${MASTER_SHEET_NAME}」シートを新規作成`);
  return sheet;
}

// ============================================================
// 台帳の全データを postId → row のマップとして取得
// ============================================================
function loadMasterIndex(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { data: [], index: {} };

  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_COL_COUNT).getValues();
  const index = {};
  for (let i = 0; i < data.length; i++) {
    const postId = String(data[i][COL.POST_ID]);
    if (postId) {
      index[postId] = i;
    }
  }
  return { data, index };
}

// ============================================================
// 全記事の postId + URL + title を取得
// PHP エンドポイント優先、フォールバックで WP REST API
// ============================================================
const LIST_POSTS_TOKEN = 'ta_placement_8f3k2m9x7v1q4w6e';

function fetchAllWpPosts() {
  const posts = fetchAllWpPostsViaPHP();
  if (posts && posts.length > 0) return posts;

  Logger.log('PHP エンドポイント不可 → WP REST API にフォールバック');
  return fetchAllWpPostsViaREST();
}

function fetchAllWpPostsViaPHP() {
  const siteUrl = CONFIG.WP_REST_BASE.replace('/wp-json/wp/v2', '');
  const url = `${siteUrl}/list_posts.php?token=${LIST_POSTS_TOKEN}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;

    const data = JSON.parse(response.getContentText());
    if (data.error) return null;

    const posts = (data.posts || []).map(p => ({
      postId: String(p.id),
      url: p.url || '',
      title: p.title || '',
    }));

    Logger.log(`list_posts.php: ${posts.length}件取得`);
    return posts;
  } catch (e) {
    Logger.log(`list_posts.php 例外: ${e.message}`);
    return null;
  }
}

function fetchAllWpPostsViaREST() {
  const username = PropertiesService.getScriptProperties().getProperty('WP_USERNAME');
  const appPassword = PropertiesService.getScriptProperties().getProperty('WP_APP_PASSWORD');
  const authHeader = 'Basic ' + Utilities.base64Encode(username + ':' + appPassword);

  const allPosts = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${CONFIG.WP_REST_BASE}/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,link,title&orderby=id&order=asc`;

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': authHeader },
        muteHttpExceptions: true,
      });

      if (response.getResponseCode() !== 200) break;

      const posts = JSON.parse(response.getContentText());
      if (!posts || posts.length === 0) break;

      posts.forEach(p => {
        allPosts.push({
          postId: String(p.id),
          url: p.link || '',
          title: (p.title && p.title.rendered) || '',
        });
      });

      if (posts.length < perPage) break;
      page++;
      Utilities.sleep(200);
    } catch (e) {
      Logger.log(`WP REST API 例外: ${e.message}`);
      break;
    }
  }

  return allPosts;
}

// ============================================================
// 週次スコアリング: 全記事のスコアを再計算し台帳を更新
// ============================================================
function runWeeklyScoring() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateMasterSheet(ss);

  Logger.log('=== 週次スコアリング開始 ===');

  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);
  Logger.log(`期間: ${dateRange.start} 〜 ${dateRange.end}`);

  const ga4Data = fetchGA4AffiliateClicks(dateRange);
  Logger.log(`GA4: ${Object.keys(ga4Data).length} 記事`);

  const gscData = fetchGSCData(dateRange);
  Logger.log(`GSC: ${Object.keys(gscData).length} 記事`);

  const scored = mergeAndScore(ga4Data, gscData);
  Logger.log(`スコアリング: ${scored.length} 記事`);

  const wpPosts = fetchAllWpPosts();
  Logger.log(`WP記事: ${wpPosts.length} 件`);

  const wpByPath = {};
  wpPosts.forEach(p => {
    const path = normalizeUrl(p.url);
    wpByPath[path] = p;
  });

  const { data: existingData, index: existingIndex } = loadMasterIndex(sheet);

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  let newCount = 0;
  let updatedCount = 0;

  const rowUpdates = [];
  const newRows = [];

  for (const article of scored) {
    const wp = wpByPath[article.path];
    if (!wp) continue;

    const postId = wp.postId;
    const category = detectArticleCategory(article.fullUrl);

    if (existingIndex.hasOwnProperty(postId)) {
      const dataIdx = existingIndex[postId];
      const oldRow = existingData[dataIdx];
      const sheetRowNum = dataIdx + 2;

      rowUpdates.push({
        rowNum: sheetRowNum,
        values: [
          postId, article.fullUrl, category, wp.title,
          article.impressions, article.score,
          oldRow[COL.GAP_FILL_STATUS] || '',
          oldRow[COL.LAST_GAP_FILLED] || '',
          now,
        ],
      });
      updatedCount++;
    } else {
      const gapFillStatus = article.impressions <= PV_THRESHOLD ? 'スキップ(PV不足)' : '';
      newRows.push([
        postId, article.fullUrl, category, wp.title,
        article.impressions, article.score,
        gapFillStatus, '', now,
      ]);
      newCount++;
    }
  }

  for (const update of rowUpdates) {
    sheet.getRange(update.rowNum, 1, 1, MASTER_COL_COUNT).setValues([update.values]);
  }

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, MASTER_COL_COUNT).setValues(newRows);
  }

  applyMasterConditionalFormatting(sheet);

  Logger.log(`\n=== 週次スコアリング完了 ===`);
  Logger.log(`新規: ${newCount}, 更新: ${updatedCount}`);
}

// ============================================================
// 台帳の条件付き書式
// ============================================================
function applyMasterConditionalFormatting(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const statusRange = sheet.getRange(2, COL.GAP_FILL_STATUS + 1, lastRow - 1, 1);

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('実行済み').setBackground('#C8E6C9').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('承認済み').setBackground('#BBDEFB').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('スキップ').setBackground('#EEEEEE').setFontColor('#9E9E9E').setRanges([statusRange]).build(),
  ]);
}

// ============================================================
// テスト用
// ============================================================
function testWeeklyScoring() {
  runWeeklyScoring();
}
