// ============================================================
// CTA Gap Fill: CTA空白セクションを検出し挿入候補を自動生成
//
// 既存のCVR診断パイプラインとは独立して動作する。
// Claude API はセクション単位の購買意欲判定（intent）にのみ使用。
// コストは既存フル診断の約1/5（~$0.006/記事）。
//
// フロー:
//   1. WP REST API で記事コンテンツを取得
//   2. H2見出し一覧を抽出
//   3. 各セクションの既存CTA有無を検出
//   4. CTA無しセクションについて Claude で購買意欲 intent を判定
//   5. intent=high/medium のセクションにのみ挿入候補を生成
//   6. partner はプラグイン比較表CTAの優先順位に従いラウンドロビン配分
//   7. cta_gap_fill_plan シートに出力（承認待ち）
//
// 承認後の反映: applyApprovedGapFills() を実行
// ============================================================

// ============================================================
// 商材優先順位
// プラグイン比較表CTAの表示順と同一。
// fetchPartnerPriority() で REST API から動的取得を試み、
// 失敗時はこのハードコード値にフォールバック。
// ============================================================
const CATEGORY_PARTNER_PRIORITY = {
  'securities': ['rakuten', 'sbi', 'monex', 'matsui', 'moomoo', 'okasan', 'mufjesmart'],
  'cardloan': ['promise', 'aiful', 'acom', 'lakealsa', 'smbcmobit'],
  'cryptocurrency': ['bitflyer', 'coincheck', 'gmo_coin', 'sbi_vc'],
};

