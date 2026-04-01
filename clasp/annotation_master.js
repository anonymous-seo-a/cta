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
  // Claude APIが%を消すため、角括弧ベースのプレースホルダーに変更
  PLACEHOLDER_PREFIX: '[KEEP_ANNOTATION_',
  PLACEHOLDER_SUFFIX: ']',
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
  const preserved = [];  // 復元対象（出典リンク、記号定義行）
  let result = content;
  let removedCount = 0;

  // ========== 退避対象（復元する） ==========

  // パターンP1: 出典リンクを含むspan注釈（<a>タグ含有）
  result = result.replace(/<span\s+style="font-size:\s*1[12]px[^"]*">[^<]*<a\s[^>]*>[^<]*<\/a>[^<]*<\/span>/gi, (match) => {
    const idx = preserved.length;
    preserved.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // パターンP2: <p style="font-size:12px">の出典段落（<a>タグ含有）
  result = result.replace(/<p\s+style="font-size:\s*1[12]px[^"]*">[^<]*<[^>]*>[^]*?<\/p>/gi, (match) => {
    if (!/<a\s/i.test(match)) return match; // リンクなし→退避しない
    const idx = preserved.length;
    preserved.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // パターンP3: ※a: ※p: 等の注釈定義行（スペック表内の記号定義）
  result = result.replace(/※[a-z]{1,2}[:：][^<\n]+/gi, (match) => {
    const idx = preserved.length;
    preserved.push(match);
    return `${ANNOTATION_CONFIG.PLACEHOLDER_PREFIX}${String(idx).padStart(3, '0')}${ANNOTATION_CONFIG.PLACEHOLDER_SUFFIX}`;
  });

  // ========== 除去対象（復元しない、postProcessで再挿入） ==========

  // パターンR1: 商材インライン注釈 <span style="font-size:...">※...</span>（出典リンクは上で退避済み）
  result = result.replace(/<span\s+style="font-size:\s*1[12]px[^"]*">\s*※[^<]+<\/span>/gi, (match) => {
    removedCount++;
    return '';
  });

  // パターンR2: (※a) (※p) (※m) (※ai) 等の記号参照
  result = result.replace(/\(※[a-z]{1,3}\)/gi, (match) => {
    removedCount++;
    return '';
  });

  // パターンR3: 段落内の※で始まるインライン注釈（出典・プレースホルダー以外）
  result = result.replace(/(?<!\[KEEP_ANNOTATION_\d{3})※[^<\n\[]{5,}/g, (match) => {
    if (match.includes(ANNOTATION_CONFIG.PLACEHOLDER_PREFIX)) return match;
    // 出典（「出典」「参考」を含む）は除去しない
    if (/出典|参考|引用/.test(match)) return match;
    removedCount++;
    return '';
  });

  Logger.log(`    注釈処理: ${preserved.length}件退避（出典等）, ${removedCount}件除去（商材注釈）`);
  return { content: result, annotations: preserved };
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

  let text = '\n\n## 金融レギュレーション遵守ルール\n\n';

  text += '### 重要: 注釈は自分で挿入しないこと\n';
  text += '※で始まる注釈テキスト、(※a)(※p)等の記号参照は、ポスト処理で自動挿入されます。\n';
  text += 'あなたは注釈を一切挿入しないでください。既存の [KEEP_ANNOTATION_xxx] プレースホルダーだけ保持してください。\n\n';

  // 禁止表現（これだけはClaude APIが守る必要がある）
  const ngRules = rules.filter(r => r.ruleType === '禁止表現');
  if (ngRules.length > 0) {
    text += '### 絶対NG表現（使用禁止）\n';
    text += 'これらの表現は絶対に使用しないでください。\n';
    ngRules.forEach(r => { text += `- ✕「${r.ngText}」\n`; });
    text += '\n';
  }

  // 必須表現（正しい表現への置換 — これもClaude APIが守る）
  const mustRules = rules.filter(r => r.ruleType === '必須表現' || r.ruleType === '正式表記');
  if (mustRules.length > 0) {
    text += '### 正しい表現ルール\n';
    text += '以下の左側の表現が出現する場合、右側の正しい表現に置き換えてください。\n';
    mustRules.forEach(r => {
      const scope = r.productIds.includes('ALL') ? '全社' : r.productIds.join('/');
      text += `- ✕「${r.ngText}」→ ○「${r.correctText}」（${scope}）\n`;
    });
    text += '\n';
  }

  text += '### プレースホルダールール\n';
  text += '[KEEP_ANNOTATION_xxx] の形式のプレースホルダーは既存の注釈です。絶対に削除・変更せず、そのまま出力してください。\n';

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
  const usedFootnotes = {}; // { number: annotationText } — このセクションで使った番号注釈

  // 番号マッピング: annotationText → ※N番号（symbolMap未定義の注釈のみ）
  // master_annotationsの順序に基づいて決定的に割り当て（記事全体で一意）
  const numberMap = {};
  let nextNum = 1;
  for (const ann of annotations) {
    if (symbolMap[ann.symbol]) continue; // symbolMap定義あり → 番号不要
    if (!numberMap[ann.annotationText]) {
      numberMap[ann.annotationText] = nextNum++;
    }
  }

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

  // 3. 商材注釈を全トリガーKW出現箇所に挿入
  const productNames = [...new Set(annotations.map(a => a.productName))];

  for (const productName of productNames) {
    if (!result.includes(productName)) continue;

    const productAnnotations = annotations.filter(a => a.productName === productName);
    for (const ann of productAnnotations) {
      const triggerFound = ann.triggerKws.some(kw => result.includes(kw));
      if (!triggerFound) continue;

      let inserted = false;
      for (const kw of ann.triggerKws) {
        if (!result.includes(kw)) continue;

        // KWの全出現位置を収集（後方から処理）
        const positions = [];
        let searchFrom = 0;
        while (true) {
          const idx = result.indexOf(kw, searchFrom);
          if (idx === -1) break;
          positions.push(idx);
          searchFrom = idx + kw.length;
        }
        positions.reverse();

        for (const kwIndex of positions) {
          const afterKw = kwIndex + kw.length;

          // HTML属性値内（href, src, style等）のKW出現はスキップ
          const beforeKw = result.substring(Math.max(0, kwIndex - 300), kwIndex);
          const lastOpenTag = beforeKw.lastIndexOf('<');
          const lastCloseTag = beforeKw.lastIndexOf('>');
          if (lastOpenTag > lastCloseTag) continue;

          // 直後に既に注釈がないか確認
          const afterText = result.substring(afterKw, afterKw + 30);
          if (afterText.startsWith('(※') || afterText.startsWith('<span style="font-size:1')) continue;

          // 注釈形式を決定
          let insertText;
          if (symbolMap[ann.symbol]) {
            // symbolMap定義あり → 記号参照
            insertText = `(${ann.symbol})`;
          } else {
            // symbolMap定義なし → 段落内の商材数で分岐
            const pStart = result.lastIndexOf('<p>', kwIndex);
            const pEnd = result.indexOf('</p>', kwIndex);
            let productsInContext = 1;
            if (pStart >= 0 && pEnd >= 0) {
              const paragraph = result.substring(pStart, pEnd);
              productsInContext = productNames.filter(name => paragraph.includes(name)).length;
            }

            if (productsInContext >= 3) {
              // 3社以上 → 番号参照
              const num = numberMap[ann.annotationText];
              insertText = `(※${num})`;
              usedFootnotes[num] = ann.annotationText;
            } else {
              // 2社以下 → インライン注釈
              insertText = `<span style="font-size:12px!important; color:#888!important;">※${ann.annotationText}</span>`;
            }
          }

          result = result.substring(0, afterKw) + insertText + result.substring(afterKw);
          inserted = true;
        }

        if (inserted) {
          const mode = symbolMap[ann.symbol] ? ann.symbol + '記号' : (Object.values(usedFootnotes).includes(ann.annotationText) ? '番号参照' : 'インライン');
          fixes.push(`注釈挿入: 「${kw}」(${positions.length}箇所) → ${mode}`);
          break;
        }
      }
    }
  }

  // 4. セクション末尾に番号注釈リストを追加（使用分のみ）
  const footnoteNumbers = Object.keys(usedFootnotes).map(Number).sort((a, b) => a - b);
  if (footnoteNumbers.length > 0) {
    let footnoteHtml = '\n\n<!-- wp:html -->\n<div style="font-size: 12px; color: #888; margin-top: 16px; line-height: 1.8;">\n';
    for (const num of footnoteNumbers) {
      footnoteHtml += `<p style="margin: 0;">※${num}: ${usedFootnotes[num]}</p>\n`;
    }
    footnoteHtml += '</div>\n<!-- /wp:html -->';
    result += footnoteHtml;
    fixes.push(`番号注釈リスト追加: ${footnoteNumbers.length}件（※${footnoteNumbers.join(', ※')}）`);
  }

  return { content: result, fixes: fixes, footnotes: footnoteNumbers };
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