// ============================================================
// 注釈マスターデータ管理 + 注釈処理ロジック
// ============================================================
// タスク1: master_annotations / master_rules シートの作成・参照
// タスク2: 問題A（既存注釈のプレースホルダー退避・復元）
// タスク3: Claude APIプロンプト用のマスターデータ取得
// タスク4: ポスト処理（注釈検証・補完）

const ANNOTATION_CONFIG = {
  ANNOTATIONS_SHEET: 'master_annotations',
  RULES_SHEET: 'master_rules',
  PLACEHOLDER_PREFIX: '%%ANNOT_',
  PLACEHOLDER_SUFFIX: '%%',
};

// ============================================================
// タスク1: マスターデータシート初期化
// ============================================================
function initMasterAnnotationsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- master_annotations ---
  let annSheet = ss.getSheetByName(ANNOTATION_CONFIG.ANNOTATIONS_SHEET);
  if (annSheet) { ss.deleteSheet(annSheet); }
  annSheet = ss.insertSheet(ANNOTATION_CONFIG.ANNOTATIONS_SHEET);

  const annHeaders = ['商材ID', '商材名', 'カテゴリ', 'トリガーKW', '注釈種別', '注釈テキスト', '記号', 'スコープ'];
  annSheet.getRange(1, 1, 1, 8).setValues([annHeaders]);
  annSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');

  const annData = [
    // アイフル
    ['aiful', 'アイフル', 'cardloan', '最短18分', '審査・融資', 'お申込み時間や審査状況によりご希望にそえない場合があります。', '※ai', '商材言及時'],
    ['aiful', 'アイフル', 'cardloan', '800万円', '限度額', 'ご利用限度額50万円超、または他社を含めた借り入れ金額が100万円超の場合は源泉徴収票など収入を証明するものが必要です。', '※ai', '商材言及時'],
    ['aiful', 'アイフル', 'cardloan', '郵送物なし', '郵送物', '「スマホでかんたん本人確認」又は「銀行口座で本人確認」をし、カード郵送希望無の場合郵送物は届きません。', '※ai', '商材言及時'],
    ['aiful', 'アイフル', 'cardloan', 'WEB完結', 'WEB完結', '申込等内容に不備があれば電話確認あり。', '※ai', '商材言及時'],
    // アコム
    ['acom', 'アコム', 'cardloan', '最短20分', '審査・融資', 'お申込時間や審査によりご希望に添えない場合がございます。', '※a', '商材言及時'],
    ['acom', 'アコム', 'cardloan', '即日融資', '即日融資', 'アコムの当日契約の期限は21時までです。', '※a', '商材言及時'],
    ['acom', 'アコム', 'cardloan', '無利息', '無利息期間', 'アコムでのご契約がはじめてのお客さま', '※a', '商材言及時'],
    // プロミス
    ['promise', 'プロミス', 'cardloan', '最短3分', '審査・融資', 'お申込時間や審査によりご希望に添えない場合がございます。', '※p', '商材言及時'],
    ['promise', 'プロミス', 'cardloan', '無利息', '無利息期間', 'メールアドレス登録とWeb明細利用の登録が必要です。', '※p', '商材言及時'],
    ['promise', 'プロミス', 'cardloan', '800万円', '限度額', '借入限度額は審査によって決定いたします。', '※p', '商材言及時'],
    ['promise', 'プロミス', 'cardloan', '18歳', '申込対象', '主婦・学生でもアルバイト・パートなど安定した収入のある場合はお申込いただけます。ただし、高校生（定時制高校生および高等専門学校生も含む）はお申込いただけません。また、収入が年金のみの方はお申込いただけません。', '※p', '商材言及時'],
    ['promise', 'プロミス', 'cardloan', '事前審査,15秒', '事前審査①', '事前審査結果ご確認後、本審査が必要となります。', '※p', '商材言及時'],
    ['promise', 'プロミス', 'cardloan', '事前審査,15秒', '事前審査②', '新規契約時のご融資上限は、本審査により決定となります。', '※p', '商材言及時'],
    // SMBCモビット
    ['mobit', 'SMBCモビット', 'cardloan', '最短15分', '審査・融資', '申込の曜日、時間帯によっては翌日以降の取扱となる場合があります。', '※m', '商材言及時'],
    ['mobit', 'SMBCモビット', 'cardloan', '800万円', '限度額', '借入限度額は審査によって決定いたします', '※m', '商材言及時'],
  ];
  if (annData.length > 0) {
    annSheet.getRange(2, 1, annData.length, 8).setValues(annData);
  }
  annSheet.setColumnWidth(1, 80); annSheet.setColumnWidth(2, 120); annSheet.setColumnWidth(3, 100);
  annSheet.setColumnWidth(4, 150); annSheet.setColumnWidth(5, 100); annSheet.setColumnWidth(6, 500);
  annSheet.setColumnWidth(7, 50); annSheet.setColumnWidth(8, 100);

  // --- master_rules ---
  let rulesSheet = ss.getSheetByName(ANNOTATION_CONFIG.RULES_SHEET);
  if (rulesSheet) { ss.deleteSheet(rulesSheet); }
  rulesSheet = ss.insertSheet(ANNOTATION_CONFIG.RULES_SHEET);

  const rulesHeaders = ['カテゴリ', '商材ID', 'ルール種別', 'NGテキスト', '正しいテキスト', '適用条件'];
  rulesSheet.getRange(1, 1, 1, 6).setValues([rulesHeaders]);
  rulesSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#C62828').setFontColor('#FFFFFF');

  const rulesData = [
    // 禁止表現（全社共通）
    ['cardloan', 'ALL', '禁止表現', '審査が甘い', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '審査簡単', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '審査が柔軟', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '無審査', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '確実融資', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '絶対借入できる', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', 'ブラックでも借りられる', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '業界最速', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', '最強', '', '常に'],
    ['cardloan', 'ALL', '禁止表現', 'リスクなし', '', '常に'],
    // 必須表現（全社共通）
    ['cardloan', 'ALL', '必須表現', '電話なし', '原則電話による在籍確認なし', '商材言及時'],
    ['cardloan', 'ALL', '必須表現', '電話連絡なし', '原則電話による在籍確認なし', '商材言及時'],
    ['cardloan', 'ALL', '必須表現', 'バレない', '知られない', '商材言及時'],
    ['cardloan', 'ALL', '必須表現', 'バレずに', '知られずに', '商材言及時'],
    ['cardloan', 'ALL', '必須表現', '内緒で', '周囲に知られにくい', '商材言及時'],
    // 正式表記（商材別）
    ['cardloan', 'acom', '正式表記', '30日間無利息', '初めての方は契約翌日から最大30日間無利息', '商材言及時'],
    ['cardloan', 'promise,aiful,mobit', '正式表記', '30日間無利息', '初回最大30日間無利息', '商材言及時'],
    ['cardloan', 'acom', '必須表現', '在籍確認なし', '原則電話によるお勤め先への在籍確認なし', '商材言及時'],
    ['cardloan', 'mobit', '必須表現', 'セブン銀行ATM', 'セブン銀行の提携ATM', '商材言及時'],
    ['cardloan', 'mobit', '必須表現', 'ローソン銀行ATM', 'ローソン銀行の提携ATM', '商材言及時'],
    // モビット固有
    ['cardloan', 'mobit', '必須表現', '誰にもバレない', 'WEB完結申込なら誰にもバレない', '商材言及時'],
  ];
  if (rulesData.length > 0) {
    rulesSheet.getRange(2, 1, rulesData.length, 6).setValues(rulesData);
  }
  rulesSheet.setColumnWidth(1, 100); rulesSheet.setColumnWidth(2, 120);
  rulesSheet.setColumnWidth(3, 100); rulesSheet.setColumnWidth(4, 200);
  rulesSheet.setColumnWidth(5, 300); rulesSheet.setColumnWidth(6, 100);

  Logger.log(`master_annotations: ${annData.length}件, master_rules: ${rulesData.length}件 作成完了`);
}

