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
  WP_REST_BASE: 'https://www.soico.jp/no1/wp-json/wp/v2',
};

const CLAUDE_CONFIG = {
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 4096,
  API_URL: 'https://api.anthropic.com/v1/messages',
};

// ============================================================
// メイン処理: 週次レポート生成
// ============================================================
function runWeeklyReport() {
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);

  Logger.log('=== GA4データ取得開始 ===');
  const ga4Data = fetchGA4AffiliateClicks(dateRange);
  Logger.log(`GA4: ${Object.keys(ga4Data).length} 記事のクリックデータ取得`);

  Logger.log('=== GSCデータ取得開始 ===');
  const gscData = fetchGSCData(dateRange);
  Logger.log(`GSC: ${Object.keys(gscData).length} 記事の検索データ取得`);

  Logger.log('=== スコアリング開始 ===');
  const scored = mergeAndScore(ga4Data, gscData);
  Logger.log(`スコアリング完了: ${scored.length} 記事`);

  const topArticles = scored.slice(0, CONFIG.TOP_N_ARTICLES);
  writeToSheet(topArticles, dateRange);

  Logger.log('=== 週次レポート完了 ===');
}

// ============================================================
// メイン処理: Claude API診断（時間制限付きバッチ処理）
// ============================================================
function runDiagnosis() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = ss.getSheets().filter(s => s.getName().startsWith(CONFIG.SHEET_NAME_PREFIX));
  if (sheets.length === 0) {
    Logger.log('週次レポートシートが見つかりません。');
    return;
  }

  sheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  const sheet = sheets[0];
  Logger.log(`診断対象シート: ${sheet.getName()}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データ行がありません。');
    return;
  }

  const dataRange = sheet.getRange(2, 1, lastRow - 1, 15);
  const data = dataRange.getValues();

  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('CLAUDE_API_KEY が設定されていません。');
    return;
  }

  Logger.log('=== 提携済み案件リスト取得 ===');
  const partnerList = fetchAllThirstyLinks();
  Logger.log(`提携済み案件: ${partnerList.length} 件`);

  const START_TIME = new Date().getTime();
  const TIME_LIMIT_MS = 5 * 60 * 1000;

  let diagnosed = 0;
  let skipped = 0;

  for (let i = 0; i < data.length; i++) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${diagnosed}件完了、残り${data.length - i}件は次回実行で処理。`);
      break;
    }

    const row = data[i];
    const url = row[1];
    const status = row[10];

    if (status === '診断済み') {
      skipped++;
      continue;
    }

    Logger.log(`--- 診断開始 [${i + 1}/${data.length}]: ${url} ---`);

    try {
      const ctaStructure = scrapeCtaStructure(url);
      if (!ctaStructure) {
        sheet.getRange(i + 2, 11).setValue('スクレイプ失敗');
        continue;
      }

      const topKeywords = fetchTopKeywordsForPage(url);
      const searchIntent = estimateSearchIntent(topKeywords);

      const diagnosis = callClaudeDiagnosis({
        articleUrl: url,
        topKeywords: topKeywords,
        impressions: row[3],
        clicks: row[4],
        affiliateClicks: row[7],
        searchIntent: searchIntent,
        ctaStructure: ctaStructure,
        partnerList: partnerList,
      });

      if (!diagnosis) {
        sheet.getRange(i + 2, 11).setValue('診断エラー');
        continue;
      }

      const rowNum = i + 2;
      sheet.getRange(rowNum, 11).setValue('診断済み');
      sheet.getRange(rowNum, 12).setValue(formatProblems(diagnosis.problems));
      sheet.getRange(rowNum, 13).setValue(formatPlan(diagnosis.plan_a));
      sheet.getRange(rowNum, 14).setValue(formatPlan(diagnosis.plan_b));
      sheet.getRange(rowNum, 15).setValue(formatPlan(diagnosis.plan_c));

      // 未提携案件の推奨があればログ出力
      if (diagnosis.partnership_recommendations && diagnosis.partnership_recommendations.length > 0) {
        Logger.log(`  提携推奨: ${diagnosis.partnership_recommendations.map(r => r.service_name).join(', ')}`);
      }

      diagnosed++;
      Logger.log(`診断完了: ${url}`);

      Utilities.sleep(2000);

    } catch (e) {
      Logger.log(`エラー [${url}]: ${e.message}`);
      sheet.getRange(i + 2, 11).setValue('エラー: ' + e.message.substring(0, 50));
    }
  }

  Logger.log(`=== 診断完了: ${diagnosed}件実行, ${skipped}件スキップ（診断済み） ===`);
}

