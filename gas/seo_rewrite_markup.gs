// ============================================================
// Step 3: セクション別リライト → 全文結合（再開可能）
// Step 4: 承認済み全文をWordPressに入稿
// ============================================================
//
// タイムアウト対策: rewrite_progressシートにセクションごとの進捗を保存。
// 再実行時は処理済みセクションをスキップして続きから再開。
// 全セクション完了後にGoogle Driveにファイル保存。

const REWRITE_STEP3 = {
  MODEL: 'claude-sonnet-4-20250514',
  SECTION_MAX_TOKENS: 8192,
  FULLTEXT_SHEET: 'rewrite_fulltext',
  DESIGN_SHEET: 'rewrite_design',
  PROGRESS_SHEET: 'rewrite_progress',
  DRIVE_FOLDER_NAME: 'soico_rewrite_output',
  TIMEOUT_MS: 280000, // 4分40秒（余裕を持たせる）
};

// ============================================================
// Step 3: メイン関数（再開可能）
// ============================================================
function runRewriteStep3() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const START_TIME = new Date().getTime();
  const elapsed = () => Math.round((new Date().getTime() - START_TIME) / 1000);
  const isTimeout = () => (new Date().getTime() - START_TIME) > REWRITE_STEP3.TIMEOUT_MS;

  // 1. 進行中の処理があるか確認
  const progress = loadProgress(ss);
  let targetPostId, targetUrl, targetKeyword, designRowNum, design, humanNotes;
  let annotationCtx, masterAnnotations, masterRules, annotationPromptText;
  let sections, processedSections;

  if (progress) {
    // === 再開モード ===
    Logger.log(`\n========================================`);
    Logger.log(`[${elapsed()}秒] Step 3再開: ${progress.url}`);
    Logger.log(`  進捗: ${progress.completedCount}/${progress.totalSections}セクション処理済み`);
    Logger.log(`========================================`);

    targetPostId = progress.postId;
    targetUrl = progress.url;
    targetKeyword = progress.keyword;
    designRowNum = progress.designRowNum;

    // 設計書を再取得
    const designSheet = ss.getSheetByName(REWRITE_STEP3.DESIGN_SHEET);
    const designData = designSheet.getRange(designRowNum, 1, 1, 15).getValues()[0];
    try { design = JSON.parse(designData[14]); } catch (e) { Logger.log('設計書JSONパースエラー'); return; }
    humanNotes = designData[12];

    // WPコンテンツ再取得 → セクション分割
    const wpPost = fetchWpPost(targetPostId);
    if (!wpPost || !wpPost.content) { Logger.log('WP取得失敗'); return; }

    annotationCtx = analyzeArticleAnnotationContext(wpPost.content.raw);
    masterAnnotations = loadAnnotations(annotationCtx.category);
    masterRules = loadRules(annotationCtx.category);
    annotationPromptText = buildAnnotationPromptText(annotationCtx.category, annotationCtx.symbolMap);

    sections = splitByH2(wpPost.content.raw);
    processedSections = loadProcessedSections(ss, targetPostId);
    Logger.log(`[B] セクション: ${sections.length}件, 処理済み: ${Object.keys(processedSections).length}件 (${elapsed()}秒)`);

  } else {
    // === 新規モード ===
    const designSheet = ss.getSheetByName(REWRITE_STEP3.DESIGN_SHEET);
    if (!designSheet) { Logger.log('rewrite_designシートが見つかりません。'); return; }

    const lastRow = designSheet.getLastRow();
    if (lastRow < 2) { Logger.log('データなし'); return; }

    const allData = designSheet.getRange(2, 1, lastRow - 1, 15).getValues();
    let found = false;

    for (let i = 0; i < allData.length; i++) {
      if (allData[i][13] !== '承認') continue;

      targetUrl = allData[i][0];
      targetPostId = allData[i][1];
      targetKeyword = allData[i][2];
      humanNotes = allData[i][12];
      designRowNum = i + 2;

      try { design = JSON.parse(allData[i][14]); } catch (e) { continue; }

      Logger.log(`\n========================================`);
      Logger.log(`[${elapsed()}秒] Step 3開始: ${targetUrl}`);
      Logger.log(`  投稿ID: ${targetPostId}, KW: ${targetKeyword}`);
      Logger.log(`========================================`);

      designSheet.getRange(designRowNum, 14).setValue('リライト中');
      found = true;
      break;
    }

    if (!found) { Logger.log('処理対象の「承認」記事がありません。'); return; }

    // WPコンテンツ取得
    const wpPost = fetchWpPost(targetPostId);
    if (!wpPost || !wpPost.content || !wpPost.content.raw) {
      Logger.log('WP取得失敗');
      const ds = ss.getSheetByName(REWRITE_STEP3.DESIGN_SHEET);
      ds.getRange(designRowNum, 14).setValue('WP取得失敗');
      return;
    }
    const rawContent = wpPost.content.raw;
    Logger.log(`[B] WPコンテンツ取得: ${rawContent.length}文字 (${elapsed()}秒)`);

    // 注釈コンテキスト
    annotationCtx = analyzeArticleAnnotationContext(rawContent);
    masterAnnotations = loadAnnotations(annotationCtx.category);
    masterRules = loadRules(annotationCtx.category);
    annotationPromptText = buildAnnotationPromptText(annotationCtx.category, annotationCtx.symbolMap);
    Logger.log(`[B2] 注釈: カテゴリ=${annotationCtx.category}, 記号=${JSON.stringify(annotationCtx.symbolMap)} (${elapsed()}秒)`);

    // セクション分割
    sections = splitByH2(rawContent);
    Logger.log(`[C] H2分割: ${sections.length}セクション`);
    sections.forEach((s, idx) => {
      Logger.log(`  [${idx}] ${s.heading || '(冒頭)'} : ${s.content.length}文字`);
    });

    // 進捗シート初期化
    initProgress(ss, targetPostId, targetUrl, targetKeyword, designRowNum, sections.length);
    processedSections = {};
  }

  // 2. セクション別リライト
  let newCompletions = 0;

  for (let j = 0; j < sections.length; j++) {
    if (isTimeout()) {
      Logger.log(`⚠ タイムアウト接近（${elapsed()}秒）。再度runRewriteStep3()を実行してください。`);
      return; // 進捗は保存済み。再実行で続きから。
    }

    // 処理済みならスキップ
    if (processedSections[j] !== undefined) {
      continue;
    }

    const section = sections[j];
    const sectionDesign = findSectionDesign(design, section.heading);
    const newSectionsHere = findNewSectionsAfter(design, section.heading);

    // 変更不要
    if (sectionDesign && sectionDesign.action === '維持' && newSectionsHere.length === 0) {
      Logger.log(`  [${j}] 維持: ${section.heading || '(冒頭)'}`);
      saveProcessedSection(ss, targetPostId, j, section.content);
      newCompletions++;
      continue;
    }

    // 削除
    if (sectionDesign && sectionDesign.action === '削除') {
      Logger.log(`  [${j}] 削除: ${section.heading}`);
      const preserved = extractPreservedBlocks(section.content);
      saveProcessedSection(ss, targetPostId, j, preserved || '');
      newCompletions++;
      continue;
    }

    // 冒頭で指示なし
    if (!section.heading && !sectionDesign && newSectionsHere.length === 0) {
      Logger.log(`  [${j}] 維持（冒頭・指示なし）`);
      saveProcessedSection(ss, targetPostId, j, section.content);
      newCompletions++;
      continue;
    }

    // Claude APIでリライト
    Logger.log(`  [${j}] リライト: ${section.heading || '(冒頭)'} (${elapsed()}秒)`);
    const stepStart = new Date().getTime();

    const extracted = extractAnnotationsToPlaceholders(section.content);
    if (extracted.annotations.length > 0) {
      Logger.log(`    注釈退避: ${extracted.annotations.length}件`);
    }

    const rewritten = callClaudeSectionRewrite({
      sectionContent: extracted.content,
      sectionHeading: section.heading,
      sectionIndex: j,
      totalSections: sections.length,
      design: design,
      sectionDesign: sectionDesign,
      newSectionsAfter: newSectionsHere,
      humanNotes: humanNotes,
      keyword: targetKeyword,
      annotationPromptText: annotationPromptText,
    });

    const ms = new Date().getTime() - stepStart;

    if (rewritten) {
      let restored = restoreAnnotationsFromPlaceholders(rewritten, extracted.annotations);
      const postResult = postProcessAnnotations(restored, masterAnnotations, annotationCtx.symbolMap, masterRules);
      restored = postResult.content;
      if (postResult.fixes.length > 0) {
        Logger.log(`    ポスト処理: ${postResult.fixes.length}件修正`);
        postResult.fixes.forEach(f => Logger.log(`      ${f}`));
      }
      saveProcessedSection(ss, targetPostId, j, restored);
      Logger.log(`  [${j}] 完了: ${ms}ms`);
    } else {
      saveProcessedSection(ss, targetPostId, j, section.content);
      Logger.log(`  [${j}] 失敗（元のまま維持）: ${ms}ms`);
    }
    newCompletions++;
  }

  // 3. 全セクション完了チェック
  const allProcessed = loadProcessedSections(ss, targetPostId);
  const completedCount = Object.keys(allProcessed).length;

  if (completedCount < sections.length) {
    Logger.log(`\n進捗: ${completedCount}/${sections.length}。再度runRewriteStep3()を実行してください。`);
    return;
  }

  // 4. 全セクション結合
  Logger.log(`\n[D] 全セクション完了。結合中... (${elapsed()}秒)`);
  const orderedSections = [];
  for (let j = 0; j < sections.length; j++) {
    orderedSections.push(allProcessed[j] || sections[j].content);
  }
  const fullText = orderedSections.join('\n\n');
  Logger.log(`  全文: ${fullText.length}文字`);

  // 5. Google Driveに保存
  const driveUrl = saveToGoogleDrive(targetPostId, targetKeyword, fullText);
  Logger.log(`[E] Google Drive保存完了: ${driveUrl} (${elapsed()}秒)`);

  // 6. rewrite_fulltextシートに記録
  writeFulltextSheet(ss, targetUrl, targetPostId, targetKeyword, fullText.length, driveUrl);

  // 7. 進捗シートクリア & デザインシート更新
  clearProgress(ss, targetPostId);
  const designSheet = ss.getSheetByName(REWRITE_STEP3.DESIGN_SHEET);
  if (designSheet) designSheet.getRange(designRowNum, 14).setValue('リライト済み');

  Logger.log(`★ 完了 (トータル${elapsed()}秒)`);
}

