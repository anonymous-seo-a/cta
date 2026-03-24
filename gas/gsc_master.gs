// ============================================================
// GSC Master: GSCデータの一元管理
// 日次でgsc_masterシートを更新。他の機能はこのシートを参照する。
// ============================================================

const GSC_MASTER_CONFIG = {
  SHEET_NAME: 'gsc_master',
  TOP_KW_PER_PAGE: 10,
  MAX_PAGES: 500,
};

// ============================================================
// メイン: GSCマスターデータを更新
// 日次トリガー（毎朝6:00等）で実行
// ============================================================
function refreshGscMaster() {
  Logger.log('=== GSCマスターデータ更新開始 ===');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);

  // Step 1: ページ単位の集約データを取得
  Logger.log('Step 1: ページ単位データ取得...');
  const pageRows = fetchGscPageData(dateRange);
  Logger.log(`全ページ: ${pageRows.length}件`);

  if (pageRows.length === 0) {
    Logger.log('GSCデータなし。終了。');
    return;
  }

  // 対象カテゴリのみフィルタ
  const filteredPages = pageRows.filter(row => isTargetCategory(normalizeUrl(row.page)));
  Logger.log(`対象カテゴリ: ${filteredPages.length}件`);

  // Step 2: 各ページのトップKWを取得
  Logger.log('Step 2: 各ページのトップKWを取得...');
  const START_TIME = new Date().getTime();
  const TIME_LIMIT_MS = 5 * 60 * 1000;

  for (let i = 0; i < filteredPages.length; i++) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${i}件処理済み、残り${filteredPages.length - i}件はKWなしで保存。`);
      break;
    }

    const page = filteredPages[i];
    page.keywords = fetchTopKeywordsForPage(page.page, dateRange);
    page.topKeyword = page.keywords.length > 0 ? page.keywords[0].keyword : '';

    // 100件ごとにログ
    if ((i + 1) % 50 === 0) {
      Logger.log(`  KW取得進捗: ${i + 1}/${filteredPages.length}`);
    }
  }

  // Step 3: シートに書き出し
  Logger.log('Step 3: シートに書き出し...');
  writeGscMasterSheet(ss, filteredPages, dateRange);

  Logger.log(`=== GSCマスターデータ更新完了: ${filteredPages.length}件 ===`);
}

// ============================================================
// GSCマスター更新（KW取得の続き）
// 1回で全ページのKW取得が終わらなかった場合に再実行
// ============================================================
function refreshGscMasterContinue() {
  Logger.log('=== GSCマスター KW取得続行 ===');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(GSC_MASTER_CONFIG.SHEET_NAME);

  if (!sheet) {
    Logger.log('gsc_masterシートが見つかりません。refreshGscMasterを先に実行してください。');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  const START_TIME = new Date().getTime();
  const TIME_LIMIT_MS = 5 * 60 * 1000;
  let updated = 0;

  for (let i = 0; i < data.length; i++) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${updated}件更新済み。`);
      break;
    }

    const topKw = data[i][5]; // F列: トップKW
    if (topKw) continue; // 既にKW取得済みならスキップ

    const pageUrl = data[i][0]; // A列
    const rowNum = i + 2;

    const keywords = fetchTopKeywordsForPage(pageUrl, dateRange);
    if (keywords.length > 0) {
      sheet.getRange(rowNum, 6).setValue(keywords[0].keyword); // F列: トップKW
      sheet.getRange(rowNum, 7).setValue(JSON.stringify(keywords)); // G列: KW一覧JSON
      updated++;
    }
  }

  const remaining = data.filter(row => !row[5]).length - updated;
  Logger.log(`=== KW更新: ${updated}件完了、残り約${Math.max(0, remaining)}件 ===`);
}

// ============================================================
// GSC API: ページ単位の集約データを取得
// ============================================================
function fetchGscPageData(dateRange) {
  const gscUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(CONFIG.GSC_SITE_URL)}/searchAnalytics/query`;

  const payload = {
    startDate: dateRange.start,
    endDate: dateRange.end,
    dimensions: ['page'],
    rowLimit: GSC_MASTER_CONFIG.MAX_PAGES,
  };

  try {
    const response = UrlFetchApp.fetch(gscUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`GSC APIエラー: ${response.getResponseCode()}`);
      return [];
    }

    const data = JSON.parse(response.getContentText());
    if (!data.rows) return [];

    return data.rows.map(row => ({
      page: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      position: Math.round(row.position * 10) / 10,
      ctr: row.impressions > 0 ? Math.round(row.clicks / row.impressions * 10000) / 100 : 0,
      keywords: [],
      topKeyword: '',
    }));

  } catch (e) {
    Logger.log(`GSC API例外: ${e.message}`);
    return [];
  }
}

// ============================================================
// GSC API: 特定ページのトップKWを取得
// ============================================================
function fetchTopKeywordsForPage(pageUrl, dateRange) {
  if (!dateRange) dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);

  const gscUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(CONFIG.GSC_SITE_URL)}/searchAnalytics/query`;

  const payload = {
    startDate: dateRange.start,
    endDate: dateRange.end,
    dimensions: ['query'],
    dimensionFilterGroups: [{
      filters: [{
        dimension: 'page',
        expression: pageUrl,
      }],
    }],
    rowLimit: GSC_MASTER_CONFIG.TOP_KW_PER_PAGE,
  };

  try {
    const response = UrlFetchApp.fetch(gscUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) return [];

    const data = JSON.parse(response.getContentText());
    if (!data.rows) return [];

    return data.rows.map(row => ({
      keyword: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      position: Math.round(row.position * 10) / 10,
    }));

  } catch (e) {
    return [];
  }
}

