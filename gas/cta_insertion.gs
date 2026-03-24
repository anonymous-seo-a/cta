// ============================================================
// CTA挿入: 設定
// ============================================================

const PARTNER_SLUG_MAP = {
  // カードローン
  'promise': 'promise', 'promise_checked': 'promise',
  'acom': 'acom', 'acom_checked': 'acom',
  'aiful': 'aiful', 'aiful_checked': 'aiful',
  'mobit': 'mobit', 'mobit_checked': 'mobit',
  'plannel': 'plannel', 'excel': 'excel',
  'big': 'big', 'alcosystem': 'alcosystem',
  'spirits': 'spirits', 'progress': 'progress',
  'au-pay-smart-loan': 'au_pay',
  // 暗号資産
  'bitflyer': 'bitflyer', 'bitflyer_checked': 'bitflyer',
  'coincheck': 'coincheck', 'gmo-coin': 'gmo_coin',
  'bitbank': 'bitbank', 'sbivc-trade': 'sbi_vc',
  'bittrade': 'bittrade', 'binance-japan': 'binance_japan',
  'bitpoint': 'bitpoint', 'zaif': 'zaif', 'okj': 'okj',
  'rakuten-wallet': 'rakuten_wallet', 'line-bitmax': 'line_bitmax',
  'sblox': 'sblox',
  // 証券
  'sbi': 'sbi', 'rakuten': 'rakuten', 'gaia-btm': 'gaia',
  'alternabank': 'alternabank', 'agcrowd': 'agcrowd',
  'funds': 'funds', 'crowdbank': 'crowdbank', 'lendex': 'lendex',
};

const CATEGORY_BLOCK_CONFIG = {
  'cardloan': {
    entityKey: 'company',
    inlineCta: 'cardloan-inline-cta',
    subtleBanner: 'cardloan-subtle-banner',
    singleButton: 'cardloan-single-button',
  },
  'cryptocurrency': {
    entityKey: 'exchange',
    inlineCta: 'crypto-inline-cta',
    subtleBanner: 'crypto-subtle-banner',
    singleButton: 'crypto-single-button',
  },
  'securities': {
    entityKey: 'company',
    inlineCta: 'inline-cta',
    subtleBanner: 'subtle-banner',
    singleButton: 'single-button',
  },
};

