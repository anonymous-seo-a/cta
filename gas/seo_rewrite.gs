// ============================================================
// SEOリライト: 設定
// ============================================================

const REWRITE_CONFIG = {
  MIN_POSITION: 4,
  MAX_POSITION: 20,
  MIN_CLICKS: 10,
  TOP_N_REWRITE: 10,
  COMPETITORS_PER_KW: 5,

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

  REWRITE_MODEL: 'claude-sonnet-4-20250514',
  REWRITE_MAX_TOKENS: 8192,

  REWRITE_SHEET_PREFIX: 'rewrite_',
  REWRITE_PLAN_SHEET: 'rewrite_plan',
  COMPETITOR_CACHE_SHEET: 'competitor_cache',
};

// ============================================================
// Phase 1: 競合URL取得（gsc_masterから候補を読み、Yahoo検索で競合取得）
// ============================================================
function runRewritePhase1() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cacheSheet = ss.getSheetByName(REWRITE_CONFIG.COMPETITOR_CACHE_SHEET);

  if (!cacheSheet) {
    // gsc_masterからリライト候補を取得
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

  // 競合URL未取得の行を処理
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

  // 残件チェック
  const updatedData = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const remaining = updatedData.filter(row => row[6] !== '取得済み' && row[6] !== '分析済み' && row[6] !== '取得失敗').length;

  if (remaining === 0) {
    Logger.log('=== 全競合URL取得完了。runRewritePhase2 を実行してください。 ===');
  } else {
    Logger.log(`=== 残り${remaining}件。再度 runRewritePhase1 を実行してください。 ===`);
  }
}

