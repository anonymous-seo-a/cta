// ============================================================
// SEOリライト: 設定
// ============================================================

const REWRITE_CONFIG = {
  MIN_POSITION: 4,
  MAX_POSITION: 20,
  MIN_CLICKS: 10,
  TOP_N_REWRITE: 10,
  COMPETITORS_PER_KW: 5,
  MAX_COMPETITORS_SCRAPE: 2,

  MAX_QUERIES_PER_RUN: 10,
  MIN_WAIT_MS: 15000,
  MAX_WAIT_MS: 30000,

  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  ],

  // Bot対策が厳しい・レスポンスが遅いサイト
  SKIP_DOMAINS: [
    'bitflyer.com', 'coincheck.com', 'zaif.jp', 'bitbank.cc',
    'gmo.jp', 'coin.z.com', 'dmm.com', 'rakuten-sec.co.jp', 'sbisec.co.jp',
    'acom.co.jp', 'promise.co.jp', 'aiful.co.jp', 'mobit.ne.jp',
    'instagram.com', 'tiktok.com', 'line.me', 'apps.apple.com',
    'play.google.com', 'note.com',
  ],

  REWRITE_MODEL: 'claude-sonnet-4-20250514',
  REWRITE_MAX_TOKENS: 4096,
  MAX_CONTENT_SUMMARY: 1500,
  MAX_ARTICLES_PER_RUN: 1,

  REWRITE_SHEET_PREFIX: 'rewrite_',
  REWRITE_PLAN_SHEET: 'rewrite_plan',
  COMPETITOR_CACHE_SHEET: 'competitor_cache',
};

// ============================================================
// Phase 1: 競合URL取得
// ============================================================
function runRewritePhase1() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cacheSheet = ss.getSheetByName(REWRITE_CONFIG.COMPETITOR_CACHE_SHEET);

  if (!cacheSheet) {
    Logger.log('=== リライト候補選定（gsc_masterから） ===');
    const candidates = getRewriteCandidates(REWRITE_CONFIG.TOP_N_REWRITE);

    if (candidates.length === 0) {
      Logger.log('リライト候補がありません。refreshGscMasterを実行済みか確認してください。');
      return;
    }

    Logger.log(`候補: ${candidates.length}件`);
    cacheSheet = createCompetitorCacheSheet(ss, candidates);
    Logger.log('キャッシュシート作成完了。');
  }

  const lastRow = cacheSheet.getLastRow();
  if (lastRow < 2) return;

  const data = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  let queriesExecuted = 0;

  for (let i = 0; i < data.length; i++) {
    if (queriesExecuted >= REWRITE_CONFIG.MAX_QUERIES_PER_RUN) {
      Logger.log(`クエリ上限到達 (${queriesExecuted}件)。残りは次回実行。`);
      break;
    }

    const status = data[i][6];
    if (status === '取得済み' || status === '分析済み') continue;

    const keyword = data[i][2];
    const rowNum = i + 2;

    Logger.log(`--- 競合取得 [${queriesExecuted + 1}]: ${keyword} ---`);

    const competitors = fetchCompetitorUrlsFromYahoo(keyword);

    if (competitors.length > 0) {
      cacheSheet.getRange(rowNum, 6).setValue(JSON.stringify(competitors));
      cacheSheet.getRange(rowNum, 7).setValue('取得済み');
      Logger.log(`  ${competitors.length}件取得成功`);
    } else {
      cacheSheet.getRange(rowNum, 7).setValue('取得失敗');
      Logger.log('  取得失敗');
    }

    queriesExecuted++;

    if (queriesExecuted < REWRITE_CONFIG.MAX_QUERIES_PER_RUN) {
      const waitMs = REWRITE_CONFIG.MIN_WAIT_MS +
        Math.random() * (REWRITE_CONFIG.MAX_WAIT_MS - REWRITE_CONFIG.MIN_WAIT_MS);
      Logger.log(`  待機: ${Math.round(waitMs / 1000)}秒`);
      Utilities.sleep(waitMs);
    }
  }

  const updatedData = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const remaining = updatedData.filter(row =>
    row[6] !== '取得済み' && row[6] !== '分析済み' && row[6] !== '取得失敗'
  ).length;

  if (remaining === 0) {
    Logger.log('=== 全競合URL取得完了。runRewritePhase2 を実行してください。 ===');
  } else {
    Logger.log(`=== 残り${remaining}件。再度 runRewritePhase1 を実行してください。 ===`);
  }
}

