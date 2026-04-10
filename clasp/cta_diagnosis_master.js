// ============================================================
// CTA診断マスター: 全記事の永続台帳
//
// soico.jp/no1/ の全記事（~2000本）を1シートで管理する。
// 週次スコアリング → 変化検出 → 診断対象選定 のパイプラインの中核。
//
// シート名: cta_diagnosis_master
//
// 列構造:
//   A: postId (主キー)
//   B: url
//   C: category (cardloan/cryptocurrency/securities/etc.)
//   D: title
//   E: monthlyPv (GSC impressions で代替)
//   F: impressions (GSC直近28日)
//   G: clicks (GSC直近28日)
//   H: affiliateClicks (GA4直近28日)
//   I: score (mergeAndScoreの算出値)
//   J: snapshotHash (E〜Hをハッシュ化、変化検出用)
//   K: lastDiagnosedAt (最終診断日時)
//   L: diagnosisStatus (未診断/要再診断/診断済み/スキップ(PV不足)/スキップ(変化なし))
//   M: gapFillStatus (未実行/実行済み/承認済み)
//   N: lastScoredAt (最終スコアリング日時)
//
// 仕様:
//   - PV閾値: 月間impressions ≤ 30 → スキップ(PV不足)
//   - 変化検出: snapshotHash ±10%以上変動 → 要再診断
//   - 新規記事: 台帳に無い postId → 未診断
// ============================================================

const MASTER_SHEET_NAME = 'cta_diagnosis_master';
const PV_THRESHOLD = 30;
const CHANGE_THRESHOLD = 0.10; // 10%

// 列インデックス（0-based, getValues配列用）
const COL = {
  POST_ID: 0,        // A
  URL: 1,             // B
  CATEGORY: 2,        // C
  TITLE: 3,           // D
  MONTHLY_PV: 4,      // E
  IMPRESSIONS: 5,     // F
  CLICKS: 6,          // G
  AFFILIATE_CLICKS: 7,// H
  SCORE: 8,           // I
  SNAPSHOT_HASH: 9,   // J
  LAST_DIAGNOSED: 10, // K
  DIAGNOSIS_STATUS: 11,// L
  GAP_FILL_STATUS: 12,// M
  LAST_SCORED: 13,    // N
  PROBLEMS: 14,       // O: 診断で検出された問題点
  PLAN_A: 15,         // P: 改善案A（CTA挿入計画の入力源）
  PLAN_B: 16,         // Q: 改善案B
  PLAN_C: 17,         // R: 改善案C
};
const MASTER_COL_COUNT = 18;

// ============================================================
// 台帳シートの取得 or 初期化
// ============================================================
function getOrCreateMasterSheet(ss) {
  let sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(MASTER_SHEET_NAME);

  const headers = [
    'postId', 'URL', 'カテゴリ', 'タイトル',
    '月間PV(imps)', 'impressions', 'clicks', 'affiliateClicks',
    'スコア', 'snapshotHash',
    '最終診断日', '診断ステータス', 'GapFillステータス', '最終スコアリング日',
    '問題点', '改善案A', '改善案B', '改善案C',
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
  sheet.setColumnWidth(12, 150);
  sheet.setColumnWidth(13, 130);

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
      index[postId] = i; // data配列内のインデックス
    }
  }
  return { data, index };
}

// ============================================================
// snapshot ハッシュ計算
// impressions, clicks, affiliateClicks を丸めてからハッシュ化
// ============================================================
function computeSnapshotHash(impressions, clicks, affiliateClicks) {
  return `${Math.round(impressions)}:${Math.round(clicks)}:${Math.round(affiliateClicks)}`;
}

// ============================================================
// ±10%以上の変化があるか判定
// ============================================================
function hasSignificantChange(oldHash, newHash) {
  if (!oldHash || !newHash) return true;

  const oldParts = oldHash.split(':').map(Number);
  const newParts = newHash.split(':').map(Number);
  if (oldParts.length !== 3 || newParts.length !== 3) return true;

  for (let i = 0; i < 3; i++) {
    const base = oldParts[i] || 1; // ゼロ除算回避
    const change = Math.abs(newParts[i] - oldParts[i]) / base;
    if (change >= CHANGE_THRESHOLD) return true;
  }
  return false;
}