// ============================================================
// Phase 2: 競合分析 + リライト案生成
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
  const TIME_LIMIT_MS = 5 * 60 * 1000;
  const results = [];

  for (let i = 0; i < data.length; i++) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${results.length}件完了。残りは次回実行。`);
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

    Logger.log(`--- リライト分析 [${results.length + 1}]: ${pageUrl} ---`);

    try {
      const competitors = JSON.parse(competitorJson);

      // 自サイト記事スクレイプ
      const ownStructure = scrapeArticleStructure(pageUrl);
      if (!ownStructure) {
        Logger.log('自サイトスクレイプ失敗');
        cacheSheet.getRange(rowNum, 7).setValue('スクレイプ失敗');
        continue;
      }

      // 競合記事スクレイプ（上位3記事）
      const competitorStructures = [];
      for (let j = 0; j < Math.min(competitors.length, 3); j++) {
        const comp = scrapeArticleStructure(competitors[j].url);
        if (comp) {
          competitorStructures.push({
            url: competitors[j].url,
            title: competitors[j].title || comp.title,
            rank: j + 1,
            structure: comp,
          });
        }
        Utilities.sleep(1000);
      }

      Logger.log(`競合スクレイプ: ${competitorStructures.length}件成功`);

      if (competitorStructures.length === 0) {
        cacheSheet.getRange(rowNum, 7).setValue('競合スクレイプ失敗');
        continue;
      }

      // gsc_masterからKW一覧を取得
      const gscPages = readGscMaster();
      const pageData = gscPages.find(p => p.page === pageUrl);
      const allKeywords = pageData ? pageData.keywords : [];

      // Claude APIでリライト案生成
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
        Logger.log('リライト案生成成功');
      } else {
        cacheSheet.getRange(rowNum, 7).setValue('分析失敗');
        Logger.log('リライト案生成失敗');
      }

      Utilities.sleep(2000);

    } catch (e) {
      Logger.log(`エラー: ${e.message}`);
      cacheSheet.getRange(rowNum, 7).setValue('エラー');
    }
  }

  if (results.length > 0) {
    writeRewriteResultSheet(ss, results, dateRange);
    writeRewritePlanSheet(ss, results);
  }

  Logger.log(`=== リライト分析完了: ${results.length}件 ===`);
}

// ============================================================
// Phase 3: 承認済みリライトをWordPressに反映
// ============================================================
function applyApprovedRewrites() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REWRITE_CONFIG.REWRITE_PLAN_SHEET);

  if (!sheet) {
    Logger.log('rewrite_planシートが見つかりません。');
    return;
  }

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
    if (!postData) {
      sheet.getRange(i + 2, 8).setValue('取得失敗');
      continue;
    }

    const currentContent = postData.content.raw;
    const rewriteSheet = getLatestRewriteSheet(ss);
    const fullData = rewriteSheet ? getRewriteDataForUrl(rewriteSheet, url) : null;

    if (!fullData) {
      sheet.getRange(i + 2, 8).setValue('データ不足');
      continue;
    }

    const rewrittenContent = applyRewriteToContent(currentContent, fullData);

    if (!rewrittenContent || rewrittenContent === currentContent) {
      sheet.getRange(i + 2, 8).setValue('適用失敗');
      continue;
    }

    const success = updateWpPost(postId, rewrittenContent);
    if (success) {
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

  const ua = REWRITE_CONFIG.USER_AGENTS[
    Math.floor(Math.random() * REWRITE_CONFIG.USER_AGENTS.length)
  ];

  try {
    const response = UrlFetchApp.fetch(searchUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
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
// Yahoo検索結果HTMLをパース
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
    for (const domain of excludeDomains) {
      if (url.includes(domain)) return false;
    }
    for (const ext of excludeExtensions) {
      if (url.toLowerCase().endsWith(ext)) return false;
    }
    return true;
  }

  let match;

  // パターン1: data-url属性
  const dataUrlRegex = /data-url="(https?:\/\/[^"]+)"/gi;
  while ((match = dataUrlRegex.exec(html)) !== null) {
    const url = match[1];
    if (!isValidResult(url) || seen.has(url)) continue;
    seen.add(url);
    const nearbyContext = html.substring(Math.max(0, match.index - 500), Math.min(html.length, match.index + 500));
    const titleMatch = nearbyContext.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    results.push({ url, title, snippet: '', rank: results.length + 1 });
    if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
  }

  // パターン2: h3内のリンク
  if (results.length === 0) {
    const h3LinkRegex = /<h3[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi;
    while ((match = h3LinkRegex.exec(html)) !== null) {
      const url = match[1];
      if (!isValidResult(url) || seen.has(url)) continue;
      seen.add(url);
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      results.push({ url, title, snippet: '', rank: results.length + 1 });
      if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
    }
  }

  // パターン3: リダイレクトURL
  if (results.length === 0) {
    const redirectRegex = /\/RU=(https?%3A%2F%2F[^\/]+[^"]*)\//gi;
    while ((match = redirectRegex.exec(html)) !== null) {
      try {
        const url = decodeURIComponent(match[1]);
        if (!isValidResult(url) || seen.has(url)) continue;
        seen.add(url);
        results.push({ url, title: '', snippet: '', rank: results.length + 1 });
        if (results.length >= REWRITE_CONFIG.COMPETITORS_PER_KW) break;
      } catch (e) {}
    }
  }

  // パターン4: 広い範囲で外部URL
  if (results.length === 0) {
    const broadRegex = /href="(https?:\/\/[^"]{20,})"/gi;
    while ((match = broadRegex.exec(html)) !== null) {
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
// 記事の見出し構造 + 本文概要をスクレイプ
// ============================================================
function scrapeArticleStructure(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; soico-seo-bot/1.0)' },
    });

    if (response.getResponseCode() !== 200) return null;
    const html = response.getContentText('UTF-8');

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

    const headings = [];
    const headingRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      if (text.length > 0) headings.push({ level: parseInt(match[1]), text });
    }

    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let totalLength = 0;
    while ((match = pRegex.exec(html)) !== null && totalLength < 3000) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 20) { paragraphs.push(text); totalLength += text.length; }
    }

    return {
      title, h1, headings,
      headingCount: headings.length,
      contentSummary: paragraphs.slice(0, 15).join('\n'),
      totalParagraphs: paragraphs.length,
    };
  } catch (e) {
    Logger.log(`スクレイプエラー [${url}]: ${e.message}`);
    return null;
  }
}

// ============================================================
// Claude API: リライト案生成
// ============================================================
function callClaudeRewrite(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  const requestBody = {
    model: REWRITE_CONFIG.REWRITE_MODEL,
    max_tokens: REWRITE_CONFIG.REWRITE_MAX_TOKENS,
    system: buildRewriteSystemPrompt(),
    messages: [{ role: 'user', content: buildRewriteUserPrompt(params) }],
  };

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`Claude APIエラー: ${response.getResponseCode()}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    const text = data.content[0].text;
    return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
  } catch (e) {
    Logger.log(`Claude API例外: ${e.message}`);
    return null;
  }
}