// ============================================================
// gsc_masterシートに書き出し
// ============================================================
function writeGscMasterSheet(ss, pages, dateRange) {
  const sheetName = GSC_MASTER_CONFIG.SHEET_NAME;

  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = [
    'ページURL',      // A
    'クリック数',     // B
    '表示回数',       // C
    '平均順位',       // D
    'CTR(%)',         // E
    'トップKW',       // F
    'KW一覧(JSON)',   // G
    'カテゴリ',       // H
    '更新日',         // I
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1565C0');
  headerRange.setFontColor('#FFFFFF');

  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const rows = pages.map(p => [
    p.page,
    p.clicks,
    p.impressions,
    p.position,
    p.ctr,
    p.topKeyword,
    p.keywords.length > 0 ? JSON.stringify(p.keywords) : '',
    detectArticleCategory(normalizeUrl(p.page)),
    today,
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // 列幅
  sheet.setColumnWidth(1, 450);
  sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 400);

  // クリック数降順でソート
  if (rows.length > 1) {
    sheet.getRange(2, 1, rows.length, headers.length).sort({ column: 2, ascending: false });
  }

  Logger.log(`「${sheetName}」に ${rows.length} 件出力（期間: ${dateRange.start} 〜 ${dateRange.end}）`);
}

// ============================================================
// gsc_masterシートからデータを読み取るユーティリティ
// ============================================================

// 全データを取得
function readGscMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(GSC_MASTER_CONFIG.SHEET_NAME);

  if (!sheet) {
    Logger.log('gsc_masterシートが見つかりません。refreshGscMasterを実行してください。');
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  return data.map(row => ({
    page: row[0],
    clicks: row[1],
    impressions: row[2],
    position: row[3],
    ctr: row[4],
    topKeyword: row[5],
    keywords: row[6] ? JSON.parse(row[6]) : [],
    category: row[7],
    updatedAt: row[8],
  }));
}

// CVR診断用: 上位N記事を取得（スコアリング付き）
function getTopPagesForDiagnosis(ga4Data, topN) {
  const gscPages = readGscMaster();
  if (gscPages.length === 0) return [];

  // GA4データとマージ
  const ga4Map = {};
  if (ga4Data) {
    ga4Data.forEach(row => {
      const path = normalizeUrl(row.pagePath || row.page || '');
      ga4Map[path] = row.affiliateClicks || 0;
    });
  }

  const scored = gscPages.map(page => {
    const path = normalizeUrl(page.page);
    const affiliateClicks = ga4Map[path] || 0;
    const positionWeight = page.position <= 3 ? 1.0 : page.position <= 10 ? 0.7 : 0.3;
    const score = (page.clicks * positionWeight) / (affiliateClicks + 1);

    return {
      ...page,
      affiliateClicks: affiliateClicks,
      positionWeight: positionWeight,
      score: Math.round(score * 10) / 10,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN || 10);
}

// リライト用: 順位4-20、クリック10以上の改善余地がある記事
function getRewriteCandidates(topN) {
  const gscPages = readGscMaster();
  if (gscPages.length === 0) return [];

  const candidates = gscPages.filter(p =>
    p.position >= REWRITE_CONFIG.MIN_POSITION &&
    p.position <= REWRITE_CONFIG.MAX_POSITION &&
    p.clicks >= REWRITE_CONFIG.MIN_CLICKS &&
    p.topKeyword
  );

  // 改善余地スコア
  candidates.forEach(c => {
    const ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
    const positionWeight = Math.max(0, 21 - c.position) / 20;
    c.improvementScore = c.impressions * (1 - ctr) * positionWeight;
  });

  candidates.sort((a, b) => b.improvementScore - a.improvementScore);
  return candidates.slice(0, topN || REWRITE_CONFIG.TOP_N_REWRITE);
}

// ============================================================
// テスト用関数
// ============================================================
function testRefreshGscMaster() {
  refreshGscMaster();
}

function testReadGscMaster() {
  Logger.log('=== GSCマスター読み取りテスト ===');

  const pages = readGscMaster();
  Logger.log(`全ページ: ${pages.length}件`);

  // 上位5件表示
  pages.slice(0, 5).forEach((p, i) => {
    Logger.log(`  [${i + 1}] ${p.page}`);
    Logger.log(`      クリック: ${p.clicks}, 順位: ${p.position}, KW: ${p.topKeyword}`);
  });

  // リライト候補
  const candidates = getRewriteCandidates(5);
  Logger.log(`\nリライト候補: ${candidates.length}件`);
  candidates.forEach((c, i) => {
    Logger.log(`  [${i + 1}] ${c.page}`);
    Logger.log(`      KW: ${c.topKeyword}, 順位: ${c.position}, スコア: ${Math.round(c.improvementScore)}`);
  });

  Logger.log('=== テスト完了 ===');
}