// ============================================================
// メイン: 挿入計画を生成してSpreadsheetに出力
// ============================================================
function generateCtaInsertionPlan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = ss.getSheets().filter(s => s.getName().startsWith(CONFIG.SHEET_NAME_PREFIX));
  if (sheets.length === 0) {
    Logger.log('週次レポートシートが見つかりません。');
    return;
  }

  sheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  const sourceSheet = sheets[0];
  Logger.log(`ソースシート: ${sourceSheet.getName()}`);

  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データがありません。');
    return;
  }

  const data = sourceSheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const supportedCategories = ['cardloan', 'cryptocurrency', 'securities'];
  const plans = [];

  for (let i = 0; i < data.length; i++) {
    const url = data[i][1];
    const status = data[i][10];
    const planAText = data[i][12];

    if (status !== '診断済み' || !planAText) continue;

    const category = detectArticleCategory(url);
    if (!supportedCategories.includes(category)) {
      Logger.log(`スキップ（非対応カテゴリ: ${category}）: ${url}`);
      continue;
    }

    const postId = extractPostId(url);
    if (!postId) {
      Logger.log(`スキップ（投稿ID抽出失敗）: ${url}`);
      continue;
    }

    Logger.log(`--- 挿入計画生成: ${url} (ID: ${postId}, cat: ${category}) ---`);

    const changes = parsePlanAChanges(planAText);
    if (changes.length === 0) {
      Logger.log('変更箇所の解析に失敗');
      continue;
    }

    const postData = fetchWpPost(postId);
    if (!postData) {
      Logger.log(`WordPress記事取得失敗: ID ${postId}`);
      continue;
    }

    const content = postData.content.raw;

    for (const change of changes) {
      const pluginSlug = mapPartnerToPluginSlug(change.partnerSlug);
      if (!pluginSlug) {
        Logger.log(`スラッグマッピング失敗: ${change.partnerSlug}`);
        plans.push({
          url: url, postId: postId, category: category,
          location: change.location, proposed: change.proposed,
          partnerSlug: change.partnerSlug, pluginSlug: '(マッピング不可)',
          ctaBlock: '', matchedHeading: '', status: 'マッピング失敗',
        });
        continue;
      }

      const ctaBlock = buildCtaBlockComment(category, change, pluginSlug);
      const headingMatch = findBestHeadingMatch(content, change.location);

      if (!headingMatch) {
        plans.push({
          url: url, postId: postId, category: category,
          location: change.location, proposed: change.proposed,
          partnerSlug: change.partnerSlug, pluginSlug: pluginSlug,
          ctaBlock: ctaBlock, matchedHeading: '', status: '見出し不一致',
        });
        Logger.log(`  見出し不一致: ${change.location}`);
        continue;
      }

      // 重複チェック: 挿入位置付近に既にCTAブロックが存在するか
      const existingCta = detectExistingCtaNearPosition(content, headingMatch.position);
      if (existingCta) {
        plans.push({
          url: url, postId: postId, category: category,
          location: change.location, proposed: change.proposed,
          partnerSlug: change.partnerSlug, pluginSlug: pluginSlug,
          ctaBlock: ctaBlock, matchedHeading: headingMatch.text,
          status: 'CTA既存（' + existingCta + '）',
        });
        Logger.log(`  CTA既存: ${change.location} → ${existingCta}`);
        continue;
      }

      plans.push({
        url: url, postId: postId, category: category,
        location: change.location, proposed: change.proposed,
        partnerSlug: change.partnerSlug, pluginSlug: pluginSlug,
        ctaBlock: ctaBlock, matchedHeading: headingMatch.text,
        status: '承認待ち',
      });
      Logger.log(`  承認待ち: 「${headingMatch.text}」(スコア: ${headingMatch.score})`);
    }

    Utilities.sleep(500);
  }

  if (plans.length === 0) {
    Logger.log('挿入対象がありません。');
    return;
  }

  writeInsertionPlanSheet(ss, plans);
  Logger.log(`=== 挿入計画完了: ${plans.length}件 ===`);
}

// ============================================================
// 承認済みの変更をWordPressに反映
// ============================================================
function applyApprovedInsertions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('cta_insertion_plan');

  if (!sheet) {
    Logger.log('cta_insertion_planシートが見つかりません。');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データがありません。');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();

  const changesByPost = {};
  for (let i = 0; i < data.length; i++) {
    const postId = data[i][1];
    const status = data[i][9];     // J列: ステータス
    const ctaBlock = data[i][7];   // H列: CTAブロック
    const matchedHeading = data[i][8]; // I列: マッチ見出し

    if (status !== '承認') continue;
    if (!ctaBlock || !postId) continue;

    if (!changesByPost[postId]) {
      changesByPost[postId] = {
        url: data[i][0],
        category: data[i][2],
        changes: [],
        rowNumbers: [],
      };
    }
    changesByPost[postId].changes.push({
      matchedHeading: matchedHeading,
      ctaBlock: ctaBlock,
    });
    changesByPost[postId].rowNumbers.push(i + 2);
  }

  const postIds = Object.keys(changesByPost);
  if (postIds.length === 0) {
    Logger.log('承認済みの変更がありません。J列を「承認」に変更してから再実行してください。');
    return;
  }

  Logger.log(`=== CTA挿入実行: ${postIds.length}記事 ===`);

  for (const postId of postIds) {
    const postInfo = changesByPost[postId];
    Logger.log(`--- 記事更新: ${postInfo.url} (ID: ${postId}) ---`);

    const postData = fetchWpPost(postId);
    if (!postData) {
      Logger.log(`記事取得失敗: ID ${postId}`);
      postInfo.rowNumbers.forEach(row => sheet.getRange(row, 10).setValue('取得失敗'));
      continue;
    }

    let content = postData.content.raw;
    let insertedCount = 0;

    const insertions = [];
    for (const change of postInfo.changes) {
      const insertPos = findSectionEndInsertPosition(content, change.matchedHeading);
      if (insertPos >= 0) {
        insertions.push({ position: insertPos, ctaBlock: change.ctaBlock });
      } else {
        Logger.log(`挿入位置不明: ${change.matchedHeading}`);
      }
    }

    // 後ろから挿入（インデックスがずれないように）
    insertions.sort((a, b) => b.position - a.position);
    for (const ins of insertions) {
      content = content.substring(0, ins.position) + '\n\n' + ins.ctaBlock + '\n\n' + content.substring(ins.position);
      insertedCount++;
    }

    if (insertedCount === 0) {
      Logger.log('挿入箇所が見つかりませんでした');
      postInfo.rowNumbers.forEach(row => sheet.getRange(row, 10).setValue('挿入位置不明'));
      continue;
    }

    const success = updateWpPost(postId, content);
    if (success) {
      Logger.log(`更新成功: ${insertedCount}箇所にCTAを挿入`);
      postInfo.rowNumbers.forEach(row => sheet.getRange(row, 10).setValue('反映済み'));
    } else {
      Logger.log('WordPress更新失敗');
      postInfo.rowNumbers.forEach(row => sheet.getRange(row, 10).setValue('更新失敗'));
    }

    Utilities.sleep(1000);
  }

  Logger.log('=== CTA挿入完了 ===');
}