// ============================================================
// マスターデータ読み込み
// ============================================================
function loadAnnotations(category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ANNOTATION_CONFIG.ANNOTATIONS_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  return data
    .filter(row => row[2] === category)
    .map(row => ({
      productId: row[0],
      productName: row[1],
      category: row[2],
      triggerKws: String(row[3]).split(',').map(s => s.trim()),
      annotationType: row[4],
      annotationText: row[5],
      symbol: row[6],
      scope: row[7],
    }));
}

function loadRules(category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ANNOTATION_CONFIG.RULES_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  return data
    .filter(row => row[0] === category)
    .map(row => ({
      category: row[0],
      productIds: String(row[1]).split(',').map(s => s.trim()),
      ruleType: row[2],
      ngText: row[3],
      correctText: row[4],
      condition: row[5],
    }));
}

// ============================================================
// タスク2: 問題A — 既存注釈のプレースホルダー退避・復元
// ============================================================

/**
 * セクション内の注釈をプレースホルダーに退避
 * @param {string} content - セクションのGutenbergマークアップ
 * @returns {{ content: string, annotations: string[] }}
 */
function extractAnnotationsToPlaceholders(content) {
  const annotations = [];
  let result = content;

  // パターン1: <span style="font-size:...">※...</span>
  result = result.replace(/<span\s+style="font-size:\s*1[12]px[^"]*">\s*※[^<]+<\/span>/gi, (match) => {
    const idx = annotations.length;
    annotations.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // パターン2: (※a) (※p) (※m) (※ai) (※1) (※2) 等の記号参照
  result = result.replace(/\(※[a-z0-9]{1,3}\)/gi, (match) => {
    const idx = annotations.length;
    annotations.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // パターン3: ※a: ※p: 等の注釈定義行（スペック表内）
  result = result.replace(/※[a-z]{1,2}[:：][^<\n]+/gi, (match) => {
    const idx = annotations.length;
    annotations.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // パターン4: 段落内の※で始まるインライン注釈（句点・改行・タグまで）
  // ただし上記で既にプレースホルダー化されたものは除外
  result = result.replace(/(?<!%%ANNOT_\d{3})※[^<\n%%]{5,}/g, (match) => {
    // プレースホルダー自体を置換しないようガード
    if (match.includes(ANNOTATION_CONFIG.PLACEHOLDER_PREFIX)) return match;
    const idx = annotations.length;
    annotations.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  return { content: result, annotations: annotations };
}

/**
 * プレースホルダーを元の注釈に復元
 * @param {string} content - プレースホルダー付きテキスト
 * @param {string[]} annotations - 退避した注釈配列
 * @returns {string}
 */
function restoreAnnotationsFromPlaceholders(content, annotations) {
  let result = content;
  for (let i = 0; i < annotations.length; i++) {
    const placeholder = `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(i).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
    // Claude APIが消した場合は末尾に追加しない（元の位置にないなら仕方ない）
    // ただしログで警告
    if (!result.includes(placeholder)) {
      Logger.log(`    ⚠ 注釈プレースホルダーが消失: ${placeholder} → ${annotations[i].substring(0, 50)}`);
      continue;
    }
    result = result.replace(placeholder, annotations[i]);
  }
  return result;
}

// ============================================================
// タスク3: Claude APIプロンプト用のマスターデータテキスト生成
// ============================================================

/**
 * 記事のカテゴリとスペック表パターンブロックの記号定義を分析
 * @param {string} rawContent - 記事全文のrawコンテンツ
 * @returns {{ category: string, symbolMap: Object }}
 */
function analyzeArticleAnnotationContext(rawContent) {
  // カテゴリ判定（URLまたはCTAブロックから推定）
  let category = 'unknown';
  if (/soico-cta\/cardloan|\/cardloan\//.test(rawContent)) category = 'cardloan';
  else if (/soico-cta\/crypto|\/cryptocurrency\//.test(rawContent)) category = 'cryptocurrency';
  else if (/soico-cta\/(inline-cta|securities)|\/securities\//.test(rawContent)) category = 'securities';
  else if (/\/fx\//.test(rawContent)) category = 'fx';

  // 再利用ブロック内の記号定義を確認
  const symbolMap = {};
  const refs = rawContent.match(/<!-- wp:block \{"ref":(\d+)\} \/-->/g) || [];
  const refIds = refs.map(r => r.match(/\d+/)[0]);

  // 注: 再利用ブロックのコンテンツはrawContentには含まれないため、
  // API呼び出しで取得する必要がある
  for (const refId of [...new Set(refIds)]) {
    try {
      const blockData = fetchWpBlock(refId);
      if (!blockData) continue;
      const blockContent = blockData.content ? blockData.content.raw : '';
      // ※a: ※p: ※m: ※ai: の定義を検出
      const symbolDefs = blockContent.match(/※([a-z]{1,2})[:：]/gi);
      if (symbolDefs) {
        symbolDefs.forEach(sd => {
          const sym = sd.replace(/[:：]/g, '').trim();
          symbolMap[sym] = true;
        });
      }
    } catch (e) {
      Logger.log(`再利用ブロック ${refId} の取得に失敗: ${e.message}`);
    }
  }

  return { category, symbolMap };
}

/**
 * 再利用ブロック（パターンブロック）のコンテンツ取得
 */
function fetchWpBlock(blockId) {
  const username = PropertiesService.getScriptProperties().getProperty('WP_USERNAME');
  const appPassword = PropertiesService.getScriptProperties().getProperty('WP_APP_PASSWORD');
  if (!username || !appPassword) return null;

  const url = `${CONFIG.WP_REST_BASE}/blocks/${blockId}?context=edit`;
  const authHeader = 'Basic ' + Utilities.base64Encode(username + ':' + appPassword);

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': authHeader },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }
}

/**
 * Claude APIプロンプトに注入するマスターデータテキストを生成
 */
function buildAnnotationPromptText(category, symbolMap) {
  const annotations = loadAnnotations(category);
  const rules = loadRules(category);

  if (annotations.length === 0 && rules.length === 0) return '';

  let text = '\n\n## 必須注釈ルール（絶対遵守）\n\n';

  // 記号定義の状態
  const symbolKeys = Object.keys(symbolMap);
  if (symbolKeys.length > 0) {
    text += `この記事にはスペック表パターンブロックに以下の記号定義が存在します: ${symbolKeys.join(', ')}\n`;
    text += `これらの記号が定義済みの場合、本文では (${symbolKeys[0]}) のように記号参照のみで注釈を表示します。\n\n`;
  }

  // 注釈一覧
  text += '### 商材別必須注釈\n';
  text += '以下のトリガーKWが商材への言及として出現するたびに、対応する注釈を付与してください。\n';
  text += '商材に言及していない文脈（一般論等）では注釈不要です。\n\n';

  const byProduct = {};
  annotations.forEach(a => {
    if (!byProduct[a.productName]) byProduct[a.productName] = [];
    byProduct[a.productName].push(a);
  });

  for (const [name, items] of Object.entries(byProduct)) {
    text += `【${name}】\n`;
    items.forEach(a => {
      const kwStr = a.triggerKws.join(' / ');
      const symbolNote = symbolMap[a.symbol] ? `→ ${a.symbol} 記号参照で表記` : `→ インライン注釈`;
      text += `- "${kwStr}" 言及時: ※${a.annotationText} ${symbolNote}\n`;
    });
    text += '\n';
  }

  // 禁止表現・必須表現
  const ngRules = rules.filter(r => r.ruleType === '禁止表現');
  const mustRules = rules.filter(r => r.ruleType === '必須表現' || r.ruleType === '正式表記');

  if (ngRules.length > 0) {
    text += '### 絶対NG表現（使用禁止）\n';
    ngRules.forEach(r => { text += `- ✕「${r.ngText}」\n`; });
    text += '\n';
  }

  if (mustRules.length > 0) {
    text += '### 必須表現（正しい表現に置換）\n';
    mustRules.forEach(r => {
      const scope = r.productIds.includes('ALL') ? '全社' : r.productIds.join('/');
      text += `- ✕「${r.ngText}」→ ○「${r.correctText}」（${scope}、${r.condition}）\n`;
    });
    text += '\n';
  }

  text += '### プレースホルダールール\n';
  text += '%%ANNOT_xxx%% の形式のプレースホルダーは既存の注釈です。絶対に削除・変更せず、そのまま出力してください。\n';

  return text;
}

// ============================================================
// タスク4: ポスト処理（注釈検証・補完）
// ============================================================

/**
 * リライト済みテキストの注釈を検証し、不足分を補完する
 * @param {string} content - リライト済みセクションのテキスト
 * @param {Array} annotations - マスターデータの注釈一覧
 * @param {Object} symbolMap - 記号定義マップ
 * @param {Array} rules - マスターデータのルール一覧
 * @returns {{ content: string, fixes: string[] }}
 */
function postProcessAnnotations(content, annotations, symbolMap, rules) {
  let result = content;
  const fixes = [];

  // 1. 禁止表現チェック（常時適用）
  const ngRules = rules.filter(r => r.ruleType === '禁止表現' && r.condition === '常に');
  for (const rule of ngRules) {
    if (result.includes(rule.ngText)) {
      result = result.split(rule.ngText).join('');
      fixes.push(`禁止表現削除: 「${rule.ngText}」`);
    }
  }

  // 2. 必須表現チェック（商材言及時のみ）
  const mustRules = rules.filter(r => r.ruleType === '必須表現' || r.ruleType === '正式表記');
  for (const rule of mustRules) {
    if (!result.includes(rule.ngText)) continue;
    // 商材言及チェック
    if (rule.condition === '商材言及時') {
      const relevantProducts = rule.productIds.includes('ALL')
        ? annotations.map(a => a.productName)
        : rule.productIds.map(id => {
            const found = annotations.find(a => a.productId === id);
            return found ? found.productName : id;
          });
      const productMentioned = relevantProducts.some(name => result.includes(name));
      if (!productMentioned) continue;
    }
    if (rule.correctText) {
      result = result.split(rule.ngText).join(rule.correctText);
      fixes.push(`表現修正: 「${rule.ngText}」→「${rule.correctText}」`);
    }
  }

  // 3. 注釈の存在チェック（商材言及時）
  // 各商材名がコンテンツに存在するか確認
  const productNames = [...new Set(annotations.map(a => a.productName))];
  for (const productName of productNames) {
    if (!result.includes(productName)) continue;

    const productAnnotations = annotations.filter(a => a.productName === productName);
    for (const ann of productAnnotations) {
      // トリガーKWが存在するか
      const triggerFound = ann.triggerKws.some(kw => result.includes(kw));
      if (!triggerFound) continue;

      // 既に注釈が存在するか
      const hasSymbolRef = ann.symbol && result.includes(`(${ann.symbol})`);
      const hasInlineAnnotation = result.includes(ann.annotationText);
      const hasPlaceholderAnnotation = /%%ANNOT_\d{3}%%/.test(result); // 既にプレースホルダーがある

      if (hasSymbolRef || hasInlineAnnotation) continue; // 既にある

      // 注釈が不足 → 補完
      for (const kw of ann.triggerKws) {
        if (!result.includes(kw)) continue;

        // 最初の出現箇所に注釈を挿入
        const kwIndex = result.indexOf(kw);
        const afterKw = kwIndex + kw.length;

        // 既にこの位置の直後に注釈やプレースホルダーがないか
        const afterText = result.substring(afterKw, afterKw + 20);
        if (afterText.startsWith('(※') || afterText.startsWith('%%ANNOT_')) continue;

        let insertText;
        if (symbolMap[ann.symbol]) {
          // スペック表に記号定義あり → 記号参照
          insertText = `(${ann.symbol})`;
        } else {
          // インライン注釈
          insertText = `<span style="font-size:12px!important; color:#888!important;">※${ann.annotationText}</span>`;
        }

        result = result.substring(0, afterKw) + insertText + result.substring(afterKw);
        fixes.push(`注釈補完: 「${kw}」の後に${symbolMap[ann.symbol] ? ann.symbol + '記号' : 'インライン注釈'}を挿入`);
        break; // 1トリガーにつき1箇所補完（全箇所は次の走査で）
      }
    }
  }

  return { content: result, fixes: fixes };
}

// ============================================================
// テスト用
// ============================================================
function testInitMasterSheets() {
  Logger.log('=== マスターシート初期化 ===');
  initMasterAnnotationsSheet();
}

function testLoadAnnotations() {
  Logger.log('=== 注釈読み込みテスト ===');
  const anns = loadAnnotations('cardloan');
  Logger.log(`件数: ${anns.length}`);
  anns.forEach(a => Logger.log(`  ${a.productName} [${a.triggerKws.join(',')}] → ${a.symbol}: ${a.annotationText.substring(0, 40)}...`));
}

function testAnnotationContext() {
  Logger.log('=== 記事注釈コンテキスト分析テスト ===');
  const postId = 14582;
  const wpPost = fetchWpPost(postId);
  if (!wpPost) { Logger.log('記事取得失敗'); return; }
  const ctx = analyzeArticleAnnotationContext(wpPost.content.raw);
  Logger.log(`カテゴリ: ${ctx.category}`);
  Logger.log(`記号定義: ${JSON.stringify(ctx.symbolMap)}`);
}