// ============================================================
// 全記事の postId + URL + title を取得
//
// 方式: Xserver 上の list_posts.php（DB直接アクセス）を呼び出し。
// article_list_maker の generate_placement.php と同じパターン。
// REST API のページネーション（~60秒）が ~1秒に短縮される。
//
// フォールバック: PHP が利用不可の場合は WP REST API で取得。
// ============================================================
const LIST_POSTS_TOKEN = 'ta_placement_8f3k2m9x7v1q4w6e';

function fetchAllWpPosts() {
  // まず PHP エンドポイントを試行
  const posts = fetchAllWpPostsViaPHP();
  if (posts && posts.length > 0) return posts;

  // フォールバック: WP REST API
  Logger.log('PHP エンドポイント不可 → WP REST API にフォールバック');
  return fetchAllWpPostsViaREST();
}

function fetchAllWpPostsViaPHP() {
  const siteUrl = CONFIG.WP_REST_BASE.replace('/wp-json/wp/v2', '');
  const url = `${siteUrl}/list_posts.php?token=${LIST_POSTS_TOKEN}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log(`list_posts.php: HTTP ${response.getResponseCode()}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    if (data.error) {
      Logger.log(`list_posts.php エラー: ${data.error}`);
      return null;
    }

    const posts = (data.posts || []).map(p => ({
      postId: String(p.id),
      url: p.url || '',
      title: p.title || '',
    }));

    Logger.log(`list_posts.php: ${posts.length}件取得（~1秒）`);
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

      if (response.getResponseCode() !== 200) {
        Logger.log(`WP REST API page ${page}: HTTP ${response.getResponseCode()}`);
        break;
      }

      const posts = JSON.parse(response.getContentText());
      if (!posts || posts.length === 0) break;

      posts.forEach(p => {
        allPosts.push({
          postId: String(p.id),
          url: p.link || '',
          title: (p.title && p.title.rendered) || '',
        });
      });

      Logger.log(`WP REST API page ${page}: ${posts.length}件 (累計: ${allPosts.length})`);

      if (posts.length < perPage) break;
      page++;
      Utilities.sleep(200);
    } catch (e) {
      Logger.log(`WP REST API page ${page} 例外: ${e.message}`);
      break;
    }
  }

  return allPosts;
}