// ============================================================
// Phase 2: 競合分析 + リライト案生成（1記事/実行）
// ============================================================
function runRewritePhase2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dateRange = getDateRange(CONFIG.DATE_RANGE_DAYS);
  const cacheSheet = ss.getSheetByName(REWRITE_CONFIG.COMPETITOR_CACHE_SHEET);

  if (!cacheSheet) {
    Logger.log('competitor_cacheシートが見つかりません。先にrunRewritePhase1を実行してください。');
    return;
  }

  const lastRow = cacheSheet.getLastRow();
  if (lastRow < 2) return;

  const data = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const START_TIME = new Date().getTime();
  const elapsed = () => Math.round((new Date().getTime() - START_TIME) / 1000);

  // 「分析中」リセット
  for (let i = 0; i < data.length; i++) {
    if (data[i][6] === '分析中') {
      Logger.log(`リセット: [${i}] ${data[i][0].substring(0, 60)} (分析中→取得済み)`);
      cacheSheet.getRange(i + 2, 7).setValue('取得済み');
      data[i][6] = '取得済み';
    }
  }

  // gsc_masterを1回だけ読み込み
  const gscPages = readGscMaster();
  Logger.log(`gsc_master: ${gscPages.length}件 (${elapsed()}秒)`);

  const results = [];
  let processedThisRun = 0;

  const pendingCount = data.filter(row => row[6] === '取得済み').length;
  Logger.log(`処理対象: ${pendingCount}件（1回最大${REWRITE_CONFIG.MAX_ARTICLES_PER_RUN}件）`);

  for (let i = 0; i < data.length; i++) {
    if (processedThisRun >= REWRITE_CONFIG.MAX_ARTICLES_PER_RUN) {
      Logger.log(`記事数上限到達。残りは次回実行。`);
      break;
    }

    const status = data[i][6];
    if (status !== '取得済み') continue;

    const pageUrl = data[i][0];
    const keyword = data[i][2];
    const position = data[i][3];
    const clicks = data[i][4];
    const impressions = data[i][1];
    const competitorJson = data[i][5];
    const rowNum = i + 2;

    Logger.log(`\n========================================`);
    Logger.log(`[${elapsed()}秒] 分析開始: ${pageUrl}`);
    Logger.log(`  KW: ${keyword}, 順位: ${position}`);
    Logger.log(`========================================`);

    cacheSheet.getRange(rowNum, 7).setValue('分析中');

    try {
      // A: 競合JSONパース
      const competitors = JSON.parse(competitorJson);
      Logger.log(`[A] 競合JSONパース: ${competitors.length}件`);

      // B: 自サイトスクレイプ
      const stepB = new Date().getTime();
      const ownStructure = scrapeArticleStructureRewrite(pageUrl);
      Logger.log(`[B] 自サイトスクレイプ: ${new Date().getTime() - stepB}ms, 見出し: ${ownStructure ? ownStructure.headingCount : 'null'}`);

      if (!ownStructure) {
        cacheSheet.getRange(rowNum, 7).setValue('スクレイプ失敗');
        processedThisRun++;
        continue;
      }

      // C: 競合スクレイプ（成功するまで順番に試行）
      const competitorStructures = [];
      for (let j = 0; j < competitors.length && competitorStructures.length < REWRITE_CONFIG.MAX_COMPETITORS_SCRAPE; j++) {
        const compUrl = competitors[j].url;
        const stepC = new Date().getTime();
        Logger.log(`[C${j}] 競合: ${compUrl.substring(0, 80)}...`);

        const comp = scrapeArticleStructureRewrite(compUrl);
        const ms = new Date().getTime() - stepC;

        if (comp) {
          Logger.log(`[C${j}] OK: ${ms}ms, 見出し${comp.headingCount}`);
          competitorStructures.push({
            url: compUrl,
            title: competitors[j].title || comp.title,
            rank: competitorStructures.length + 1,
            structure: comp,
          });
        } else {
          Logger.log(`[C${j}] NG: ${ms}ms → 次の競合を試行`);
        }
        Utilities.sleep(500);
      }

      Logger.log(`[C] 競合完了: ${competitorStructures.length}件成功`);

      if (competitorStructures.length === 0) {
        cacheSheet.getRange(rowNum, 7).setValue('競合スクレイプ失敗');
        processedThisRun++;
        continue;
      }

      // D: gsc_masterからKW取得
      const pageGscData = gscPages.find(p => p.page === pageUrl);
      const allKeywords = pageGscData ? pageGscData.keywords : [];
      Logger.log(`[D] KW: ${allKeywords.length}件`);

      // E: Claude API
      Logger.log(`[E] Claude API開始... (${elapsed()}秒経過)`);
      const stepE = new Date().getTime();

      const rewritePlan = callClaudeRewrite({
        articleUrl: pageUrl,
        topKeyword: keyword,
        allKeywords: allKeywords,
        position: position,
        clicks: clicks,
        impressions: impressions,
        ownStructure: ownStructure,
        competitors: competitorStructures,
      });

      Logger.log(`[E] Claude API完了: ${Math.round((new Date().getTime() - stepE) / 1000)}秒`);

      if (rewritePlan) {
        results.push({
          url: pageUrl,
          postId: extractPostId(pageUrl),
          keyword: keyword,
          position: position,
          clicks: clicks,
          impressions: impressions,
          competitorCount: competitorStructures.length,
          rewritePlan: rewritePlan,
        });
        cacheSheet.getRange(rowNum, 7).setValue('分析済み');
        Logger.log(`★ 成功 (トータル${elapsed()}秒)`);
      } else {
        cacheSheet.getRange(rowNum, 7).setValue('分析失敗');
        Logger.log(`✗ 失敗 (トータル${elapsed()}秒)`);
      }
      processedThisRun++;

    } catch (e) {
      Logger.log(`✗ エラー: ${e.message}`);
      cacheSheet.getRange(rowNum, 7).setValue('エラー: ' + e.message.substring(0, 50));
      processedThisRun++;
    }
  }

  if (results.length > 0) {
    writeRewriteResultSheet(ss, results, dateRange);
    writeRewritePlanSheet(ss, results);
  }

  const remainingData = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const remainingCount = remainingData.filter(row => row[6] === '取得済み').length;
  Logger.log(`\n=== Phase2完了: ${results.length}件分析、残り${remainingCount}件 ===`);
}