// ============================================================
// WordPress REST API
// ============================================================
function fetchWpPost(postId) {
  const username = PropertiesService.getScriptProperties().getProperty('WP_USERNAME');
  const appPassword = PropertiesService.getScriptProperties().getProperty('WP_APP_PASSWORD');
  if (!username || !appPassword) {
    Logger.log('WP_USERNAME または WP_APP_PASSWORD が未設定');
    return null;
  }

  const url = `${CONFIG.WP_REST_BASE}/posts/${postId}?context=edit`;
  const authHeader = 'Basic ' + Utilities.base64Encode(username + ':' + appPassword);

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': authHeader },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      Logger.log(`WP GET エラー: ${response.getResponseCode()}`);
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log(`WP GET 例外: ${e.message}`);
    return null;
  }
}

function updateWpPost(postId, newContent) {
  const username = PropertiesService.getScriptProperties().getProperty('WP_USERNAME');
  const appPassword = PropertiesService.getScriptProperties().getProperty('WP_APP_PASSWORD');

  const url = `${CONFIG.WP_REST_BASE}/posts/${postId}`;
  const authHeader = 'Basic ' + Utilities.base64Encode(username + ':' + appPassword);

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ content: newContent }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      Logger.log(`WP POST エラー: ${response.getResponseCode()} - ${response.getContentText().substring(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`WP POST 例外: ${e.message}`);
    return false;
  }
}

// ============================================================
// Plan Aテキストをパース
// ============================================================
function parsePlanAChanges(planAText) {
  const changes = [];
  const lines = planAText.split('\n');
  let currentChange = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('・')) {
      if (currentChange) changes.push(currentChange);
      const content = trimmed.substring(1).trim();
      const colonIdx = content.indexOf(':');
      if (colonIdx === -1) {
        currentChange = { location: content, proposed: '', partnerSlug: '' };
      } else {
        currentChange = {
          location: content.substring(0, colonIdx).trim(),
          proposed: content.substring(colonIdx + 1).trim(),
          partnerSlug: '',
        };
      }
    } else if (trimmed.includes('推奨案件:') && currentChange) {
      const slugMatch = trimmed.match(/推奨案件:\s*(\S+)/);
      if (slugMatch) currentChange.partnerSlug = slugMatch[1].trim();
    }
  }
  if (currentChange) changes.push(currentChange);
  return changes;
}

// ============================================================
// スラッグマッピング
// ============================================================
function mapPartnerToPluginSlug(partnerSlug) {
  if (!partnerSlug) return null;
  if (PARTNER_SLUG_MAP[partnerSlug]) return PARTNER_SLUG_MAP[partnerSlug];
  const underscored = partnerSlug.replace(/-/g, '_');
  if (PARTNER_SLUG_MAP[underscored]) return PARTNER_SLUG_MAP[underscored];
  return underscored;
}

// ============================================================
// CTAブロックコメント生成
// ============================================================
function buildCtaBlockComment(category, change, pluginSlug) {
  const config = CATEGORY_BLOCK_CONFIG[category];
  if (!config) return '';

  const featureText = extractFeatureText(change.proposed);
  const blockName = config.inlineCta;
  const attributes = {};
  attributes[config.entityKey] = pluginSlug;
  if (featureText) attributes['featureText'] = featureText;

  return `<!-- wp:soico-cta/${blockName} ${JSON.stringify(attributes)} /-->`;
}

// ============================================================
// マイクロコピー抽出
// ============================================================
function extractFeatureText(proposed) {
  if (!proposed) return '';
  const quoteMatch = proposed.match(/「([^」]{4,50})」/);
  if (quoteMatch) return quoteMatch[1];
  const microMatch = proposed.match(/マイクロコピー[：:]\s*(.+?)(?:[（(]|$)/);
  if (microMatch) return microMatch[1].trim();
  return '';
}

// ============================================================
// 全見出し抽出（位置・レベル情報付き）
// ============================================================
function extractAllHeadings(content) {
  const headings = [];

  // Gutenbergブロック形式（level属性対応）
  const blockRegex = /<!-- wp:heading(?:\s+(\{[^}]*\}))?\s*-->\s*<h([23])[^>]*>([\s\S]*?)<\/h\2>\s*<!-- \/wp:heading -->/gi;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    headings.push({
      text: match[3].replace(/<[^>]+>/g, '').trim(),
      level: parseInt(match[2]),
      startPosition: match.index,
      endPosition: match.index + match[0].length,
    });
  }

  // フォールバック: 生HTML
  if (headings.length === 0) {
    const htmlRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((match = htmlRegex.exec(content)) !== null) {
      headings.push({
        text: match[2].replace(/<[^>]+>/g, '').trim(),
        level: parseInt(match[1]),
        startPosition: match.index,
        endPosition: match.index + match[0].length,
      });
    }
  }

  return headings;
}

// ============================================================
// 見出しマッチング: 最も一致度の高い見出しを返す
// positionはセクション末尾の最終段落直後を返す
// ============================================================
function findBestHeadingMatch(content, locationText) {
  const keywords = extractLocationKeywords(locationText);
  if (keywords.length === 0) return null;

  const headings = extractAllHeadings(content);
  if (headings.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;
  let bestIndex = -1;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    // 完全一致
    if (heading.text === locationText || heading.text.includes(locationText)) {
      bestMatch = heading;
      bestScore = 1.0;
      bestIndex = i;
      break;
    }

    // キーワードマッチング
    const matchCount = keywords.filter(kw => heading.text.includes(kw)).length;
    const score = keywords.length > 0 ? matchCount / keywords.length : 0;

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestMatch = heading;
      bestIndex = i;
    }
  }

  if (!bestMatch || bestIndex === -1) return null;

  // セクション末尾の最適な挿入位置を計算
  const insertPosition = findOptimalInsertPosition(content, headings, bestIndex);

  return {
    text: bestMatch.text,
    position: insertPosition,
    score: bestScore,
  };
}

// ============================================================
// セクション末尾の最適な挿入位置を計算
// セクション内の最後のコンテンツブロック（paragraph/list/table/html等）の
// 直後に挿入する。共通パーツ（wp:block ref）やCTAブロックの前。
// ============================================================
function findOptimalInsertPosition(content, headings, targetIndex) {
  const targetHeading = headings[targetIndex];

  // セクションの終了境界を特定（次の同レベル以上の見出し）
  let sectionEndBoundary = content.length;
  for (let i = targetIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= targetHeading.level) {
      sectionEndBoundary = headings[i].startPosition;
      break;
    }
  }

  // セクション内のコンテンツ（見出し直後〜セクション終了）
  const sectionContent = content.substring(targetHeading.endPosition, sectionEndBoundary);
  const sectionStart = targetHeading.endPosition;

  // セクション内の最後のコンテンツブロックの終了位置を探す
  // コンテンツブロック = paragraph, list, table, html, quote, image 等
  // 非コンテンツ = wp:block（再利用ブロック）, soico-cta（CTA）
  const contentBlockRegex = /<!-- \/wp:(paragraph|list|table|html|quote|image|heading)\s*-->/gi;
  let lastContentEnd = -1;
  let blockMatch;

  while ((blockMatch = contentBlockRegex.exec(sectionContent)) !== null) {
    // soico-ctaやwp:blockでないことを確認
    lastContentEnd = blockMatch.index + blockMatch[0].length;
  }

  // 自己閉じタグのコンテンツブロック（wp:htmlなど）も検出
  // <!-- /wp:html --> の位置が最後のコンテンツ位置
  const selfClosingRegex = /<!-- wp:html -->([\s\S]*?)<!-- \/wp:html -->/gi;
  let scMatch;
  while ((scMatch = selfClosingRegex.exec(sectionContent)) !== null) {
    const endPos = scMatch.index + scMatch[0].length;
    if (endPos > lastContentEnd) {
      lastContentEnd = endPos;
    }
  }

  if (lastContentEnd > 0) {
    return sectionStart + lastContentEnd;
  }

  // コンテンツブロックが見つからない場合はセクション終了境界を使用
  return sectionEndBoundary;
}

// ============================================================
// 承認後の反映で使用: 正確な見出しテキストから挿入位置を特定
// ============================================================
function findSectionEndInsertPosition(content, exactHeadingText) {
  if (!exactHeadingText) return -1;

  const headings = extractAllHeadings(content);

  // 対象の見出しを特定
  let targetIndex = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].text === exactHeadingText) {
      targetIndex = i;
      break;
    }
  }

  // 完全一致しない場合は部分一致
  if (targetIndex === -1) {
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].text.includes(exactHeadingText) || exactHeadingText.includes(headings[i].text)) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex === -1) return -1;

  return findOptimalInsertPosition(content, headings, targetIndex);
}

// ============================================================
// 挿入位置付近に既存CTAブロックがあるか検出
// ============================================================
function detectExistingCtaNearPosition(content, position) {
  // 挿入位置の前500文字・後100文字を検索範囲
  const searchStart = Math.max(0, position - 500);
  const searchEnd = Math.min(content.length, position + 100);
  const nearbyContent = content.substring(searchStart, searchEnd);

  // soico-ctaブロックを検出
  const ctaRegex = /<!-- wp:soico-cta\/([a-z-]+)\s+(\{[^}]*\})\s*\/-->/g;
  let match;

  while ((match = ctaRegex.exec(nearbyContent)) !== null) {
    try {
      const blockType = match[1];
      const attrs = JSON.parse(match[2]);
      const entity = attrs.exchange || attrs.company || '不明';
      return `${blockType}:${entity}`;
    } catch (e) {
      return match[1];
    }
  }

  // ThirstyAffiliatesリンクも検出
  const taRegex = /\/recommends\/([a-z0-9-]+)/g;
  let taMatch;
  while ((taMatch = taRegex.exec(nearbyContent)) !== null) {
    return 'ThirstyAffiliates:' + taMatch[1];
  }

  return null;
}

// ============================================================
// 挿入位置テキストからキーワード抽出
// ============================================================
function extractLocationKeywords(locationText) {
  const cleaned = locationText
    .replace(/見出し\d+/g, '')
    .replace(/セクション|終了後|直下|直後|直前|内|前|後/g, '')
    .replace(/[「」『』（）()h2h3H2H3？?！!｜|]/g, '')
    .trim();

  return cleaned.split(/[\s、・／/のをにはがとでからまたへよりも]+/).filter(w => w.length >= 2);
}

// ============================================================
// URLから投稿IDを抽出
// ============================================================
function extractPostId(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? match[1] : null;
}

// ============================================================
// Spreadsheetに挿入計画を出力
// ============================================================
function writeInsertionPlanSheet(ss, plans) {
  const sheetName = 'cta_insertion_plan';

  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(sheetName);

  const headers = [
    '記事URL',          // A
    '投稿ID',           // B
    'カテゴリ',         // C
    '挿入位置(診断)',   // D
    '提案内容',         // E
    '案件(TA slug)',    // F
    '案件(プラグイン)', // G
    'CTAブロック',      // H
    'マッチ見出し',     // I
    'ステータス',       // J
    '備考',             // K
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4472C4');
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
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('見出し不一致').setBackground('#FFF9C4').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('マッピング失敗').setBackground('#FFCDD2').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('CTA既存').setBackground('#FFE0B2').setRanges([statusRange]).build(),
  ]);

  Logger.log(`「${sheetName}」に ${rows.length} 件出力`);
}

// ============================================================
// テスト用関数
// ============================================================

function testWpConnection() {
  Logger.log('=== WordPress API接続テスト ===');
  const testPostId = '13595';
  const post = fetchWpPost(testPostId);

  if (post) {
    Logger.log('接続成功');
    Logger.log(`タイトル: ${post.title.raw}`);
    Logger.log(`ステータス: ${post.status}`);
    Logger.log(`コンテンツ長: ${post.content.raw.length} 文字`);

    const headings = extractAllHeadings(post.content.raw);
    Logger.log(`見出し数: ${headings.length}`);
    headings.slice(0, 10).forEach(h => Logger.log(`  [h${h.level}] ${h.text}`));
  } else {
    Logger.log('接続失敗');
  }
  Logger.log('=== テスト完了 ===');
}

function testInsertPosition() {
  Logger.log('=== 挿入位置テスト ===');

  const testPostId = '20150'; // MEXC記事
  const post = fetchWpPost(testPostId);
  if (!post) {
    Logger.log('記事取得失敗');
    return;
  }

  const content = post.content.raw;
  const headings = extractAllHeadings(content);
  Logger.log(`見出し数: ${headings.length}`);

  // テスト: h2見出しごとの挿入位置を確認
  headings.filter(h => h.level === 2).forEach((h, idx) => {
    const pos = findOptimalInsertPosition(content, headings, headings.indexOf(h));
    // 挿入位置前後30文字を表示
    const before = content.substring(Math.max(0, pos - 80), pos).replace(/\n/g, '\\n').trim();
    const after = content.substring(pos, Math.min(content.length, pos + 80)).replace(/\n/g, '\\n').trim();
    Logger.log(`\n[h2] ${h.text}`);
    Logger.log(`  挿入位置: ${pos}`);
    Logger.log(`  前: ...${before.substring(before.length - 60)}`);
    Logger.log(`  後: ${after.substring(0, 60)}...`);
  });

  Logger.log('=== テスト完了 ===');
}

function testHeadingMatch() {
  Logger.log('=== 見出しマッチングテスト ===');

  const testPostId = '20150';
  const post = fetchWpPost(testPostId);
  if (!post) {
    Logger.log('記事取得失敗');
    return;
  }

  const content = post.content.raw;

  const testLocations = [
    'MEXCとは？海外取引所の基本情報',
    'MEXCを使う5つのメリット',
    'MEXCを使う前に知っておきたい5つのデメリット',
    'MEXCと他の取引所を比較｜Bybit・BINANCEとの違い',
  ];

  testLocations.forEach(loc => {
    const result = findBestHeadingMatch(content, loc);
    if (result) {
      const before = content.substring(Math.max(0, result.position - 60), result.position).replace(/\n/g, '\\n').trim();
      Logger.log(`「${loc}」→「${result.text}」(スコア: ${result.score})`);
      Logger.log(`  挿入直前: ...${before.substring(before.length - 50)}`);
    } else {
      Logger.log(`「${loc}」→ マッチなし`);
    }
  });

  Logger.log('=== テスト完了 ===');
}