// ============================================================
// 進捗管理（rewrite_progressシート）
// ============================================================
function getProgressSheet(ss) {
  let sheet = ss.getSheetByName(REWRITE_STEP3.PROGRESS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REWRITE_STEP3.PROGRESS_SHEET);
    const h = ['投稿ID', 'セクション番号', 'リライト済みコンテンツ', 'URL', 'KW', 'designRowNum', 'totalSections'];
    sheet.getRange(1, 1, 1, 7).setValues([h]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#424242').setFontColor('#FFFFFF');
  }
  return sheet;
}

function initProgress(ss, postId, url, keyword, designRowNum, totalSections) {
  const sheet = getProgressSheet(ss);
  // メタ行（セクション番号 = -1）
  sheet.appendRow([postId, -1, '', url, keyword, designRowNum, totalSections]);
}

function loadProgress(ss) {
  const sheet = ss.getSheetByName(REWRITE_STEP3.PROGRESS_SHEET);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  // メタ行を探す
  for (const row of data) {
    if (row[1] === -1) {
      const completed = data.filter(r => r[0] === row[0] && r[1] >= 0).length;
      return {
        postId: row[0],
        url: row[3],
        keyword: row[4],
        designRowNum: row[5],
        totalSections: row[6],
        completedCount: completed,
      };
    }
  }
  return null;
}