// ============================================================
// 商材優先順位をプラグイン REST API から動的取得
//
// エンドポイント: /wp-json/soico-cta/v1/priorities?category=<cat>
// 未実装時はハードコード値にフォールバック。
// TODO: soico-securities-cta プラグインに REST endpoint を追加する
// ============================================================
function fetchPartnerPriority(category) {
  try {
    const baseUrl = CONFIG.WP_REST_BASE.replace('/wp/v2', '');
    const url = `${baseUrl}/soico-cta/v1/priorities?category=${encodeURIComponent(category)}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      if (data && Array.isArray(data.slugs) && data.slugs.length > 0) {
        Logger.log(`Partner priority (REST): ${category} → ${data.slugs.join(', ')}`);
        return data.slugs;
      }
    }
  } catch (e) {
    // REST endpoint not available yet
  }
  const fallback = CATEGORY_PARTNER_PRIORITY[category] || [];
  Logger.log(`Partner priority (fallback): ${category} → ${fallback.join(', ')}`);
  return fallback;
}

// ============================================================
// セクション内の既存CTA検出
// soico-cta Gutenbergブロック と ThirstyAffiliates リンクのみ対象
// ============================================================
function detectExistingCtaInSection(sectionContent) {
  if (/<!-- wp:soico-cta\//.test(sectionContent)) return true;
  if (/\/recommends\/[a-z0-9_-]+/i.test(sectionContent)) return true;
  return false;
}

// ============================================================
// Gap Fill 用 Claude API 呼び出し
// 入力: セクション一覧 + 提携案件リスト
// 出力: 各セクションの intent + 推奨 partner
// ============================================================
function callGapFillDiagnosis(params, apiKey) {
  const sectionList = params.sections.map(s => {
    const marker = s.hasCta ? '★' : '　';
    return `${s.index}. ${marker} ${s.heading}`;
  }).join('\n');

  const partnerPriority = fetchPartnerPriority(params.category);
  const partnerListText = partnerPriority.join(', ');

  const systemPrompt = `あなたは金融アフィリエイトメディアのCTA配置最適化の専門家です。
記事の各セクション見出しを読み、読者の購買意欲レベルを判定してください。

【判定ルール】
- intent: "high" / "medium" / "low"
  - high: 商品比較・メリット解説・具体的な始め方・おすすめ紹介・シミュレーション結果・申込方法など、読者が行動を検討するセクション
  - medium: 制度解説・基本情報・仕組み説明・費用概要など、理解が深まり間接的に行動につながるセクション
  - low: リスク注意喚起・デメリット・税務処理・法的注意・Q&A・まとめなど、購買意欲と無関係または逆方向のセクション
- ★付きセクション（CTA設置済み）は intent: "skip" とする
- intent が high または medium のセクションにのみ、提携案件リストから最も文脈に合う案件slugを1つ選んで partner に設定する
  - 案件リストは優先順位順に並んでいる。文脈に合う案件が複数ある場合はリスト先頭の案件を優先する
  - 1記事内で同じ partner が連続しないよう分散させる
- intent が low のセクションは partner: null とする

【出力形式】JSON配列のみ出力してください。JSON以外のテキストは出力しないでください。
[{"section": 1, "intent": "high", "partner": "rakuten", "reason": "理由1行"}]`;

  const userPrompt = `以下の記事を判定してください。

【記事カテゴリ】${params.category}
【記事URL】${params.url}

【セクション一覧】（★=CTA設置済み）
${sectionList}

【提携済み案件（優先順位順）】${partnerListText}`;

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model: CLAUDE_CONFIG.MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`Gap Fill API エラー: ${response.getResponseCode()} - ${response.getContentText().substring(0, 200)}`);
      return null;
    }

    const result = JSON.parse(response.getContentText());
    const text = result.content[0].text.trim();

    // JSON配列を抽出（前後に余計なテキストがある場合に対応）
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      Logger.log(`Gap Fill: JSON解析失敗: ${text.substring(0, 200)}`);
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    Logger.log(`Gap Fill API 例外: ${e.message}`);
    return null;
  }
}

// ============================================================
// Gap Fill メイン処理
//
// @param {string[]} [targetPostIds] - 対象記事IDの配列。
//   省略時は最新の週次レポートシートから取得。
// ============================================================
function runGapFill(targetPostIds) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('CLAUDE_API_KEY が設定されていません');
    return;
  }

  // 対象記事の取得
  let targets;
  if (targetPostIds && targetPostIds.length > 0) {
    targets = targetPostIds.map(id => ({ postId: String(id), url: '' }));
  } else {
    targets = getGapFillTargetsFromWeeklySheet(ss);
  }

  if (!targets || targets.length === 0) {
    Logger.log('対象記事がありません');
    return;
  }

  Logger.log(`=== Gap Fill 開始: ${targets.length}記事 ===`);

  const START_TIME = new Date().getTime();
  const TIME_LIMIT_MS = 4.5 * 60 * 1000;
  const plans = [];
  let processed = 0;

  for (const target of targets) {
    if (new Date().getTime() - START_TIME > TIME_LIMIT_MS) {
      Logger.log(`時間制限到達。${processed}件処理済み、残り${targets.length - processed}件は次回実行。`);
      break;
    }

    const postId = target.postId;
    Logger.log(`\n--- Gap Fill: ID ${postId} ---`);

    const postData = fetchWpPost(postId);
    if (!postData) {
      Logger.log(`記事取得失敗: ID ${postId}`);
      continue;
    }

    const content = postData.content.raw;
    const url = target.url || postData.link || '';
    const category = detectArticleCategory(url);

    if (!['cardloan', 'cryptocurrency', 'securities'].includes(category)) {
      Logger.log(`非対応カテゴリ: ${category}`);
      continue;
    }

    // H2見出し抽出
    const allHeadings = extractAllHeadings(content);
    const h2Headings = allHeadings.filter(h => h.level === 2);
    if (h2Headings.length === 0) {
      Logger.log('H2見出しなし');
      continue;
    }

    // 各H2セクションのCTA有無を検出
    const sections = [];
    for (let i = 0; i < h2Headings.length; i++) {
      const sectionStart = h2Headings[i].endPosition;
      const sectionEnd = i + 1 < h2Headings.length
        ? h2Headings[i + 1].startPosition
        : content.length;
      const sectionContent = content.substring(sectionStart, sectionEnd);
      const hasCta = detectExistingCtaInSection(sectionContent);

      sections.push({
        index: i + 1,
        heading: h2Headings[i].text,
        hasCta: hasCta,
        headingData: h2Headings[i],
      });
    }

    const gapCount = sections.filter(s => !s.hasCta).length;
    Logger.log(`H2: ${h2Headings.length}個, CTA既存: ${h2Headings.length - gapCount}個, Gap: ${gapCount}個`);

    if (gapCount === 0) {
      Logger.log('CTA空白セクションなし — スキップ');
      continue;
    }

    // Claude で intent 判定
    const diagnosis = callGapFillDiagnosis({
      url: url,
      category: category,
      sections: sections,
    }, apiKey);

    if (!diagnosis || !Array.isArray(diagnosis)) {
      Logger.log('Gap Fill 診断失敗');
      continue;
    }

    // partner 優先順位取得
    const partnerPriority = fetchPartnerPriority(category);
    let partnerIdx = 0;

    for (const item of diagnosis) {
      if (!item || item.intent === 'low' || item.intent === 'skip') continue;

      const section = sections.find(s => s.index === item.section);
      if (!section || section.hasCta) continue;

      // partner 決定: Claude推奨 → ラウンドロビンフォールバック
      let partnerSlug = item.partner;
      if (!partnerSlug || !partnerPriority.includes(partnerSlug)) {
        partnerSlug = partnerPriority[partnerIdx % partnerPriority.length];
        partnerIdx++;
      } else {
        // Claude推奨を使った場合もインデックスを進める（同一partner連続回避）
        const idxInPriority = partnerPriority.indexOf(partnerSlug);
        if (idxInPriority >= 0) partnerIdx = idxInPriority + 1;
      }

      // プラグインスラッグ変換
      const pluginSlug = mapPartnerToPluginSlug(partnerSlug);
      if (!pluginSlug) {
        Logger.log(`  スラッグ変換失敗: ${partnerSlug}`);
        continue;
      }

      // CTAブロック生成（featureText は空 → プラグイン側デフォルト使用）
      const ctaBlock = buildCtaBlockComment(category, {
        proposed: '',
        partnerSlug: partnerSlug,
      }, pluginSlug);

      plans.push({
        url: url,
        postId: postId,
        category: category,
        location: section.heading,
        proposed: `[Gap Fill / ${item.intent}] ${item.reason || ''}`,
        partnerSlug: partnerSlug,
        pluginSlug: pluginSlug,
        ctaBlock: ctaBlock,
        matchedHeading: section.heading,
        status: '承認待ち',
      });

      Logger.log(`  ✓ ${section.heading} → ${pluginSlug} (${item.intent})`);
    }

    processed++;
    Utilities.sleep(1000);
  }

  if (plans.length === 0) {
    Logger.log('挿入候補がありません');
    return;
  }

  writeGapFillPlanSheet(ss, plans);
  Logger.log(`\n=== Gap Fill 完了: ${processed}記事から${plans.length}件の挿入候補 ===`);
}

// ============================================================
// テスト用: 指定記事IDで Gap Fill を実行
// GASエディタから直接実行できるラッパー
// ============================================================
function testGapFill() {
  // テスト用記事ID（soico.jp/no1/ の記事）
  runGapFill(['5286', '18924', '6504']);
}

// ============================================================
// 最新の週次レポートシートから対象記事を取得
// ============================================================
function getGapFillTargetsFromWeeklySheet(ss) {
  const sheets = ss.getSheets().filter(s => s.getName().startsWith(CONFIG.SHEET_NAME_PREFIX));
  if (sheets.length === 0) return [];

  sheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  const sheet = sheets[0];
  Logger.log(`Gap Fill ソースシート: ${sheet.getName()}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const targets = [];

  for (let i = 0; i < data.length; i++) {
    const url = data[i][1];
    const postId = extractPostId(url);
    if (postId) {
      targets.push({ postId: postId, url: url });
    }
  }

  return targets;
}

// ============================================================
// Gap Fill 計画をスプレッドシートに出力
// cta_insertion_plan と同じカラム構造
// ============================================================
function writeGapFillPlanSheet(ss, plans) {
  const sheetName = 'cta_gap_fill_plan';

  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = [
    '記事URL',              // A
    '投稿ID',               // B
    'カテゴリ',             // C
    '挿入位置(セクション)', // D
    '提案内容',             // E
    '案件(TA slug)',        // F
    '案件(プラグイン)',     // G
    'CTAブロック',          // H
    'マッチ見出し',         // I
    'ステータス',           // J
    '備考',                 // K
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#2E7D32');
  headerRange.setFontColor('#FFFFFF');

  const rows = plans.map(p => [
    p.url, p.postId, p.category, p.location, p.proposed,
    p.partnerSlug, p.pluginSlug, p.ctaBlock,
    p.matchedHeading || '', p.status, '',
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(4, 300);
  sheet.setColumnWidth(5, 400);
  sheet.setColumnWidth(8, 500);
  sheet.setColumnWidth(9, 300);
  sheet.setColumnWidth(10, 150);

  const statusRange = sheet.getRange(2, 10, Math.max(rows.length, 1), 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('承認待ち').setBackground('#E8F5E9').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('反映済み').setBackground('#BBDEFB').setRanges([statusRange]).build(),
  ]);

  Logger.log(`「${sheetName}」に ${rows.length} 件出力`);
}

// ============================================================
// 承認済みの Gap Fill をWordPressに反映
// cta_gap_fill_plan シートから読み取り、既存の反映ロジックを使用
// ============================================================
function applyApprovedGapFills() {
  applyApprovedInsertionsFromSheet('cta_gap_fill_plan');
}