// ============================================================
// 週次スコアリング: 全記事のスコアを再計算し台帳を更新
//
// 既存の runWeeklyReport() と同じ GA4/GSC データを使うが、
// TOP_N_ARTICLES で切らずに全記事を台帳に upsert する。
//
// フロー:
//   1. GA4 + GSC データ取得
//   2. mergeAndScore() で全記事スコアリング
//   3. WP REST API で全 postId を取得（初回 or 差分検出用）
//   4. 台帳シートに upsert:
//      - 新規記事 → 行追加、status=未診断
//      - 既存記事 → スコア更新 + snapshot比較
//        - PV≤30 → スキップ(PV不足)
//        - 変化なし → スキップ(変化なし)（診断済みの場合のみ）
//        - ±10%以上変化 → 要再診断
// ============================================================
function runWeeklyScoring() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateMasterSheet(ss);

  Logger.log('=== 週次スコアリング開始 ===');

  // 1. データ取得
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);
  Logger.log(`期間: ${dateRange.start} 〜 ${dateRange.end}`);

  const ga4Data = fetchGA4AffiliateClicks(dateRange);
  Logger.log(`GA4: ${Object.keys(ga4Data).length} 記事`);

  const gscData = fetchGSCData(dateRange);
  Logger.log(`GSC: ${Object.keys(gscData).length} 記事`);

  // 2. 全記事スコアリング（上限なし）
  const scored = mergeAndScore(ga4Data, gscData);
  Logger.log(`スコアリング: ${scored.length} 記事`);

  // 3. WP全記事一覧（postId + URL + title）
  const wpPosts = fetchAllWpPosts();
  Logger.log(`WP記事: ${wpPosts.length} 件`);

  // path → wpPost のマップ
  const wpByPath = {};
  wpPosts.forEach(p => {
    const path = normalizeUrl(p.url);
    wpByPath[path] = p;
  });

  // 4. 台帳 upsert
  const { data: existingData, index: existingIndex } = loadMasterIndex(sheet);

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  let newCount = 0;
  let updatedCount = 0;
  let pvSkipCount = 0;
  let noChangeCount = 0;
  let rediagnoseCount = 0;

  // scored の各記事を処理
  const rowUpdates = []; // { rowNum, values } の配列
  const newRows = [];

  for (const article of scored) {
    const wp = wpByPath[article.path];
    if (!wp) continue; // WPに存在しない記事はスキップ

    const postId = wp.postId;
    const category = detectArticleCategory(article.fullUrl);
    const newHash = computeSnapshotHash(article.impressions, article.gscClicks, article.affiliateClicks);

    if (existingIndex.hasOwnProperty(postId)) {
      // 既存記事: 更新
      const dataIdx = existingIndex[postId];
      const oldRow = existingData[dataIdx];
      const oldHash = oldRow[COL.SNAPSHOT_HASH];
      const oldStatus = oldRow[COL.DIAGNOSIS_STATUS];
      const sheetRowNum = dataIdx + 2; // ヘッダ行分 +1, 0-based → 1-based +1

      let newStatus = oldStatus;

      if (article.impressions <= PV_THRESHOLD) {
        newStatus = 'スキップ(PV不足)';
        pvSkipCount++;
      } else if (oldStatus === '診断済み' && !hasSignificantChange(oldHash, newHash)) {
        newStatus = 'スキップ(変化なし)';
        noChangeCount++;
      } else if (oldStatus === '診断済み' && hasSignificantChange(oldHash, newHash)) {
        newStatus = '要再診断';
        rediagnoseCount++;
      }
      // 未診断/要再診断 はステータスを維持

      rowUpdates.push({
        rowNum: sheetRowNum,
        values: [
          postId, article.fullUrl, category, wp.title,
          article.impressions, article.impressions, article.gscClicks, article.affiliateClicks,
          article.score, newHash,
          oldRow[COL.LAST_DIAGNOSED] || '', newStatus,
          oldRow[COL.GAP_FILL_STATUS] || '', now,
          oldRow[COL.PROBLEMS] || '', oldRow[COL.PLAN_A] || '',
          oldRow[COL.PLAN_B] || '', oldRow[COL.PLAN_C] || '',
        ],
      });
      updatedCount++;
    } else {
      // 新規記事: 追加
      let newStatus;
      if (article.impressions <= PV_THRESHOLD) {
        newStatus = 'スキップ(PV不足)';
        pvSkipCount++;
      } else {
        newStatus = '未診断';
      }

      newRows.push([
        postId, article.fullUrl, category, wp.title,
        article.impressions, article.impressions, article.gscClicks, article.affiliateClicks,
        article.score, newHash,
        '', newStatus, '', now,
        '', '', '', '',
      ]);
      newCount++;
    }
  }

  // 一括書き込み: 既存行の更新
  for (const update of rowUpdates) {
    sheet.getRange(update.rowNum, 1, 1, MASTER_COL_COUNT).setValues([update.values]);
  }

  // 一括書き込み: 新規行の追加
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, MASTER_COL_COUNT).setValues(newRows);
  }

  // ステータス列の条件付き書式
  applyMasterConditionalFormatting(sheet);

  Logger.log(`\n=== 週次スコアリング完了 ===`);
  Logger.log(`新規: ${newCount}, 更新: ${updatedCount}`);
  Logger.log(`PV不足スキップ: ${pvSkipCount}, 変化なしスキップ: ${noChangeCount}, 要再診断: ${rediagnoseCount}`);
}

// ============================================================
// 台帳の条件付き書式（診断ステータス列）
// ============================================================
function applyMasterConditionalFormatting(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const statusRange = sheet.getRange(2, COL.DIAGNOSIS_STATUS + 1, lastRow - 1, 1);

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('未診断').setBackground('#FFF9C4').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('要再診断').setBackground('#FFE0B2').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('診断済み').setBackground('#C8E6C9').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('スキップ').setBackground('#EEEEEE').setFontColor('#9E9E9E').setRanges([statusRange]).build(),
  ]);
}

