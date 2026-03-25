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
  REWRITE_MAX_TOKENS: 8192,
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
    writeRewriteDesignSheet(ss, results);
  }

  const remainingData = cacheSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const remainingCount = remainingData.filter(row => row[6] === '取得済み').length;
  Logger.log(`\n=== Phase2完了: ${results.length}件分析、残り${remainingCount}件 ===`);
}

// ============================================================
// Phase 3 は seo_rewrite_markup.gs に移動
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

    // トークン上限で出力が切れたか確認
    const stopReason = data.stop_reason || (data.content && data.content[0] && data.content[0].stop_reason) || '';
    if (stopReason === 'max_tokens' || (data.usage && data.usage.output_tokens >= REWRITE_CONFIG.REWRITE_MAX_TOKENS - 10)) {
      Logger.log(`  ⚠ 出力がmax_tokensで切れた可能性あり。JSON修復を試行。`);
    }

    const text = data.content[0].text;
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (parseErr) {
      Logger.log(`  JSONパースエラー: ${parseErr.message}。修復を試行...`);
      return repairTruncatedJson(cleaned);
    }
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
自サイト記事と競合上位記事の構成を比較し、検索1位を獲得するための「リライト設計書」を生成してください。

## 分析の観点（全て実施すること）
1. ペルソナ推定: ターゲットKWから検索するユーザー像を具体的に推定する（年齢層・状況・知識レベル・不安や疑問・求めている情報）
2. 検索意図の分析: ユーザーが本当に知りたいことは何か。現在の記事は検索意図に対してズレていないか
3. 見出し構成の過不足: 競合にあって自サイトにないトピック、逆に不要なトピック
4. コンテンツの深さ: 説明が浅い・不十分・古い情報があるセクション
5. 表現・言い回しの最適化: ペルソナに対して表現が適切か。もっとわかりやすい・刺さる言い回しがないか
6. E-E-A-T要素: 専門性・経験・権威性・信頼性の不足箇所

## 出力ルール
- 景品表示法・金融商品取引法に抵触する表現は提案しない
- 既存の良い部分は維持する
- 各変更にはSEO改善の根拠を付ける
- 見出し追加には内容概要（150〜300文字）を含める
- 本文書き換えには現在の文と改善後の文の両方を含める
- locationには自サイト記事内の正確な見出しテキストを使用
- H2セクションごとに変更指示をまとめること（section_plan）。H3以下はH2の指示内に含める
- section_planは最大15件まで。優先度「低」のセクションはaction=維持として省略してよい
- CTA関連ブロック（<!-- wp:soico-cta/ で始まるもの）と再利用ブロック（<!-- wp:block {"ref":数字} /-->）は絶対に変更しない

## 出力形式（JSON以外のテキストは出力しない）

{
  "article_url": "記事URL",
  "main_keyword": "メインKW",
  "current_position": 順位,
  "target_position": "目標順位",
  "persona": {
    "age_range": "年齢層",
    "situation": "検索している状況（2文）",
    "knowledge_level": "初心者 | 中級者 | 上級者",
    "concerns": ["不安や疑問1", "不安や疑問2"],
    "desired_info": "求めている情報（1文）"
  },
  "search_intent_analysis": {
    "primary_intent": "主たる検索意図（1文）",
    "current_alignment": "現在の記事と検索意図のズレの有無と内容（2文）",
    "improvement_direction": "改善の方向性（2文）"
  },
  "overall_assessment": "現状評価（3文。強み・弱み・改善方向）",
  "section_plan": [
    {
      "h2_heading": "既存のH2見出しテキスト（正確に）",
      "action": "書き換え | 追加 | 削除 | 統合 | 維持",
      "instructions": "このセクションに対する具体的な変更指示（3〜5文。何を書き換えるか、何を追加するか、どんな表現に改善するか）",
      "new_heading": "見出しテキストを変更する場合の新しい見出し（変更しない場合は空文字）",
      "priority": "高 | 中 | 低"
    }
  ],
  "new_sections": [
    {
      "suggested_heading": "新規追加する見出し",
      "heading_level": 2,
      "insert_after": "挿入位置の既存H2見出し",
      "content_outline": "内容概要（150〜300文字。ペルソナの不安や疑問に答える内容を意識すること）",
      "priority": "高 | 中 | 低",
      "seo_rationale": "理由（1文）"
    }
  ],
  "expression_improvements": [
    {
      "location": "見出しテキスト",
      "issue": "ペルソナに対してどう問題か",
      "current_text": "現在の表現",
      "improved_text": "改善後の表現",
      "rationale": "なぜこの表現がペルソナに刺さるか（1文）"
    }
  ],
  "outdated_info": [
    {
      "location": "見出しテキスト",
      "current_info": "古い情報の内容",
      "update_needed": "更新すべき内容の方向性",
      "priority": "高 | 中 | 低"
    }
  ],
  "structure_changes": [
    { "type": "順序変更 | 階層変更 | 見出し名変更", "current": "現在", "proposed": "提案", "seo_rationale": "理由" }
  ],
  "priority_summary": "最優先の改善3つ（ペルソナ視点で最もインパクトが大きい順）"
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

// リライト適用は seo_rewrite_markup.gs のStep 3で実行

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

function writeRewriteDesignSheet(ss, results) {
  const sheetName = 'rewrite_design';
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const h = ['記事URL','投稿ID','メインKW','順位','ペルソナ','検索意図分析','総合評価',
      'セクション別計画','新規セクション','表現改善','古い情報','優先改善','追加メモ','ステータス','設計書JSON'];
    sheet.getRange(1, 1, 1, 15).setValues([h]);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 350); sheet.setColumnWidth(5, 300); sheet.setColumnWidth(6, 400);
    sheet.setColumnWidth(7, 400); sheet.setColumnWidth(8, 500); sheet.setColumnWidth(9, 400);
    sheet.setColumnWidth(10, 400); sheet.setColumnWidth(11, 300); sheet.setColumnWidth(12, 300);
    sheet.setColumnWidth(13, 300); sheet.setColumnWidth(14, 100);
    // JSON列は非表示
    sheet.setColumnWidth(15, 50); sheet.hideColumns(15);
    // ステータス条件付き書式
    const sr = sheet.getRange(2, 14, 200, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('設計待ち').setBackground('#FFF3E0').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('リライト済み').setBackground('#BBDEFB').setRanges([sr]).build(),
    ]);
  }
  const nextRow = sheet.getLastRow() + 1;
  const rows = results.map(r => {
    const p = r.rewritePlan;
    return [
      r.url, r.postId, r.keyword,
      `${r.position} → ${p.target_position || '?'}`,
      formatPersona(p.persona),
      formatSearchIntent(p.search_intent_analysis),
      p.overall_assessment || '',
      formatSectionPlan(p.section_plan),
      formatNewSections(p.new_sections),
      formatExpressionImprovements(p.expression_improvements),
      formatOutdatedInfo(p.outdated_info),
      p.priority_summary || '',
      '', // 追加メモ（空）
      '設計待ち',
      JSON.stringify(p),
    ];
  });
  if (rows.length > 0) {
    sheet.getRange(nextRow, 1, rows.length, 15).setValues(rows);
    // テキスト列を折り返し表示
    [5,6,7,8,9,10,11,12].forEach(col => {
      sheet.getRange(nextRow, col, rows.length, 1).setWrap(true);
    });
  }
  Logger.log(`「${sheetName}」に${rows.length}件追記`);
}