function loadProcessedSections(ss, postId) {
  const sheet = ss.getSheetByName(REWRITE_STEP3.PROGRESS_SHEET);
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const result = {};
  for (const row of data) {
    if (row[0] === postId && row[1] >= 0) {
      result[row[1]] = row[2];
    }
  }
  return result;
}

function saveProcessedSection(ss, postId, sectionIndex, content) {
  const sheet = getProgressSheet(ss);
  sheet.appendRow([postId, sectionIndex, content, '', '', '', '']);
}

function clearProgress(ss, postId) {
  const sheet = ss.getSheetByName(REWRITE_STEP3.PROGRESS_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // 該当postIdの行を後ろから削除
  for (let i = lastRow; i >= 2; i--) {
    if (sheet.getRange(i, 1).getValue() === postId) {
      sheet.deleteRow(i);
    }
  }
}

// ============================================================
// Google Drive保存
// ============================================================
function saveToGoogleDrive(postId, keyword, fullText) {
  // 出力フォルダを取得or作成
  let folders = DriveApp.getFoldersByName(REWRITE_STEP3.DRIVE_FOLDER_NAME);
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(REWRITE_STEP3.DRIVE_FOLDER_NAME);
  }

  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');
  const fileName = `rewrite_${postId}_${keyword}_${dateStr}.html`;

  const file = folder.createFile(fileName, fullText, MimeType.HTML);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}