// ============================================================
// Phase 3: 承認済みリライトをWordPressに反映
// ============================================================
function applyApprovedRewrites() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REWRITE_CONFIG.REWRITE_PLAN_SHEET);
  if (!sheet) { Logger.log('rewrite_planシートが見つかりません。'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  let applied = 0;

  for (let i = 0; i < data.length; i++) {
    const url = data[i][0];
    const postId = data[i][1];
    const status = data[i][7];
    if (status !== '承認') continue;

    Logger.log(`--- リライト反映: ${url} (ID: ${postId}) ---`);

    const postData = fetchWpPost(postId);
    if (!postData) { sheet.getRange(i + 2, 8).setValue('取得失敗'); continue; }

    const currentContent = postData.content.raw;
    const rewriteSheet = getLatestRewriteSheet(ss);
    const fullData = rewriteSheet ? getRewriteDataForUrl(rewriteSheet, url) : null;
    if (!fullData) { sheet.getRange(i + 2, 8).setValue('データ不足'); continue; }

    const rewrittenContent = applyRewriteToContent(currentContent, fullData);
    if (!rewrittenContent || rewrittenContent === currentContent) {
      sheet.getRange(i + 2, 8).setValue('適用失敗'); continue;
    }

    if (updateWpPost(postId, rewrittenContent)) {
      Logger.log('更新成功');
      sheet.getRange(i + 2, 8).setValue('反映済み');
      applied++;
    } else {
      sheet.getRange(i + 2, 8).setValue('更新失敗');
    }
    Utilities.sleep(1000);
  }

  Logger.log(`=== リライト反映完了: ${applied}件 ===`);
}

// ============================================================
// Yahoo検索スクレイプ
// ============================================================
function fetchCompetitorUrlsFromYahoo(keyword) {
  const query = encodeURIComponent(keyword);
  const searchUrl = `https://search.yahoo.co.jp/search?p=${query}&n=10`;
  const ua = REWRITE_CONFIG.USER_AGENTS[Math.floor(Math.random() * REWRITE_CONFIG.USER_AGENTS.length)];

  try {
    const response = UrlFetchApp.fetch(searchUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
    if (response.getResponseCode() !== 200) {
      Logger.log(`Yahoo検索エラー: ${response.getResponseCode()}`);
      return [];
    }
    return parseYahooSearchResults(response.getContentText('UTF-8'));
  } catch (e) {
    Logger.log(`Yahoo検索例外: ${e.message}`);
    return [];
  }
}

// ============================================================
// Yahoo検索結果パース
// ============================================================
function parseYahooSearchResults(html) {
  const results = [];
  const seen = new Set();

  const excludeDomains = [
    'soico.jp', 'yahoo.co.jp', 'yahoo-net.jp', 'yimg.jp', 'yimg.com',
    'google.com', 'google.co.jp', 'bing.com', 'msn.com',
    'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
    'amazon.co.jp', 'wikipedia.org',
    'support.yahoo', 'lycbiz.jp', 'lycorp.co.jp',
  ];
  const excludeExtensions = ['.css', '.js', '.ico', '.png', '.jpg', '.gif', '.svg', '.woff'];

  function isValidResult(url) {
    if (!url || url.length < 20) return false;
    for (const d of excludeDomains) { if (url.includes(d)) return false; }
    for (const e of excludeExtensions) { if (url.toLowerCase().endsWith(e)) return false; }
    return true;
  }

  let match;

  // パターン1: data-url
  const p1 = /data-url="(https?:\/\/[^"]+)"/gi;
  while ((match = p1.exec(html)) !== null) {
    const url = match[1];
    if (!isValidResult(url) || seen.has(url)) continue;
    seen.add(url);
    const ctx = html.substring(Math.max(0, match.index - 500), Math.min(html.length, match.index + 500));
    const tm = ctx.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    results.push({ url, title: tm ? tm[1].replace(/<[^>]+>/g, '').trim() : '', snippet: '', rank: results.length + 1 });
    if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
  }

  // パターン2: h3リンク
  if (results.length === 0) {
    const p2 = /<h3[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi;
    while ((match = p2.exec(html)) !== null) {
      const url = match[1];
      if (!isValidResult(url) || seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: match[2].replace(/<[^>]+>/g, '').trim(), snippet: '', rank: results.length + 1 });
      if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
    }
  }

  // パターン3: リダイレクトURL
  if (results.length === 0) {
    const p3 = /\/RU=(https?%3A%2F%2F[^\/]+[^"]*)\//gi;
    while ((match = p3.exec(html)) !== null) {
      try {
        const url = decodeURIComponent(match[1]);
        if (!isValidResult(url) || seen.has(url)) continue;
        seen.add(url);
        results.push({ url, title: '', snippet: '', rank: results.length + 1 });
        if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
      } catch (e) {}
    }
  }

  // パターン4: 広範囲
  if (results.length === 0) {
    const p4 = /href="(https?:\/\/[^"]{20,})"/gi;
    while ((match = p4.exec(html)) !== null) {
      const url = match[1];
      if (!isValidResult(url) || seen.has(url)) continue;
      seen.add(url);
      results.push({ url, title: '', snippet: '', rank: results.length + 1 });
      if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
    }
  }

  return results;
}