// ============================================================
// リライト設計書のフォーマット関数
// ============================================================
function formatPersona(p) {
  if (!p) return '(推定なし)';
  const concerns = (p.concerns || []).map(c => `・${c}`).join('\n');
  return `【${p.age_range || '?'}】${p.knowledge_level || '?'}
状況: ${p.situation || ''}
不安・疑問:
${concerns}
求める情報: ${p.desired_info || ''}`;
}

function formatSearchIntent(s) {
  if (!s) return '(分析なし)';
  return `意図: ${s.primary_intent || ''}
現状のズレ: ${s.current_alignment || ''}
改善方向: ${s.improvement_direction || ''}`;
}

function formatSectionPlan(sections) {
  if (!sections || !sections.length) return 'なし';
  return sections.map(s => {
    const heading = s.new_heading ? `${s.h2_heading} → ${s.new_heading}` : s.h2_heading;
    return `[${s.priority}][${s.action}] ${heading}\n  ${s.instructions}`;
  }).join('\n\n');
}

function formatNewSections(sections) {
  if (!sections || !sections.length) return 'なし';
  return sections.map(s => {
    return `[${s.priority}] ${s.suggested_heading}\n  挿入位置: ${s.insert_after}の後\n  概要: ${s.content_outline}\n  理由: ${s.seo_rationale}`;
  }).join('\n\n');
}

function formatExpressionImprovements(imps) {
  if (!imps || !imps.length) return 'なし';
  return imps.map(x => {
    return `場所: ${x.location}\n  問題: ${x.issue}\n  現在: ${x.current_text}\n  改善: ${x.improved_text}\n  理由: ${x.rationale}`;
  }).join('\n\n');
}

function formatOutdatedInfo(items) {
  if (!items || !items.length) return 'なし';
  return items.map(x => {
    return `[${x.priority}] ${x.location}\n  古い情報: ${x.current_info}\n  更新方向: ${x.update_needed}`;
  }).join('\n\n');
}

function formatStructureChanges(t) {
  if (!t||!t.length) return 'なし';
  return t.map(x=>`${x.type}: ${x.current} → ${x.proposed}\n  理由: ${x.seo_rationale}`).join('\n\n');
}

// ============================================================
// 切れたJSONの修復
// ============================================================
function repairTruncatedJson(text) {
  // 閉じ括弧を補完して有効なJSONにする
  let repaired = text;

  // 末尾の不完全な文字列を切り落とす（開いた"を閉じる）
  const lastQuote = repaired.lastIndexOf('"');
  const lastColon = repaired.lastIndexOf(':');
  const lastComma = repaired.lastIndexOf(',');
  const lastBrace = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));

  // 最後の完全なkey-valueペアまで戻る
  if (lastBrace < lastComma) {
    // カンマの後に不完全なデータがある→カンマまで切り落とす
    repaired = repaired.substring(0, lastComma);
  }

  // 開き括弧と閉じ括弧を数えて補完
  let openBraces = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
  }

  // 閉じ括弧を補完
  for (let i = 0; i < openBrackets; i++) repaired += ']';
  for (let i = 0; i < openBraces; i++) repaired += '}';

  try {
    const result = JSON.parse(repaired);
    Logger.log(`  JSON修復成功（${openBrackets}個の]、${openBraces}個の}を補完）`);
    return result;
  } catch (e) {
    Logger.log(`  JSON修復失敗: ${e.message}`);
    Logger.log(`  修復後の末尾200文字: ${repaired.substring(repaired.length - 200)}`);
    return null;
  }
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