// ============================================================
// 全文出力シート（Google Driveリンク版）
// ============================================================
function writeFulltextSheet(ss, pageUrl, postId, keyword, charCount, driveUrl) {
  const sheetName = REWRITE_STEP3.FULLTEXT_SHEET;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = ['記事URL', '投稿ID', 'メインKW', '生成日時', '文字数', 'Google Driveリンク', 'ステータス'];
    sheet.getRange(1, 1, 1, 7).setValues([headers]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 350); sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 400); sheet.setColumnWidth(7, 100);
    const sr = sheet.getRange(2, 7, 200, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('確認待ち').setBackground('#FFF3E0').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('入稿済み').setBackground('#BBDEFB').setRanges([sr]).build(),
    ]);
  }

  const nextRow = sheet.getLastRow() + 1;
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  sheet.getRange(nextRow, 1, 1, 7).setValues([[
    pageUrl, postId, keyword, now, charCount, driveUrl, '確認待ち',
  ]]);

  Logger.log(`「${sheetName}」に出力完了`);
}

// ============================================================
// Step 4: 承認済み全文をWordPressに入稿
// ============================================================
function applyApprovedFulltext() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REWRITE_STEP3.FULLTEXT_SHEET);
  if (!sheet) { Logger.log('rewrite_fulltextシートが見つかりません。'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  let applied = 0;

  for (let i = 0; i < data.length; i++) {
    const status = data[i][6];
    if (status !== '承認') continue;

    const pageUrl = data[i][0];
    const postId = data[i][1];
    const driveUrl = data[i][5];
    const rowNum = i + 2;

    Logger.log(`--- 入稿: ${pageUrl} (ID: ${postId}) ---`);

    // Google Driveからファイル内容を取得
    const fullText = readFromGoogleDrive(driveUrl);
    if (!fullText || fullText.length < 100) {
      Logger.log('Driveファイルの読み取りに失敗または内容が空');
      sheet.getRange(rowNum, 7).setValue('読取失敗');
      continue;
    }

    Logger.log(`  読み取り: ${fullText.length}文字`);

    if (updateWpPost(postId, fullText)) {
      Logger.log(`更新成功`);
      sheet.getRange(rowNum, 7).setValue('入稿済み');
      applied++;
    } else {
      Logger.log('更新失敗');
      sheet.getRange(rowNum, 7).setValue('入稿失敗');
    }

    Utilities.sleep(1000);
  }

  Logger.log(`=== Step 4完了: ${applied}件入稿 ===`);
}

function readFromGoogleDrive(driveUrl) {
  try {
    // URLからファイルIDを抽出
    const idMatch = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) {
      Logger.log(`DriveファイルID抽出失敗: ${driveUrl}`);
      return null;
    }
    const file = DriveApp.getFileById(idMatch[1]);
    return file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    Logger.log(`Drive読み取りエラー: ${e.message}`);
    return null;
  }
}