// ============================================================
// 記事スクレイプ（リライト用・Bot対策サイト除外付き）
// main.gsのscrapeCtaStructureとは別関数として定義
// ============================================================
function scrapeArticleStructureRewrite(url) {
  // Bot対策サイト除外
  for (const domain of REWRITE_CONFIG.SKIP_DOMAINS) {
    if (url.includes(domain)) {
      Logger.log(`  除外（Bot対策）: ${domain}`);
      return null;
    }
  }

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`  HTTP ${response.getResponseCode()}: ${url.substring(0, 60)}`);
      return null;
    }

    const html = response.getContentText('UTF-8');

    if (html.length > 5000000) {
      Logger.log(`  HTML巨大（${Math.round(html.length / 1000000)}MB）。スキップ。`);
      return null;
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

    const headings = [];
    const headingRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = headingRegex.exec(html)) !== null) {
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (text.length > 0 && text.length < 200) {
        headings.push({ level: parseInt(m[1]), text });
      }
    }

    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let totalLength = 0;
    const maxLen = REWRITE_CONFIG.MAX_CONTENT_SUMMARY;
    while ((m = pRegex.exec(html)) !== null && totalLength < maxLen) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 20) { paragraphs.push(text); totalLength += text.length; }
    }

    return {
      title, h1, headings,
      headingCount: headings.length,
      contentSummary: paragraphs.slice(0, 10).join('\n'),
      totalParagraphs: paragraphs.length,
    };
  } catch (e) {
    Logger.log(`  スクレイプエラー: ${e.message.substring(0, 80)}`);
    return null;
  }
}