// ============================================================
// リライト用システムプロンプト
// ============================================================
function buildRewriteSystemPrompt() {
  return `あなたは金融アフィリエイトメディアのSEOリライト専門家です。
自サイト記事と競合上位記事の構成を比較し、SEO順位を改善するための具体的なリライト案を生成してください。

## 分析の観点
1. 見出し構成の過不足（競合にあって自サイトにないトピック、逆も）
2. コンテンツの深さ（説明が浅い・不十分なセクション、具体例・数値・比較表の不足）
3. 検索意図との整合性（記事全体の構成が検索意図に適切か）
4. E-E-A-T要素（専門性・経験・権威性・信頼性の不足）

## 出力ルール
- 景品表示法・金融商品取引法に抵触する表現は提案しない
- 既存の良い部分は維持する（改善点に集中）
- 各変更にはSEO改善の根拠を付ける
- 見出し追加には内容概要（100〜200文字）を含める
- 本文書き換えには現在の文と改善後の文の両方を含める
- locationには自サイト記事内の正確な見出しテキストを使用

## 出力形式（JSON以外のテキストは出力しない）

{
  "article_url": "記事URL",
  "main_keyword": "メインKW",
  "current_position": 順位,
  "overall_assessment": "記事の現状評価（3文程度）",
  "target_position": "改善後の目標順位",
  "missing_topics": [
    {
      "topic": "競合にあって自サイトにないトピック",
      "found_in": ["競合1位", "競合2位"],
      "suggested_heading": "追加すべき見出しテキスト",
      "heading_level": 2,
      "insert_after": "この見出しの後に追加（自サイトの既存見出しテキスト）",
      "content_outline": "見出し下に書くべき内容概要（100〜200文字）",
      "priority": "高 | 中 | 低",
      "seo_rationale": "SEO改善理由"
    }
  ],
  "unnecessary_topics": [
    { "heading": "不要な見出し", "reason": "理由", "action": "削除 | 統合 | 簡略化" }
  ],
  "content_improvements": [
    {
      "location": "改善対象の見出しテキスト",
      "issue": "問題点",
      "current_text": "現在の本文（抜粋）",
      "improved_text": "改善後の本文",
      "seo_rationale": "改善理由"
    }
  ],
  "structure_changes": [
    { "type": "順序変更 | 階層変更 | 見出し名変更", "current": "現在", "proposed": "提案", "seo_rationale": "理由" }
  ],
  "priority_summary": "最も優先度の高い改善3つを箇条書きで"
}`;
}

