// ============================================================
// CTA挿入: 共有関数
//
// Gap Fill (cta_gap_fill.js) が使用する関数群。
// WordPress REST API、ブロック生成、見出し解析を提供する。
// ============================================================

// ============================================================
// パートナースラッグ → プラグインスラッグ マッピング
// ============================================================
const PARTNER_SLUG_MAP = {
  // カードローン
  'promise': 'promise', 'promise_checked': 'promise',
  'acom': 'acom', 'acom_checked': 'acom',
  'aiful': 'aiful', 'aiful_checked': 'aiful',
  'mobit': 'mobit', 'mobit_checked': 'mobit',
  'lakealsa': 'lakealsa', 'smbcmobit': 'smbcmobit',
  'plannel': 'plannel', 'excel': 'excel',
  'big': 'big', 'alcosystem': 'alcosystem',
  'spirits': 'spirits', 'progress': 'progress',
  'au-pay-smart-loan': 'au_pay',
  // 暗号資産
  'bitflyer': 'bitflyer', 'bitflyer_checked': 'bitflyer',
  'coincheck': 'coincheck', 'gmo-coin': 'gmo_coin', 'gmo_coin': 'gmo_coin',
  'bitbank': 'bitbank', 'sbivc-trade': 'sbi_vc', 'sbi_vc': 'sbi_vc',
  'bittrade': 'bittrade', 'binance-japan': 'binance_japan',
  'bitpoint': 'bitpoint', 'zaif': 'zaif', 'okj': 'okj',
  'rakuten-wallet': 'rakuten_wallet', 'line-bitmax': 'line_bitmax',
  'sblox': 'sblox',
  // 証券
  'sbi': 'sbi', 'rakuten': 'rakuten', 'gaia-btm': 'gaia',
  'monex': 'monex', 'matsui': 'matsui', 'moomoo': 'moomoo',
  'okasan': 'okasan', 'mufjesmart': 'mufjesmart',
  'alternabank': 'alternabank', 'agcrowd': 'agcrowd',
  'funds': 'funds', 'crowdbank': 'crowdbank', 'lendex': 'lendex',
};

// ============================================================
// カテゴリ別ブロック設定
// ============================================================
const CATEGORY_BLOCK_CONFIG = {
  'cardloan': {
    entityKey: 'company',
    inlineCta: 'cardloan-inline-cta',
  },
  'cryptocurrency': {
    entityKey: 'exchange',
    inlineCta: 'crypto-inline-cta',
  },
  'securities': {
    entityKey: 'company',
    inlineCta: 'inline-cta',
  },
};

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
      Logger.log(`WP POST エラー: ${response.getResponseCode()}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`WP POST 例外: ${e.message}`);
    return false;
  }
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
//
// soico-securities-cta v1.1.0 以降の V2 レンダラーを使用する。
// URL解決はプラグイン会社データ層に委譲（B-lazy方式）。
// ============================================================
function buildCtaBlockComment(category, change, pluginSlug) {
  const config = CATEGORY_BLOCK_CONFIG[category];
  if (!config) return '';

  const featureText = extractFeatureText(change.proposed);
  const blockName = config.inlineCta;

  const attributes = { version: '2' };
  attributes[config.entityKey] = pluginSlug;
  if (featureText) attributes.featureText = featureText;

  return `<!-- wp:soico-cta/${blockName} ${JSON.stringify(attributes)} /-->`;
}

// ============================================================
// マイクロコピー抽出
// ============================================================
function extractFeatureText(proposed) {
  if (!proposed) return '';
  const quoteMatch = proposed.match(/「([^」]{4,50})」/);
  if (quoteMatch) return quoteMatch[1];
  return '';
}

// ============================================================
// 全見出し抽出（位置・レベル情報付き）
// ============================================================
function extractAllHeadings(content) {
  const headings = [];

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
// セクション末尾の最適な挿入位置を計算
// ============================================================
function findOptimalInsertPosition(content, headings, targetIndex) {
  const targetHeading = headings[targetIndex];

  let sectionEndBoundary = content.length;
  for (let i = targetIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= targetHeading.level) {
      sectionEndBoundary = headings[i].startPosition;
      break;
    }
  }

  const sectionContent = content.substring(targetHeading.endPosition, sectionEndBoundary);
  const sectionStart = targetHeading.endPosition;

  const contentBlockRegex = /<!-- \/wp:(paragraph|list|table|html|quote|image|heading)\s*-->/gi;
  let lastContentEnd = -1;
  let blockMatch;

  while ((blockMatch = contentBlockRegex.exec(sectionContent)) !== null) {
    lastContentEnd = blockMatch.index + blockMatch[0].length;
  }

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

  return sectionEndBoundary;
}

// ============================================================
// 正確な見出しテキストから挿入位置を特定
// ============================================================
function findSectionEndInsertPosition(content, exactHeadingText) {
  if (!exactHeadingText) return -1;

  const headings = extractAllHeadings(content);

  let targetIndex = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].text === exactHeadingText) {
      targetIndex = i;
      break;
    }
  }

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
// URLから投稿IDを抽出
// ============================================================
function extractPostId(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? match[1] : null;
}