// ============================================================
// Claude API: リライト案生成
// ============================================================
function callClaudeRewrite(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  const systemPrompt = buildRewriteSystemPrompt();
  const userPrompt = buildRewriteUserPrompt(params);

  Logger.log(`  プロンプト: system=${systemPrompt.length}字, user=${userPrompt.length}字`);

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: REWRITE_CONFIG.REWRITE_MODEL,
        max_tokens: REWRITE_CONFIG.REWRITE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`  Claude APIエラー: ${response.getResponseCode()} - ${response.getContentText().substring(0, 200)}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    if (data.usage) Logger.log(`  トークン: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);

    const text = data.content[0].text;
    return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
  } catch (e) {
    Logger.log(`  Claude API例外: ${e.message}`);
    return null;
  }
}

// ============================================================
// リライト用プロンプト
// ============================================================
function buildRewriteSystemPrompt() {
  return `あなたは金融アフィリエイトメディアのSEOリライト専門家です。
自サイト記事と競合上位記事の構成を比較し、SEO順位を改善するための具体的なリライト案を生成してください。

## 分析の観点
1. 見出し構成の過不足（競合にあって自サイトにないトピック、逆も）
2. コンテンツの深さ（説明が浅い・不十分なセクション）
3. 検索意図との整合性
4. E-E-A-T要素

## 出力ルール
- 景品表示法・金融商品取引法に抵触する表現は提案しない
- 既存の良い部分は維持する
- 各変更にはSEO改善の根拠を付ける
- 見出し追加には内容概要（100〜200文字）を含める
- 本文書き換えには現在の文と改善後の文の両方を含める
- locationには自サイト記事内の正確な見出しテキストを使用
- 簡潔に出力すること

## 出力形式（JSON以外のテキストは出力しない）

{
  "article_url": "記事URL",
  "main_keyword": "メインKW",
  "current_position": 順位,
  "overall_assessment": "現状評価（2文）",
  "target_position": "目標順位",
  "missing_topics": [
    {
      "topic": "不足トピック名",
      "found_in": ["競合1位"],
      "suggested_heading": "追加見出し",
      "heading_level": 2,
      "insert_after": "挿入位置の既存見出し",
      "content_outline": "内容概要（100〜200文字）",
      "priority": "高 | 中 | 低",
      "seo_rationale": "理由（1文）"
    }
  ],
  "unnecessary_topics": [
    { "heading": "不要な見出し", "reason": "理由", "action": "削除 | 統合 | 簡略化" }
  ],
  "content_improvements": [
    {
      "location": "見出しテキスト",
      "issue": "問題点",
      "current_text": "現在の文（50文字以内）",
      "improved_text": "改善後の文",
      "seo_rationale": "理由（1文）"
    }
  ],
  "structure_changes": [
    { "type": "順序変更 | 階層変更 | 見出し名変更", "current": "現在", "proposed": "提案", "seo_rationale": "理由" }
  ],
  "priority_summary": "最優先の改善3つ"
}`;
}