// ============================================================
// H2で記事を分割
// ============================================================
function splitByH2(rawContent) {
  const sections = [];
  const h2Regex = /<!-- wp:heading(?:\s+\{(?:(?!"level"|"level"\s*:\s*2)[^}])*\})?\s*-->\s*<h2/g;

  const h2Positions = [];
  let match;
  while ((match = h2Regex.exec(rawContent)) !== null) {
    const commentStart = rawContent.lastIndexOf('<!-- wp:heading', match.index);
    h2Positions.push(commentStart >= 0 ? commentStart : match.index);
  }

  if (h2Positions.length === 0) {
    return [{ heading: null, content: rawContent, hasCta: hasCta(rawContent), hasReusable: hasReusable(rawContent) }];
  }

  if (h2Positions[0] > 0) {
    const pre = rawContent.substring(0, h2Positions[0]).trim();
    if (pre) sections.push({ heading: null, content: pre, hasCta: hasCta(pre), hasReusable: hasReusable(pre) });
  }

  for (let i = 0; i < h2Positions.length; i++) {
    const start = h2Positions[i];
    const end = i + 1 < h2Positions.length ? h2Positions[i + 1] : rawContent.length;
    const sectionContent = rawContent.substring(start, end).trim();
    const headingMatch = sectionContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const headingText = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    sections.push({ heading: headingText, content: sectionContent, hasCta: hasCta(sectionContent), hasReusable: hasReusable(sectionContent) });
  }

  return sections;
}