// ============================================================
// ThirstyAffiliates REST API: 提携済み案件を全件取得
// ============================================================
function fetchAllThirstyLinks() {
  const allLinks = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${CONFIG.WP_REST_BASE}/thirstylink?per_page=${perPage}&page=${page}`;

    const options = {
      method: 'get',
      muteHttpExceptions: true,
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();

      if (responseCode !== 200) {
        Logger.log(`ThirstyAffiliates API: page ${page} でエラー (${responseCode})`);
        break;
      }

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

// 記事カテゴリに応じて案件リストをフィルタし、プロンプト用テキストに変換
function formatPartnerListForPrompt(partnerList, articleCategory) {
  if (!partnerList || partnerList.length === 0) return '案件リスト取得不可';

  const categoryKeywords = {
    'cardloan': ['promise', 'acom', 'aiful', 'mobit', 'banquic', 'smbc', 'plannel', 'excel', 'big', 'alcosystem', 'spirits', 'progress', 'au-pay', 'cardloan', 'loan'],
    'fx': ['fx', 'gmo-click', 'dmm-fx', 'sbi-fx', 'minna', 'light-fx', 'hirose', 'gaitame', 'rakuten-fx', 'matsui-fx', 'line-fx', 'jfx', 'central-tanshi', 'invast', 'fxtf'],
    'cryptocurrency': ['bitflyer', 'coincheck', 'gmo-coin', 'bitbank', 'sbivc', 'bittrade', 'binance', 'bitpoint', 'zaif', 'okj', 'rakuten-wallet', 'line-bitmax', 'sblox', 'cointrade', 'btcbox', 'coin-estate', 'osl', 'mercoin', 'backseat', 'gate-japan', 'custodiem', 'money-partners-crypto', 'tokyo-hash', 'digital-asset', 'crypto-garage', 'coinhub'],
    'securities': ['sbi', 'rakuten', 'gaia', 'alternabank', 'agcrowd', 'funds', 'crowdbank', 'lendex'],
    'realestate': ['renosy', 'cozuchi', 'jpreturns', 'creal', 'property-agent', 'ownersbook', 'syla', 'rimple', 'tohshin', 'tecrowd', 'fj-next', 'jointo', 'global-link', 'assecli'],
    'funding': ['fund', 'gmo-anshin', 'mrf', 'actwill', 'oj-finance', 'escrow', 'business-partner', 'trustgateway', 'agbussiness'],
  };

  const relevantKeywords = categoryKeywords[articleCategory] || [];

  const relevant = [];
  const other = [];

  partnerList.forEach(p => {
    const slugLower = p.slug.toLowerCase();
    const isRelevant = relevantKeywords.some(kw => slugLower.includes(kw));
    if (isRelevant) {
      relevant.push(`${p.name} (slug: ${p.slug})`);
    } else {
      other.push(p.slug);
    }
  });

  let result = '【このカテゴリの提携済み案件】\n';
  result += relevant.length > 0 ? relevant.join('\n') : 'なし';
  result += `\n\n【他カテゴリの提携済み案件】${other.length}件あり（詳細省略）`;

  return result;
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

    const ctr = gsc.impressions > 0
      ? (gsc.gscClicks / gsc.impressions * 100)
      : 0;

    const cvr = gsc.gscClicks > 0
      ? (affiliateClicks / gsc.gscClicks * 100)
      : 0;

    articles.push({
      path: path,
      fullUrl: pathToFullUrl(path),
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

  articles.sort((a, b) => b.score - a.score);

  return articles;
}

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

  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

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

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4472C4');
  headerRange.setFontColor('#FFFFFF');

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
    '未診断',
    '',
    '',
    '',
    '',
  ]);

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  sheet.setColumnWidth(2, 400);
  sheet.setColumnWidth(12, 300);
  sheet.setColumnWidth(13, 300);
  sheet.setColumnWidth(14, 300);
  sheet.setColumnWidth(15, 300);

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
// 記事のCTA構造をスクレイプ
// ============================================================
function scrapeCtaStructure(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`HTTP ${response.getResponseCode()}: ${url}`);
      return null;
    }

    const html = response.getContentText('UTF-8');

    const structure = [];

    const headingRegex = /<(h[23])[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    let sectionIndex = 0;

    while ((match = headingRegex.exec(html)) !== null) {
      sectionIndex++;
      const level = match[1];
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      structure.push({
        type: 'heading',
        level: level,
        text: text,
        index: sectionIndex,
      });
    }

    const affiliateRegex = /<a[^>]*href="([^"]*\/recommends\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const affiliateLinks = [];

    while ((match = affiliateRegex.exec(html)) !== null) {
      const linkUrl = match[1];
      const linkText = match[2].replace(/<[^>]+>/g, '').trim();
      const position = match.index;

      const contextStart = Math.max(0, position - 300);
      const contextEnd = Math.min(html.length, position + 300);
      const context = html.substring(contextStart, contextEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      affiliateLinks.push({
        url: linkUrl,
        text: linkText,
        surroundingContext: context.substring(0, 200),
      });
    }

    const ctaBoxRegex = /<div[^>]*class="[^"]*(?:cta|recommend|box|banner|promotion)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const ctaBoxes = [];

    while ((match = ctaBoxRegex.exec(html)) !== null) {
      const content = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (content.length > 10) {
        ctaBoxes.push(content.substring(0, 300));
      }
    }

    const result = {
      headings: structure,
      affiliateLinks: affiliateLinks,
      ctaBoxes: ctaBoxes,
      totalHeadings: structure.length,
      totalAffiliateLinks: affiliateLinks.length,
      totalCtaBoxes: ctaBoxes.length,
    };

    Logger.log(`スクレイプ結果: 見出し${result.totalHeadings}個, アフィリエイトリンク${result.totalAffiliateLinks}個, CTAボックス${result.totalCtaBoxes}個`);

    return JSON.stringify(result, null, 2);

  } catch (e) {
    Logger.log(`スクレイプエラー: ${e.message}`);
    return null;
  }
}

// ============================================================
// GSC: 特定ページの上位キーワードを取得
// ============================================================
function fetchTopKeywordsForPage(pageUrl) {
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);

  const gscApiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(CONFIG.GSC_SITE_URL)}/searchAnalytics/query`;

  const payload = {
    startDate: dateRange.start,
    endDate: dateRange.end,
    dimensions: ['query'],
    dimensionFilterGroups: [
      {
        filters: [
          {
            dimension: 'page',
            operator: 'equals',
            expression: pageUrl,
          },
        ],
      },
    ],
    rowLimit: 10,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(gscApiUrl, options);
    if (response.getResponseCode() !== 200) {
      Logger.log(`GSCキーワード取得エラー: ${response.getResponseCode()}`);
      return [];
    }

    const data = JSON.parse(response.getContentText());
    if (!data.rows) return [];

    return data.rows.map(row => ({
      keyword: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      position: Math.round(row.position * 10) / 10,
    }));

  } catch (e) {
    Logger.log(`GSCキーワード取得エラー: ${e.message}`);
    return [];
  }
}