function buildRewriteUserPrompt(params) {
  const ownHeadings = params.ownStructure.headings
    .map(h => `${'  '.repeat(h.level - 2)}${h.level === 2 ? '##' : '###'} ${h.text}`)
    .join('\n');

  const competitorTexts = params.competitors.map(c => {
    const headings = c.structure.headings
      .map(h => `${'  '.repeat(h.level - 2)}${h.level === 2 ? '##' : '###'} ${h.text}`)
      .join('\n');
    const summary = (c.structure.contentSummary || '').substring(0, 300);
    return `【競合${c.rank}位】${c.title}\nURL: ${c.url}\n見出し数: ${c.structure.headingCount}\n${headings}\n\n本文概要:\n${summary}`;
  }).join('\n\n---\n\n');

  const keywordsText = (params.allKeywords || []).slice(0, 10)
    .map(k => `${k.keyword}（クリック${k.clicks}, 順位${Math.round(k.position * 10) / 10}）`)
    .join('\n');

  const ownSummary = (params.ownStructure.contentSummary || '').substring(0, 800);

  return `以下の記事をリライト分析してください。

【自サイト記事】
URL: ${params.articleUrl}
タイトル: ${params.ownStructure.title}
見出し数: ${params.ownStructure.headingCount}
メインKW: ${params.topKeyword}
順位: ${params.position} / クリック: ${params.clicks} / 表示: ${params.impressions}

流入KW:
${keywordsText || '(なし)'}

見出し構造:
${ownHeadings}

本文概要:
${ownSummary}

---

【競合上位記事】
${competitorTexts}`;
}

// ============================================================
// リライトをコンテンツに適用
// ============================================================
function applyRewriteToContent(currentContent, rewriteData) {
  let content = currentContent;
  try {
    if (rewriteData.content_improvements) {
      for (const imp of rewriteData.content_improvements) {
        if (imp.current_text && imp.improved_text && content.includes(imp.current_text)) {
          content = content.replace(imp.current_text, imp.improved_text);
          Logger.log(`本文置換: ${imp.location}`);
        }
      }
    }

    if (rewriteData.missing_topics) {
      const sorted = rewriteData.missing_topics
        .filter(t => t.priority === '高')
        .concat(rewriteData.missing_topics.filter(t => t.priority === '中'));

      for (const topic of sorted) {
        if (!topic.insert_after || !topic.suggested_heading) continue;
        const insertPos = findSectionEndInsertPosition(content, topic.insert_after);
        if (insertPos >= 0) {
          const level = topic.heading_level || 2;
          const newBlock = `\n\n<!-- wp:heading${level === 3 ? ' {"level":3}' : ''} -->\n<h${level} class="wp-block-heading">${topic.suggested_heading}</h${level}>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>${topic.content_outline}</p>\n<!-- /wp:paragraph -->`;
          content = content.substring(0, insertPos) + newBlock + content.substring(insertPos);
          Logger.log(`見出し追加: ${topic.suggested_heading}`);
        }
      }
    }
    return content;
  } catch (e) {
    Logger.log(`リライト適用エラー: ${e.message}`);
    return null;
  }
}