function hasCta(content) { return /<!-- wp:soico-cta\//.test(content); }
function hasReusable(content) { return /<!-- wp:block \{"ref":\d+\} \/-->/.test(content); }

// ============================================================
// CTA・再利用ブロック抽出
// ============================================================
function extractPreservedBlocks(content) {
  const preserved = [];
  const ctaPattern = /<!-- wp:soico-cta\/[^\n]+\/-->/g;
  let m;
  while ((m = ctaPattern.exec(content)) !== null) preserved.push(m[0]);
  const reusablePattern = /<!-- wp:block \{"ref":\d+\} \/-->/g;
  while ((m = reusablePattern.exec(content)) !== null) preserved.push(m[0]);
  return preserved.length > 0 ? preserved.join('\n\n') : '';
}

// ============================================================
// 設計書からセクション指示を検索
// ============================================================
function findSectionDesign(design, heading) {
  if (!heading || !design.section_plan) return null;
  for (const sp of design.section_plan) {
    if (sp.h2_heading === heading) return sp;
  }
  for (const sp of design.section_plan) {
    if (heading.includes(sp.h2_heading) || sp.h2_heading.includes(heading)) return sp;
  }
  return null;
}

function findNewSectionsAfter(design, heading) {
  if (!design.new_sections) return [];
  return design.new_sections.filter(ns => ns.insert_after === heading);
}

// ============================================================
// セクション別Claude APIリライト
// ============================================================
function callClaudeSectionRewrite(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  const systemPrompt = buildSectionRewriteSystemPrompt() + (params.annotationPromptText || '');
  const userPrompt = buildSectionRewriteUserPrompt(params);

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: REWRITE_STEP3.MODEL,
        max_tokens: REWRITE_STEP3.SECTION_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`    Claude APIエラー: ${response.getResponseCode()}`);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    if (data.usage) Logger.log(`    トークン: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);
    return data.content[0].text;
  } catch (e) {
    Logger.log(`    Claude API例外: ${e.message}`);
    return null;
  }
}

// ============================================================
// セクションリライト用システムプロンプト
// ============================================================
function buildSectionRewriteSystemPrompt() {
  return `あなたは金融アフィリエイトメディアのWordPressコンテンツ編集の専門家です。
記事の1セクション（H2単位）のリライトを行います。

## 絶対ルール
1. 出力はWordPressのGutenbergブロックマークアップのみ。説明文やJSON等は一切出力しない
2. CTA関連ブロック（<!-- wp:soico-cta/ で始まるもの）は一字一句変更せずそのまま出力すること
3. 再利用ブロック（<!-- wp:block {"ref":数字} /-->）は一字一句変更せずそのまま出力すること
4. [KEEP_ANNOTATION_xxx] プレースホルダーは既存の必須注釈。絶対に削除・変更せず、元の位置にそのまま出力すること
5. 景品表示法・金融商品取引法に抵触する表現は使用しない
6. 古い情報は最新の情報に更新する。ただし確信がない数値・日付は「※最新情報をご確認ください」と注記する
7. 商材（金融サービス）のスペック数値（金利・限度額・審査時間等）は変更しないこと。不明な場合は元の表記を維持する

## コンテンツルール
- ペルソナの不安・疑問に直接答える内容にすること
- 専門用語は初出時に簡潔に説明すること
- 「です・ます」調で統一
- E-E-A-T要素を意識する（具体的な数値、出典、実例）

## デザインパターン
<!-- wp:heading -->
<h2 class="wp-block-heading">H2</h2>
<!-- /wp:heading -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">H3</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>テキスト</p>
<!-- /wp:paragraph -->

ボックス: <div class="box-004">注意</div> / <div class="box-006">補足</div> / <div class="box-008">ポイント</div>

強調: <strong><mark class="has-inline-color has-gold-color" style="background-color:rgba(0, 0, 0, 0)">テキスト</mark></strong>

<!-- wp:list -->
<ul class="wp-block-list"><li>項目</li></ul>
<!-- /wp:list -->`;
}

// ============================================================
// セクションリライト用ユーザープロンプト
// ============================================================
function buildSectionRewriteUserPrompt(params) {
  const d = params.design;
  const sd = params.sectionDesign;
  const ns = params.newSectionsAfter;

  const personaText = d.persona
    ? `【ペルソナ】${d.persona.age_range || '?'} / ${d.persona.knowledge_level || '?'}
状況: ${d.persona.situation || '?'}
不安: ${(d.persona.concerns || []).join(' / ')}
求める情報: ${d.persona.desired_info || '?'}`
    : '';

  const intentText = d.search_intent_analysis
    ? `【検索意図】${d.search_intent_analysis.primary_intent || ''}
改善方向: ${d.search_intent_analysis.improvement_direction || ''}`
    : '';

  let instructionText = '';
  if (sd) {
    instructionText = `【このセクションへの指示】
アクション: ${sd.action}
${sd.instructions}`;
    if (sd.new_heading) instructionText += `\n見出し変更: ${sd.h2_heading} → ${sd.new_heading}`;
  }

  let newSectionText = '';
  if (ns && ns.length > 0) {
    newSectionText = '【このセクションの後に追加する新規セクション】\n' +
      ns.map(n => `H${n.heading_level}: ${n.suggested_heading}\n内容: ${n.content_outline}`).join('\n\n');
  }

  const exprImps = (d.expression_improvements || [])
    .filter(e => params.sectionContent.includes(e.current_text))
    .map(e => `現在: ${e.current_text} → 改善: ${e.improved_text}`)
    .join('\n');
  const exprText = exprImps ? `【表現改善】\n${exprImps}` : '';

  const outdated = (d.outdated_info || [])
    .filter(o => params.sectionContent.includes(o.current_info) || (params.sectionHeading && o.location === params.sectionHeading))
    .map(o => `古い: ${o.current_info} → 更新: ${o.update_needed}`)
    .join('\n');
  const outdatedText = outdated ? `【古い情報の更新】\n${outdated}` : '';

  const notesText = params.humanNotes ? `【人間の追加指示】\n${params.humanNotes}` : '';

  return `セクションをリライトしてください。Gutenbergブロックマークアップのみを出力。

KW: ${params.keyword} / セクション: ${params.sectionIndex + 1}/${params.totalSections}

${personaText}
${intentText}
${instructionText}
${newSectionText}
${exprText}
${outdatedText}
${notesText}

---
【現在のセクション】
${params.sectionContent}`;
}

// ============================================================
// テスト用
// ============================================================
function testStep3() {
  Logger.log('=== Step 3 テスト実行 ===');
  runRewriteStep3();
}

function testSplitByH2() {
  const postId = 18429;
  const wpPost = fetchWpPost(postId);
  if (!wpPost) { Logger.log('失敗'); return; }
  const sections = splitByH2(wpPost.content.raw);
  Logger.log(`セクション数: ${sections.length}`);
  sections.forEach((s, i) => Logger.log(`[${i}] ${s.heading || '(冒頭)'}: ${s.content.length}文字`));
}