// ============================================================
// 検索意図を推定
// ============================================================
function estimateSearchIntent(keywords) {
  if (!keywords || keywords.length === 0) return '不明';

  const topKw = keywords[0].keyword;

  if (/申し込み|申込|審査|手続き|開設|契約|登録/.test(topKw)) {
    return '申込';
  }

  if (/おすすめ|比較|ランキング|人気|選び方|どこ|どれ|最安|一覧/.test(topKw)) {
    return '比較検討';
  }

  if (/とは|仕組み|意味|メリット|デメリット|違い|方法|やり方|始め方|初心者/.test(topKw)) {
    return '情報収集';
  }

  return '比較検討';
}

// ============================================================
// Claude API呼び出し
// ============================================================
function callClaudeDiagnosis(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  const articleCategory = detectArticleCategory(params.articleUrl);
  const systemPrompt = buildSystemPrompt(params.partnerList, articleCategory);
  const userPrompt = buildUserPrompt(params);

  const requestBody = {
    model: CLAUDE_CONFIG.MODEL,
    max_tokens: CLAUDE_CONFIG.MAX_TOKENS,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, options);
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      Logger.log(`Claude APIエラー: ${responseCode} - ${response.getContentText().substring(0, 300)}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    const text = data.content[0].text;

    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const diagnosis = JSON.parse(jsonStr);
    return diagnosis;

  } catch (e) {
    Logger.log(`Claude API呼び出しエラー: ${e.message}`);
    return null;
  }
}

// ============================================================
// システムプロンプト
// ============================================================
function buildSystemPrompt(partnerList, articleCategory) {
  const partnerListText = formatPartnerListForPrompt(partnerList, articleCategory);

  return `あなたは金融アフィリエイトメディアのCVR最適化の専門家です。
記事のCTA配置・訴求・デザイン・ユーザー導線を、以下の判断基準に基づいて診断してください。

## 重要な制約（必ず守ること）

### 制約A: 固定CTAは診断対象外
記事冒頭の「結論：○○がおすすめ」CTAボックスや、プラグインで全記事共通に挿入される固定CTA・比較表は、記事単位で変更できない。これらは診断対象外とし、問題として指摘しない。
診断対象は、記事個別に設置・調整可能なCTAのみ。

### 制約B: 提携済み案件のみ推奨可能
以下が現在提携済みの案件リストである。改善案でCTAを提案する場合、このリストに含まれる案件のみを推奨すること。
リストにない案件を推奨する場合は、該当するchangeオブジェクトに "requires_partnership": true を追加すること。

${partnerListText}

### 制約C: CTAテンプレートの制約
現在利用可能なCTAの形式は以下の通り:
- 単品CTAボックス（1商品の紹介＋「詳細はこちら」ボタン）
- テキストリンク（本文中のアンカーテキストリンク）
- 冒頭固定CTA（変更不可）

上記にない形式のCTA（例：「統合的な比較検討CTA」「インタラクティブ診断」「比較表内の直接CTAボタン」等）を提案する場合は、該当するchangeオブジェクトに "requires_new_template": true を追加すること。

## 判断基準

### 配置（4項目）

1. 文脈CTA欠如
情報系の見出しの直下に、その文脈に合った案件CTAが設置されていない場合、機会損失と判定する。ただし、冒頭固定CTAは対象外。

2. CTA空白地帯
CTA同士の間に教育コンテンツが長く続き、ユーザーがCTAに接触しない区間が存在する場合、問題と判定する。画面3〜4スクロール以上CTAがない区間を空白地帯とみなす。

3. 意思決定直後のCTA欠如
比較表やメリット・デメリット解説の直後にCTAが設置されていない場合、問題と判定する。ただし、冒頭固定CTAの比較表は対象外。記事中の大きな比較表（10社比較等）のみを対象とする。

4. 購買ピーク無視
記事内で購買意欲がピークになるポイントにCTAが未設置の場合、問題と判定する。

### 訴求（4項目）

5. 検索意図とCTA訴求の不一致
検索意図と、記事個別CTAの訴求内容がズレている場合、問題と判定する。
- 既にサービスを利用中のユーザー向けKW（例：確定申告、損失繰越）→ 新規口座開設だけでなく、乗り換え・追加口座・機能面の訴求が有効
- 情報収集段階 → いきなり特定商品の結論CTAは早すぎる
- 比較検討段階 → 比較軸のない単品CTAは弱い

6. マイクロコピー不足
CTAボタン文言は「詳細はこちら」固定。ボタン前後のマイクロコピーでユーザー心理に合わせた文脈補強ができていない場合、問題と判定する。

7. 差別化要素の弱さ
CTAボックス内の訴求が機能的特徴の羅列のみで、「なぜこの商品か」の選択理由が不十分な場合、問題と判定する。

8. 文脈と推し案件の属性不一致
記事の直前セクションのカテゴリとCTAの案件属性が一致していない場合、問題と判定する。

### デザイン・構造（2項目）

9. CTAボックスの視認性不足
CTAボックスが本文に埋もれている場合、問題と判定する。

10. ボタン周辺の後押し不足
「詳細はこちら」ボタンの前後にマイクロコピーがない場合、問題と判定する。

### ユーザー行動（2項目）

11. 途中離脱対策の欠如
記事前半〜中盤（30%地点まで）にCTAがない場合、問題と判定する。ただし冒頭固定CTAは対象外。

12. 比較導線の断絶
比較表内にCTAリンクが設置されていない場合、問題と判定する。

## 改善案の生成ルール

- 改善案は必ず3パターン生成する
  - plan_a: 保守的な改善（既存CTAテンプレートの範囲内。単品CTAボックスやテキストリンクの追加・マイクロコピー調整）
  - plan_b: 積極的な改善（CTA配置の再設計、訴求軸の変更。既存テンプレートを優先するが、必要なら新テンプレートも提案可）
  - plan_c: 構造変更（セクション順序変更、記事構成レベルの改善。新テンプレートの提案を含む）
- 景品表示法・金融商品取引法に抵触する表現は提案しない
- 「最安」「業界No.1」等の根拠なき最上級表現は使用しない
- CTAボタンの文言は「詳細はこちら」固定。変更を提案しない
- plan_aでは必ず既存テンプレート（単品CTAボックス・テキストリンク）のみ使用すること
- 提携済み案件リストにない案件を推奨する場合は requires_partnership: true を付与
- 既存にないCTAテンプレートを提案する場合は requires_new_template: true を付与

## 未提携案件の検出

記事内で紹介・言及されているが、提携済み案件リストに含まれない商品・サービスがある場合、partnership_recommendationsに出力すること。
- 記事内で名前が挙がっている商品・サービスのうち、提携済みリストにslugが存在しないものを検出する
- その案件と提携した場合のCVR改善インパクトが見込めるかを判断する
- インパクトが見込める案件のみを推奨する（記事内で触れているだけで誘導の必要がないものは除外）

## 出力形式

JSON以外のテキストは出力しないでください。マークダウンのコードブロックも不要です。

{
  "article_url": "記事URL",
  "search_intent_estimate": "情報収集 | 比較検討 | 申込",
  "problems": [
    {
      "criterion_number": 1,
      "criterion_name": "該当する基準名",
      "location": "問題箇所の具体的な位置（見出し名やセクション名）",
      "description": "何が問題か"
    }
  ],
  "plan_a": {
    "label": "保守的な改善",
    "summary": "改善の方針を1文で",
    "changes": [
      {
        "location": "変更箇所",
        "current": "現状の状態",
        "proposed": "提案する変更内容",
        "rationale": "なぜこの変更が有効か",
        "recommended_partner": "推奨案件のslug（提携済みリストから）",
        "requires_partnership": false,
        "requires_new_template": false
      }
    ]
  },
  "plan_b": {
    "label": "積極的な改善",
    "summary": "改善の方針を1文で",
    "changes": [
      {
        "location": "変更箇所",
        "current": "現状の状態",
        "proposed": "提案する変更内容",
        "rationale": "なぜこの変更が有効か",
        "recommended_partner": "推奨案件のslug",
        "requires_partnership": false,
        "requires_new_template": false
      }
    ]
  },
  "plan_c": {
    "label": "構造変更",
    "summary": "改善の方針を1文で",
    "changes": [
      {
        "location": "変更箇所",
        "current": "現状の状態",
        "proposed": "提案する変更内容",
        "rationale": "なぜこの変更が有効か",
        "recommended_partner": "推奨案件のslug",
        "requires_partnership": false,
        "requires_new_template": false
      }
    ]
  },
  "partnership_recommendations": [
    {
      "service_name": "未提携の商品・サービス名",
      "mentioned_at": "記事内での言及箇所",
      "reason": "提携すべき理由",
      "estimated_asp": "推定ASP（不明なら空文字）"
    }
  ]
}`;
}

// ============================================================
// ユーザープロンプト
// ============================================================
function buildUserPrompt(params) {
  const keywordsText = params.topKeywords.length > 0
    ? params.topKeywords.map(k => `${k.keyword}（クリック${k.clicks}, 表示${k.impressions}, 順位${k.position}）`).join('\n')
    : 'データなし';

  return `以下の記事を診断してください。

【記事情報】
- 記事URL: ${params.articleUrl}
- 主要流入キーワード:
${keywordsText}
- GSC表示回数（過去28日）: ${params.impressions}
- GSCクリック数（過去28日）: ${params.clicks}
- affiliate_click数（過去28日）: ${params.affiliateClicks}
- 推定検索意図: ${params.searchIntent}

【記事のCTA構造】
${params.ctaStructure}`;
}

// ============================================================
// 出力フォーマット
// ============================================================
function formatProblems(problems) {
  if (!problems || problems.length === 0) return '問題なし';
  return problems.map(p =>
    `[基準${p.criterion_number}] ${p.criterion_name}\n場所: ${p.location}\n内容: ${p.description}`
  ).join('\n\n');
}

function formatPlan(plan) {
  if (!plan) return '';
  const header = `【${plan.label}】${plan.summary}\n`;
  const changes = plan.changes.map(c => {
    let line = `・${c.location}: ${c.proposed}（理由: ${c.rationale}）`;
    if (c.recommended_partner) line += `\n  → 推奨案件: ${c.recommended_partner}`;
    if (c.requires_partnership) line += '\n  ⚠ 要提携確認';
    if (c.requires_new_template) line += '\n  ⚠ 要テンプレート開発';
    return line;
  }).join('\n');
  return header + changes;
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

// 記事URLからカテゴリを判定
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

// ============================================================
// テスト用関数
// ============================================================
function testGA4Connection() {
  const dateRange = getDateRange(7);
  Logger.log(`テスト期間: ${dateRange.start} 〜 ${dateRange.end}`);

  try {
    const data = fetchGA4AffiliateClicks(dateRange);
    Logger.log('GA4接続成功');
    Logger.log(`取得記事数: ${Object.keys(data).length}`);
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    entries.slice(0, 5).forEach(([url, clicks]) => {
      Logger.log(`  ${url}: ${clicks} clicks`);
    });
  } catch (e) {
    Logger.log(`GA4接続エラー: ${e.message}`);
  }
}

function testGSCConnection() {
  const dateRange = getDateRange(7);
  Logger.log(`テスト期間: ${dateRange.start} 〜 ${dateRange.end}`);

  try {
    const data = fetchGSCData(dateRange);
    Logger.log('GSC接続成功');
    Logger.log(`取得記事数: ${Object.keys(data).length}`);
    const entries = Object.entries(data).sort((a, b) => b[1].gscClicks - a[1].gscClicks);
    entries.slice(0, 5).forEach(([url, d]) => {
      Logger.log(`  ${url}: ${d.gscClicks} clicks, pos ${Math.round(d.position * 10) / 10}`);
    });
  } catch (e) {
    Logger.log(`GSC接続エラー: ${e.message}`);
  }
}

function testFullFlow() {
  Logger.log('=== 統合テスト開始 ===');
  runWeeklyReport();
  Logger.log('=== 統合テスト完了 ===');
}

function testThirstyLinks() {
  Logger.log('=== ThirstyAffiliates取得テスト ===');
  const links = fetchAllThirstyLinks();
  Logger.log(`総件数: ${links.length}`);
  links.slice(0, 10).forEach(l => {
    Logger.log(`  ${l.slug}: ${l.name}`);
  });
  Logger.log('=== テスト完了 ===');
}

function testCategoryDetection() {
  const testUrls = [
    'https://www.soico.jp/no1/news/cardloan/13595',
    'https://www.soico.jp/no1/news/fx/24297',
    'https://www.soico.jp/no1/news/cryptocurrency/20150',
    'https://www.soico.jp/no1/news/securities/5804',
    'https://www.soico.jp/no1/news/hiring/881',
  ];

  Logger.log('=== カテゴリ判定テスト ===');
  testUrls.forEach(url => {
    const cat = detectArticleCategory(url);
    Logger.log(`  ${url} → ${cat}`);
  });

  // 案件フィルタテスト
  const partnerList = fetchAllThirstyLinks();
  Logger.log(`\n総案件数: ${partnerList.length}`);

  ['cardloan', 'fx', 'cryptocurrency', 'securities', 'realestate'].forEach(cat => {
    const text = formatPartnerListForPrompt(partnerList, cat);
    const relevantCount = (text.match(/slug:/g) || []).length;
    Logger.log(`  ${cat}: ${relevantCount}件の関連案件`);
  });

  Logger.log('=== テスト完了 ===');
}

function testSingleDiagnosis() {
  const testUrl = 'https://www.soico.jp/no1/news/cardloan/13595';
  Logger.log(`=== 単体診断テスト: ${testUrl} ===`);

  Logger.log('--- 提携済み案件取得 ---');
  const partnerList = fetchAllThirstyLinks();
  Logger.log(`提携済み案件: ${partnerList.length} 件`);

  const cat = detectArticleCategory(testUrl);
  Logger.log(`記事カテゴリ: ${cat}`);

  Logger.log('--- スクレイプ ---');
  const ctaStructure = scrapeCtaStructure(testUrl);
  if (!ctaStructure) {
    Logger.log('スクレイプ失敗。終了。');
    return;
  }

  Logger.log('--- キーワード取得 ---');
  const keywords = fetchTopKeywordsForPage(testUrl);
  Logger.log(`キーワード数: ${keywords.length}`);
  keywords.slice(0, 3).forEach(k => Logger.log(`  ${k.keyword}: ${k.clicks} clicks`));

  const intent = estimateSearchIntent(keywords);
  Logger.log(`推定検索意図: ${intent}`);

  Logger.log('--- Claude API診断 ---');
  const diagnosis = callClaudeDiagnosis({
    articleUrl: testUrl,
    topKeywords: keywords,
    impressions: 1000,
    clicks: 100,
    affiliateClicks: 5,
    searchIntent: intent,
    ctaStructure: ctaStructure,
    partnerList: partnerList,
  });

  if (diagnosis) {
    Logger.log('診断成功');
    Logger.log(`問題数: ${diagnosis.problems.length}`);
    Logger.log(`Plan A: ${diagnosis.plan_a.summary}`);
    Logger.log(`Plan B: ${diagnosis.plan_b.summary}`);
    Logger.log(`Plan C: ${diagnosis.plan_c.summary}`);
    if (diagnosis.partnership_recommendations && diagnosis.partnership_recommendations.length > 0) {
      Logger.log(`提携推奨: ${diagnosis.partnership_recommendations.length}件`);
      diagnosis.partnership_recommendations.forEach(r => {
        Logger.log(`  ${r.service_name}: ${r.reason}`);
      });
    } else {
      Logger.log('提携推奨: なし');
    }
  } else {
    Logger.log('診断失敗');
  }

  Logger.log('=== テスト完了 ===');
}