// ============================================================
// シート操作
// ============================================================
function createCompetitorCacheSheet(ss, candidates) {
  const sheetName = REWRITE_CONFIG.COMPETITOR_CACHE_SHEET;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = ['記事URL', '表示回数', 'トップKW', '順位', 'クリック数', '競合データ', 'ステータス'];
  sheet.getRange(1, 1, 1, 7).setValues([headers]);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#FF6F00').setFontColor('#FFFFFF');

  const rows = candidates.map(c => [c.page, c.impressions, c.topKeyword, c.position, c.clicks, '', '未取得']);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  sheet.setColumnWidth(1, 400); sheet.setColumnWidth(3, 200); sheet.setColumnWidth(6, 500);
  return sheet;
}

function writeRewriteResultSheet(ss, results, dateRange) {
  const sheetName = REWRITE_CONFIG.REWRITE_SHEET_PREFIX + dateRange.end;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const h = ['記事URL','投稿ID','メインKW','現在順位','クリック数','表示回数','競合数','総合評価','目標順位','不足トピック','不要トピック','本文改善','構造変更','優先改善'];
    sheet.getRange(1, 1, 1, 14).setValues([h]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 400); sheet.setColumnWidth(8, 400);
    sheet.setColumnWidth(10, 500); sheet.setColumnWidth(12, 500); sheet.setColumnWidth(14, 400);
  }
  const nextRow = sheet.getLastRow() + 1;
  const rows = results.map(r => {
    const p = r.rewritePlan;
    return [r.url, r.postId, r.keyword, r.position, r.clicks, r.impressions, r.competitorCount,
      p.overall_assessment||'', p.target_position||'',
      formatMissingTopics(p.missing_topics), formatUnnecessaryTopics(p.unnecessary_topics),
      formatContentImprovements(p.content_improvements), formatStructureChanges(p.structure_changes),
      p.priority_summary||''];
  });
  if (rows.length > 0) sheet.getRange(nextRow, 1, rows.length, 14).setValues(rows);
  Logger.log(`「${sheetName}」に${rows.length}件追記`);
}

function writeRewritePlanSheet(ss, results) {
  const sheetName = REWRITE_CONFIG.REWRITE_PLAN_SHEET;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const h = ['記事URL','投稿ID','メインKW','現在順位','リライト概要','不足トピック数','本文改善数','ステータス'];
    sheet.getRange(1, 1, 1, 8).setValues([h]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 400); sheet.setColumnWidth(5, 500); sheet.setColumnWidth(8, 100);
    const sr = sheet.getRange(2, 8, 100, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認待ち').setBackground('#E8F5E9').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('反映済み').setBackground('#BBDEFB').setRanges([sr]).build(),
    ]);
  }
  const nextRow = sheet.getLastRow() + 1;
  const rows = results.map(r => {
    const p = r.rewritePlan;
    return [r.url, r.postId, r.keyword, r.position, p.priority_summary||'',
      (p.missing_topics||[]).length, (p.content_improvements||[]).length, '承認待ち'];
  });
  if (rows.length > 0) sheet.getRange(nextRow, 1, rows.length, 8).setValues(rows);
  Logger.log(`「${sheetName}」に${rows.length}件追記`);
}

function getLatestRewriteSheet(ss) {
  const sheets = ss.getSheets().filter(s => s.getName().startsWith(REWRITE_CONFIG.REWRITE_SHEET_PREFIX));
  if (sheets.length === 0) return null;
  sheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  return sheets[0];
}

function getRewriteDataForUrl(sheet, url) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  for (const row of data) {
    if (row[0] === url) {
      return { missing_topics: parseMissingTopicsFromSheet(row[9]), content_improvements: parseImprovementsFromSheet(row[11]) };
    }
  }
  return null;
}

function parseMissingTopicsFromSheet(text) {
  if (!text || text === 'なし') return [];
  const topics = [];
  for (const section of text.split(/\n\n/)) {
    const hm = section.match(/\]\s*(.+)/);
    const cm = section.match(/内容:\s*(.+)/);
    if (hm) topics.push({
      suggested_heading: hm[1].trim(), content_outline: cm ? cm[1].trim() : '',
      insert_after: '', heading_level: 2,
      priority: section.includes('[高]') ? '高' : section.includes('[中]') ? '中' : '低',
    });
  }
  return topics;
}