// ============================================================
// リライト用ユーザープロンプト
// ============================================================
function buildRewriteUserPrompt(params) {
  const ownHeadings = params.ownStructure.headings
    .map(h => `${'  '.repeat(h.level - 2)}${h.level === 2 ? '##' : '###'} ${h.text}`)
    .join('\n');

  const competitorTexts = params.competitors.map(c => {
    const headings = c.structure.headings
      .map(h => `${'  '.repeat(h.level - 2)}${h.level === 2 ? '##' : '###'} ${h.text}`)
      .join('\n');
    return `【競合${c.rank}位】${c.title}\nURL: ${c.url}\n見出し数: ${c.structure.headingCount}\n${headings}\n\n本文概要:\n${c.structure.contentSummary.substring(0, 500)}`;
  }).join('\n\n---\n\n');

  const keywordsText = (params.allKeywords || []).slice(0, 10)
    .map(k => `${k.keyword}（クリック${k.clicks}, 表示${k.impressions}, 順位${Math.round(k.position * 10) / 10}）`)
    .join('\n');

  return `以下の記事をリライト分析してください。

【自サイト記事】
URL: ${params.articleUrl}
タイトル: ${params.ownStructure.title}
H1: ${params.ownStructure.h1}
見出し数: ${params.ownStructure.headingCount}
メイン流入KW: ${params.topKeyword}
現在の順位: ${params.position}
クリック数（28日）: ${params.clicks}
表示回数（28日）: ${params.impressions}

流入KW一覧:
${keywordsText || '(データなし)'}

自サイト見出し構造:
${ownHeadings}

自サイト本文概要:
${params.ownStructure.contentSummary}

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
// キャッシュシート作成
// ============================================================
function createCompetitorCacheSheet(ss, candidates) {
  const sheetName = REWRITE_CONFIG.COMPETITOR_CACHE_SHEET;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = ['記事URL', '表示回数', 'トップKW', '順位', 'クリック数', '競合データ', 'ステータス'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#FF6F00').setFontColor('#FFFFFF');

  const rows = candidates.map(c => [c.page, c.impressions, c.topKeyword, c.position, c.clicks, '', '未取得']);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(6, 500);
  return sheet;
}

// ============================================================
// Spreadsheet出力
// ============================================================
function writeRewriteResultSheet(ss, results, dateRange) {
  const sheetName = REWRITE_CONFIG.REWRITE_SHEET_PREFIX + dateRange.end;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = ['記事URL', '投稿ID', 'メインKW', '現在順位', 'クリック数', '表示回数', '競合数', '総合評価', '目標順位', '不足トピック', '不要トピック', '本文改善', '構造変更', '優先改善'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF');

  const rows = results.map(r => {
    const p = r.rewritePlan;
    return [r.url, r.postId, r.keyword, r.position, r.clicks, r.impressions, r.competitorCount,
      p.overall_assessment || '', p.target_position || '',
      formatMissingTopics(p.missing_topics), formatUnnecessaryTopics(p.unnecessary_topics),
      formatContentImprovements(p.content_improvements), formatStructureChanges(p.structure_changes),
      p.priority_summary || ''];
  });

  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setColumnWidth(1, 400); sheet.setColumnWidth(8, 400);
  sheet.setColumnWidth(10, 500); sheet.setColumnWidth(12, 500); sheet.setColumnWidth(14, 400);
  Logger.log(`「${sheetName}」に ${rows.length} 件出力`);
}

function writeRewritePlanSheet(ss, results) {
  const sheetName = REWRITE_CONFIG.REWRITE_PLAN_SHEET;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = ['記事URL', '投稿ID', 'メインKW', '現在順位', 'リライト概要', '不足トピック数', '本文改善数', 'ステータス'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF');

  const rows = results.map(r => {
    const p = r.rewritePlan;
    return [r.url, r.postId, r.keyword, r.position, p.priority_summary || '',
      (p.missing_topics || []).length, (p.content_improvements || []).length, '承認待ち'];
  });

  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setColumnWidth(1, 400); sheet.setColumnWidth(5, 500); sheet.setColumnWidth(8, 100);

  const statusRange = sheet.getRange(2, 8, Math.max(rows.length, 1), 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認待ち').setBackground('#E8F5E9').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('反映済み').setBackground('#BBDEFB').setRanges([statusRange]).build(),
  ]);
  Logger.log(`「${sheetName}」に ${rows.length} 件出力`);
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
      return {
        missing_topics: parseMissingTopicsFromSheet(row[9]),
        content_improvements: parseImprovementsFromSheet(row[11]),
      };
    }
  }
  return null;
}

function parseMissingTopicsFromSheet(text) {
  if (!text || text === 'なし') return [];
  const topics = [];
  const sections = text.split(/\n\n/);
  for (const section of sections) {
    const headingMatch = section.match(/\]\s*(.+)/);
    const contentMatch = section.match(/内容:\s*(.+)/);
    if (headingMatch) {
      topics.push({
        suggested_heading: headingMatch[1].trim(),
        content_outline: contentMatch ? contentMatch[1].trim() : '',
        insert_after: '', heading_level: 2,
        priority: section.includes('[高]') ? '高' : section.includes('[中]') ? '中' : '低',
      });
    }
  }
  return topics;
}

function parseImprovementsFromSheet(text) {
  if (!text || text === 'なし') return [];
  const improvements = [];
  const sections = text.split(/\n\n/);
  for (const section of sections) {
    const currentMatch = section.match(/現在:\s*(.+?)(?:\.\.\.|$)/);
    const improvedMatch = section.match(/改善:\s*(.+?)(?:\.\.\.|$)/);
    if (currentMatch && improvedMatch) {
      improvements.push({ current_text: currentMatch[1].trim(), improved_text: improvedMatch[1].trim() });
    }
  }
  return improvements;
}

// ============================================================
// 出力フォーマット
// ============================================================
function formatMissingTopics(topics) {
  if (!topics || topics.length === 0) return 'なし';
  return topics.map(t => `[${t.priority}] ${t.suggested_heading}\n  競合: ${(t.found_in || []).join(', ')}\n  内容: ${t.content_outline}\n  理由: ${t.seo_rationale}`).join('\n\n');
}

function formatUnnecessaryTopics(topics) {
  if (!topics || topics.length === 0) return 'なし';
  return topics.map(t => `${t.action}: ${t.heading}\n  理由: ${t.reason}`).join('\n\n');
}

function formatContentImprovements(improvements) {
  if (!improvements || improvements.length === 0) return 'なし';
  return improvements.map(i => `場所: ${i.location}\n  問題: ${i.issue}\n  現在: ${(i.current_text || '').substring(0, 100)}...\n  改善: ${(i.improved_text || '').substring(0, 100)}...\n  理由: ${i.seo_rationale}`).join('\n\n');
}

function formatStructureChanges(changes) {
  if (!changes || changes.length === 0) return 'なし';
  return changes.map(c => `${c.type}: ${c.current} → ${c.proposed}\n  理由: ${c.seo_rationale}`).join('\n\n');
}

// ============================================================
// テスト用関数
// ============================================================

function testYahooSearch() {
  Logger.log('=== Yahoo検索テスト ===');
  const results = fetchCompetitorUrlsFromYahoo('カードローン おすすめ');
  Logger.log(`取得: ${results.length}件`);
  results.forEach(r => Logger.log(`  [${r.rank}] ${r.title || '(タイトル不明)'} - ${r.url}`));
  Logger.log('=== テスト完了 ===');
}

function testRewriteCandidates() {
  Logger.log('=== リライト候補テスト（gsc_masterから） ===');
  const candidates = getRewriteCandidates(5);
  Logger.log(`候補: ${candidates.length}件`);
  candidates.forEach((c, i) => {
    Logger.log(`  [${i + 1}] ${c.page}`);
    Logger.log(`      KW: ${c.topKeyword}, 順位: ${c.position}, スコア: ${Math.round(c.improvementScore)}`);
  });
  Logger.log('=== テスト完了 ===');
}

function testSingleRewrite() {
  Logger.log('=== 単体リライトテスト ===');
  const candidates = getRewriteCandidates(1);
  if (candidates.length === 0) { Logger.log('候補なし。refreshGscMasterを実行済みか確認。'); return; }

  const target = candidates[0];
  Logger.log(`対象: ${target.page} (KW: ${target.topKeyword}, 順位: ${target.position})`);

  const competitorUrls = fetchCompetitorUrlsFromYahoo(target.topKeyword);
  Logger.log(`競合URL: ${competitorUrls.length}件`);

  const ownStructure = scrapeArticleStructure(target.page);
  Logger.log(`自サイト見出し: ${ownStructure ? ownStructure.headingCount : 0}件`);

  const competitorStructures = [];
  if (competitorUrls.length > 0) {
    const comp = scrapeArticleStructure(competitorUrls[0].url);
    if (comp) competitorStructures.push({ url: competitorUrls[0].url, title: competitorUrls[0].title || comp.title, rank: 1, structure: comp });
  }

  if (!ownStructure || competitorStructures.length === 0) { Logger.log('スクレイプ失敗'); return; }

  Logger.log('--- Claude APIリライト分析 ---');
  const rewritePlan = callClaudeRewrite({
    articleUrl: target.page, topKeyword: target.topKeyword,
    allKeywords: target.keywords, position: target.position,
    clicks: target.clicks, impressions: target.impressions,
    ownStructure: ownStructure, competitors: competitorStructures,
  });

  if (rewritePlan) {
    Logger.log(`総合評価: ${rewritePlan.overall_assessment}`);
    Logger.log(`不足トピック: ${(rewritePlan.missing_topics || []).length}件`);
    Logger.log(`本文改善: ${(rewritePlan.content_improvements || []).length}件`);
    Logger.log(`優先改善: ${rewritePlan.priority_summary}`);
  } else {
    Logger.log('リライト案生成失敗');
  }
  Logger.log('=== テスト完了 ===');
}