// ============================================================
// Phase C: 台帳ベースのレジューム式 Claude 診断バッチ
//
// 台帳の diagnosisStatus = '未診断' or '要再診断' の記事を
// score 降順で取得し、1件ずつ Claude API で診断する。
//
// GAS 5分制約のため、時間制限に達したら中断。
// 診断済みの記事は台帳の status を '診断済み' に更新するので、
// 次回実行時は自動的に続きから再開される（レジューム）。
//
// 自動トリガー（5分間隔）で連続実行すれば全件処理できる。
// ============================================================
function runDiagnosisBatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MASTER_SHEET_NAME);

  if (!sheet) {
    Logger.log('台帳シートが見つかりません。先に testWeeklyScoring() を実行してください。');
    return;
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('CLAUDE_API_KEY が設定されていません');
    return;
  }

  // 台帳データ読み込み
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('台帳にデータがありません');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_COL_COUNT).getValues();

  // 診断対象を抽出（未診断 or 要再診断）→ score降順
  const targets = [];
  for (let i = 0; i < data.length; i++) {
    const status = data[i][COL.DIAGNOSIS_STATUS];
    if (status === '未診断' || status === '要再診断') {
      targets.push({
        dataIndex: i,
        sheetRow: i + 2,
        postId: String(data[i][COL.POST_ID]),
        url: data[i][COL.URL],
        category: data[i][COL.CATEGORY],
        impressions: data[i][COL.IMPRESSIONS],
        clicks: data[i][COL.CLICKS],
        affiliateClicks: data[i][COL.AFFILIATE_CLICKS],
        score: data[i][COL.SCORE],
      });
    }
  }

  targets.sort((a, b) => b.score - a.score);

  if (targets.length === 0) {
    Logger.log('診断対象がありません（全て診断済み or スキップ）');
    return;
  }

  Logger.log(`=== 診断バッチ開始: ${targets.length}件が対象 ===`);

  // 提携済み案件リスト（1回だけ取得）
  const partnerList = fetchAllThirstyLinks();
  Logger.log(`提携済み案件: ${partnerList.length} 件`);

  const START_TIME = new Date().getTime();
  const TIME_LIMIT_MS = 4.5 * 60 * 1000; // 安全マージン30秒
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  let diagnosed = 0;
  let errors = 0;

  for (const target of targets) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${diagnosed}件完了、残り${targets.length - diagnosed - errors}件は次回実行。`);
      break;
    }

    Logger.log(`\n--- 診断 [${diagnosed + 1}]: ${target.url} (score: ${target.score}) ---`);

    try {
      // CTA構造をスクレイプ
      const ctaStructure = scrapeCtaStructure(target.url);
      if (!ctaStructure) {
        Logger.log('スクレイプ失敗');
        sheet.getRange(target.sheetRow, COL.DIAGNOSIS_STATUS + 1).setValue('スクレイプ失敗');
        errors++;
        continue;
      }

      // GSC上位キーワード
      const topKeywords = fetchTopKeywordsForPage(target.url);
      const searchIntent = estimateSearchIntent(topKeywords);

      // Claude API 診断
      const diagnosis = callClaudeDiagnosis({
        articleUrl: target.url,
        topKeywords: topKeywords,
        impressions: target.impressions,
        clicks: target.clicks,
        affiliateClicks: target.affiliateClicks,
        searchIntent: searchIntent,
        ctaStructure: ctaStructure,
        partnerList: partnerList,
      });

      if (!diagnosis) {
        Logger.log('診断エラー（Claude API）');
        sheet.getRange(target.sheetRow, COL.DIAGNOSIS_STATUS + 1).setValue('診断エラー');
        errors++;
        continue;
      }

      // 台帳に結果を書き込み
      sheet.getRange(target.sheetRow, COL.LAST_DIAGNOSED + 1).setValue(now);
      sheet.getRange(target.sheetRow, COL.DIAGNOSIS_STATUS + 1).setValue('診断済み');
      sheet.getRange(target.sheetRow, COL.PROBLEMS + 1).setValue(formatProblems(diagnosis.problems));
      sheet.getRange(target.sheetRow, COL.PLAN_A + 1).setValue(formatPlan(diagnosis.plan_a));
      sheet.getRange(target.sheetRow, COL.PLAN_B + 1).setValue(formatPlan(diagnosis.plan_b));
      sheet.getRange(target.sheetRow, COL.PLAN_C + 1).setValue(formatPlan(diagnosis.plan_c));

      diagnosed++;
      Logger.log(`診断完了: ${target.url}`);

      Utilities.sleep(2000); // API レート制限回避

    } catch (e) {
      Logger.log(`エラー: ${e.message}`);
      sheet.getRange(target.sheetRow, COL.DIAGNOSIS_STATUS + 1).setValue('エラー: ' + e.message.substring(0, 50));
      errors++;
    }
  }

  Logger.log(`\n=== 診断バッチ完了: ${diagnosed}件診断, ${errors}件エラー, 残り${targets.length - diagnosed - errors}件 ===`);
}

// ============================================================
// テスト用: runWeeklyScoring を実行
// ============================================================
function testWeeklyScoring() {
  runWeeklyScoring();
}

// ============================================================
// テスト用: runDiagnosisBatch を実行（上位3件のみ）
// ============================================================
function testDiagnosisBatch() {
  runDiagnosisBatch();
}