function parseImprovementsFromSheet(text) {
  if (!text || text === 'なし') return [];
  const imps = [];
  for (const section of text.split(/\n\n/)) {
    const cm = section.match(/現在:\s*(.+?)(?:\.\.\.|$)/);
    const im = section.match(/改善:\s*(.+?)(?:\.\.\.|$)/);
    if (cm && im) imps.push({ current_text: cm[1].trim(), improved_text: im[1].trim() });
  }
  return imps;
}

// ============================================================
// 出力フォーマット
// ============================================================
function formatMissingTopics(t) {
  if (!t||!t.length) return 'なし';
  return t.map(x=>`[${x.priority}] ${x.suggested_heading}\n  競合: ${(x.found_in||[]).join(', ')}\n  内容: ${x.content_outline}\n  理由: ${x.seo_rationale}`).join('\n\n');
}
function formatUnnecessaryTopics(t) {
  if (!t||!t.length) return 'なし';
  return t.map(x=>`${x.action}: ${x.heading}\n  理由: ${x.reason}`).join('\n\n');
}
function formatContentImprovements(t) {
  if (!t||!t.length) return 'なし';
  return t.map(x=>`場所: ${x.location}\n  問題: ${x.issue}\n  現在: ${(x.current_text||'').substring(0,100)}...\n  改善: ${(x.improved_text||'').substring(0,100)}...\n  理由: ${x.seo_rationale}`).join('\n\n');
}
function formatStructureChanges(t) {
  if (!t||!t.length) return 'なし';
  return t.map(x=>`${x.type}: ${x.current} → ${x.proposed}\n  理由: ${x.seo_rationale}`).join('\n\n');
}

// ============================================================
// テスト
// ============================================================
function testYahooSearch() {
  Logger.log('=== Yahoo検索テスト ===');
  const r = fetchCompetitorUrlsFromYahoo('カードローン おすすめ');
  Logger.log(`取得: ${r.length}件`);
  r.forEach(x => Logger.log(`  [${x.rank}] ${x.title||'(不明)'} - ${x.url}`));
}

function testRewriteCandidates() {
  Logger.log('=== リライト候補テスト ===');
  const c = getRewriteCandidates(5);
  Logger.log(`候補: ${c.length}件`);
  c.forEach((x,i) => Logger.log(`  [${i+1}] ${x.page}\n      KW: ${x.topKeyword}, 順位: ${x.position}, スコア: ${Math.round(x.improvementScore)}`));
}

function testSingleRewrite() {
  Logger.log('=== 単体リライトテスト ===');
  const c = getRewriteCandidates(1);
  if (!c.length) { Logger.log('候補なし'); return; }
  const t = c[0];
  Logger.log(`対象: ${t.page} (KW: ${t.topKeyword})`);

  const comp = fetchCompetitorUrlsFromYahoo(t.topKeyword);
  Logger.log(`競合URL: ${comp.length}件`);

  const own = scrapeArticleStructureRewrite(t.page);
  Logger.log(`自サイト見出し: ${own ? own.headingCount : 0}件`);

  const cs = [];
  for (let j = 0; j < comp.length && cs.length < 1; j++) {
    const s = scrapeArticleStructureRewrite(comp[j].url);
    if (s) cs.push({ url: comp[j].url, title: comp[j].title||s.title, rank: 1, structure: s });
  }

  if (!own || !cs.length) { Logger.log('スクレイプ失敗'); return; }

  const plan = callClaudeRewrite({
    articleUrl: t.page, topKeyword: t.topKeyword, allKeywords: t.keywords,
    position: t.position, clicks: t.clicks, impressions: t.impressions,
    ownStructure: own, competitors: cs,
  });

  if (plan) {
    Logger.log(`評価: ${plan.overall_assessment}`);
    Logger.log(`不足: ${(plan.missing_topics||[]).length}件, 改善: ${(plan.content_improvements||[]).length}件`);
    Logger.log(`優先: ${plan.priority_summary}`);
  } else Logger.log('生成失敗');
}
