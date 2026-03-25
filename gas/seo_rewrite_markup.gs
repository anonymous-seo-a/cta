// ============================================================
// Step 3: セクション別リライト → 全文結合
// Step 4: 承認済み全文をWordPressに入稿
// ============================================================
// 前提: rewrite_designシートに「承認」の記事が存在すること
//
// フロー:
//   rewrite_design「承認」→ WP rawコンテンツ取得
//   → H2セクション分割 → セクション別Claude API
//   → 全セクション結合 → rewrite_fulltextシートに全文出力
//   → 人間がSpreadsheetで確認 → 「承認」
//   → applyApprovedFulltext() でWP入稿

const STEP3_CONFIG = {
  MODEL: 'claude-sonnet-4-20250514',
  SECTION_MAX_TOKENS: 8192,
  FULLTEXT_SHEET: 'rewrite_fulltext',
  DESIGN_SHEET: 'rewrite_design',
  // GAS実行時間制限対策: 5分でタイムアウト
  TIMEOUT_MS: 300000,
};

// ============================================================
// Step 3: メイン関数
// ============================================================
function runRewriteStep3() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const START_TIME = new Date().getTime();
  const elapsed = () => Math.round((new Date().getTime() - START_TIME) / 1000);
  const isTimeout = () => (new Date().getTime() - START_TIME) > STEP3_CONFIG.TIMEOUT_MS;

  // 1. rewrite_designから「承認」記事を取得
  const designSheet = ss.getSheetByName(STEP3_CONFIG.DESIGN_SHEET);
  if (!designSheet) {
    Logger.log('rewrite_designシートが見つかりません。先にStep 2（runRewritePhase2）を実行してください。');
    return;
  }

  const lastRow = designSheet.getLastRow();
  if (lastRow < 2) { Logger.log('rewrite_designにデータがありません。'); return; }

  const data = designSheet.getRange(2, 1, lastRow - 1, 15).getValues();
  // [URL, PostID, KW, 順位, ペルソナ, 検索意図, 総合評価, セクション計画, 新規セクション,
  //  表現改善, 古い情報, 優先改善, 追加メモ, ステータス, 設計書JSON]

  let processed = false;

  for (let i = 0; i < data.length; i++) {
    if (processed) break; // 1記事/実行
    if (data[i][13] !== '承認') continue;

    const pageUrl = data[i][0];
    const postId = data[i][1];
    const keyword = data[i][2];
    const designJson = data[i][14];
    const humanNotes = data[i][12]; // 追加メモ
    const designRowNum = i + 2;

    Logger.log(`\n========================================`);
    Logger.log(`[${elapsed()}秒] Step 3開始: ${pageUrl}`);
    Logger.log(`  投稿ID: ${postId}, KW: ${keyword}`);
    Logger.log(`========================================`);

    designSheet.getRange(designRowNum, 14).setValue('リライト中');

    try {
      // 2. 設計書JSONをパース
      let design;
      try {
        design = JSON.parse(designJson);
      } catch (e) {
        Logger.log(`設計書JSONパースエラー: ${e.message}`);
        designSheet.getRange(designRowNum, 14).setValue('承認');
        continue;
      }
      Logger.log(`[A] 設計書パース完了 (${elapsed()}秒)`);

      // 3. WP rawコンテンツ取得
      const wpPost = fetchWpPost(postId);
      if (!wpPost || !wpPost.content || !wpPost.content.raw) {
        Logger.log(`WP記事の取得に失敗: postId=${postId}`);
        designSheet.getRange(designRowNum, 14).setValue('WP取得失敗');
        processed = true;
        continue;
      }
      const rawContent = wpPost.content.raw;
      Logger.log(`[B] WPコンテンツ取得: ${rawContent.length}文字 (${elapsed()}秒)`);

      // 4. H2セクションに分割
      const sections = splitByH2(rawContent);
      Logger.log(`[C] H2分割: ${sections.length}セクション`);
      sections.forEach((s, idx) => {
        Logger.log(`  [${idx}] ${s.heading || '(冒頭)'} : ${s.content.length}文字, CTA=${s.hasCta}, 再利用=${s.hasReusable}`);
      });

      // 5. セクション別リライト
      const rewrittenSections = [];

      for (let j = 0; j < sections.length; j++) {
        if (isTimeout()) {
          Logger.log(`⚠ タイムアウト接近（${elapsed()}秒）。残りセクションは元のまま維持。`);
          for (let k = j; k < sections.length; k++) {
            rewrittenSections.push(sections[k].content);
          }
          break;
        }

        const section = sections[j];
        const sectionDesign = findSectionDesign(design, section.heading);
        const newSectionsHere = findNewSectionsAfter(design, section.heading);

        // 変更不要なセクション（action=維持 かつ 新規追加もなし）
        if (sectionDesign && sectionDesign.action === '維持' && newSectionsHere.length === 0) {
          Logger.log(`  [${j}] 維持: ${section.heading || '(冒頭)'}`);
          rewrittenSections.push(section.content);
          continue;
        }

        // セクション丸ごと削除
        if (sectionDesign && sectionDesign.action === '削除') {
          Logger.log(`  [${j}] 削除: ${section.heading}`);
          const preserved = extractPreservedBlocks(section.content);
          if (preserved) rewrittenSections.push(preserved);
          continue;
        }

        // 冒頭セクション（H2なし）で設計指示もない場合は維持
        if (!section.heading && !sectionDesign && newSectionsHere.length === 0) {
          Logger.log(`  [${j}] 維持（冒頭・指示なし）`);
          rewrittenSections.push(section.content);
          continue;
        }

        // Claude APIでリライト
        Logger.log(`  [${j}] リライト: ${section.heading || '(冒頭)'} (${elapsed()}秒)`);
        const stepStart = new Date().getTime();

        const rewritten = callClaudeSectionRewrite({
          sectionContent: section.content,
          sectionHeading: section.heading,
          sectionIndex: j,
          totalSections: sections.length,
          design: design,
          sectionDesign: sectionDesign,
          newSectionsAfter: newSectionsHere,
          humanNotes: humanNotes,
          keyword: keyword,
        });

        const ms = new Date().getTime() - stepStart;

        if (rewritten) {
          rewrittenSections.push(rewritten);
          Logger.log(`  [${j}] 完了: ${ms}ms`);
        } else {
          rewrittenSections.push(section.content);
          Logger.log(`  [${j}] 失敗（元のまま維持）: ${ms}ms`);
        }
      }

      // 6. 全セクション結合
      const fullText = rewrittenSections.join('\n\n');
      Logger.log(`[D] 全文結合: ${fullText.length}文字 (${elapsed()}秒)`);

      // 7. シートに出力
      writeFulltextSheet(ss, pageUrl, postId, keyword, fullText);
      designSheet.getRange(designRowNum, 14).setValue('リライト済み');
      Logger.log(`★ 成功 (トータル${elapsed()}秒)`);
      processed = true;

    } catch (e) {
      Logger.log(`✗ エラー: ${e.message}\n${e.stack}`);
      designSheet.getRange(designRowNum, 14).setValue('承認');
      processed = true;
    }
  }

  if (!processed) {
    Logger.log('処理対象の「承認」記事がありません。');
  }
  Logger.log(`\n=== Step 3完了 (${elapsed()}秒) ===`);
}

// ============================================================
// H2で記事を分割
// ============================================================
function splitByH2(rawContent) {
  const sections = [];
  // H2のGutenbergブロック開始を検出
  const h2Regex = /<!-- wp:heading(?:\s+\{(?:(?!"level"|"level"\s*:\s*2)[^}])*\})?\s*-->\s*<h2/g;
  // ↑ level指定なし（デフォルト=2）またはlevel:2のみマッチ

  const h2Positions = [];
  let match;
  while ((match = h2Regex.exec(rawContent)) !== null) {
    const commentStart = rawContent.lastIndexOf('<!-- wp:heading', match.index);
    h2Positions.push(commentStart >= 0 ? commentStart : match.index);
  }

  if (h2Positions.length === 0) {
    return [{
      heading: null,
      content: rawContent,
      hasCta: hasCta(rawContent),
      hasReusable: hasReusable(rawContent),
    }];
  }

  // 冒頭セクション
  if (h2Positions[0] > 0) {
    const pre = rawContent.substring(0, h2Positions[0]).trim();
    if (pre) {
      sections.push({
        heading: null,
        content: pre,
        hasCta: hasCta(pre),
        hasReusable: hasReusable(pre),
      });
    }
  }

  // 各H2セクション
  for (let i = 0; i < h2Positions.length; i++) {
    const start = h2Positions[i];
    const end = i + 1 < h2Positions.length ? h2Positions[i + 1] : rawContent.length;
    const sectionContent = rawContent.substring(start, end).trim();

    const headingMatch = sectionContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const headingText = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    sections.push({
      heading: headingText,
      content: sectionContent,
      hasCta: hasCta(sectionContent),
      hasReusable: hasReusable(sectionContent),
    });
  }

  return sections;
}

function hasCta(content) {
  return /<!-- wp:soico-cta\//.test(content);
}

function hasReusable(content) {
  return /<!-- wp:block \{"ref":\d+\} \/-->/.test(content);
}

// ============================================================
// CTA・再利用ブロックを抽出して保持
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
  const systemPrompt = buildSectionRewriteSystemPrompt();
  const userPrompt = buildSectionRewriteUserPrompt(params);

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: STEP3_CONFIG.MODEL,
        max_tokens: STEP3_CONFIG.SECTION_MAX_TOKENS,
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
4. 景品表示法・金融商品取引法に抵触する表現は使用しない
5. 古い情報は最新の情報に更新する。ただし確信がない数値・日付は「※最新情報をご確認ください」と注記する

## コンテンツルール
- ペルソナの不安・疑問に直接答える内容にすること
- 専門用語は初出時に簡潔に説明すること
- 「です・ます」調で統一
- E-E-A-T要素を意識する（具体的な数値、出典、実例）

## 利用可能なデザインパターン

### 見出し
<!-- wp:heading -->
<h2 class="wp-block-heading">見出しH2</h2>
<!-- /wp:heading -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">見出しH3</h3>
<!-- /wp:heading -->

### 段落
<!-- wp:paragraph -->
<p>テキスト</p>
<!-- /wp:paragraph -->

### ボックスデザイン
注意・警告: <div class="box-004">内容</div>
補足・アドバイス: <div class="box-006">内容</div>
ポイント・メリット: <div class="box-008">内容</div>

### 比較表（スクロール対応）
<!-- wp:html -->
<div style="overflow-x: auto;">
<table style="border-collapse: collapse; width: 100%; min-width: 600px;">
  <tr style="background-color: #f0f0f0;"><th style="padding: 8px; border: 1px solid #ddd;">項目</th></tr>
  <tr><td style="padding: 8px; border: 1px solid #ddd;">内容</td></tr>
</table>
</div>
<!-- /wp:html -->

### Q&Aアコーディオン
<!-- wp:html -->
<div style="background-color: #f0f8ff; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <details style="margin-bottom: 8px;">
    <summary style="font-weight: bold; cursor: pointer; padding: 8px;">質問</summary>
    <div style="padding: 8px 8px 0;"><p>回答</p></div>
  </details>
</div>
<!-- /wp:html -->

### ステップ表示
<!-- wp:html -->
<div style="background-color: #f0f7ff; border: 1px solid #b6d4fe; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <div style="margin-bottom: 15px; padding: 8px; background-color: #e6f2ff; border-radius: 4px;">
    <div style="color: #0056b3; font-weight: bold;">1.<b>タイトル</b>：説明</div>
  </div>
</div>
<!-- /wp:html -->

### 記事要約ボックス
<!-- wp:html -->
<div style="border: 2px solid #007BFF; border-radius: 8px; overflow: hidden; margin: 16px 0;">
  <div style="background-color: #007BFF; color: #fff; padding: 12px 16px; font-weight: bold;">この記事の要約</div>
  <div style="padding: 16px;"><ul><li>要約項目</li></ul></div>
</div>
<!-- /wp:html -->

### 強調テキスト
<strong><mark class="has-inline-color has-gold-color" style="background-color:rgba(0, 0, 0, 0)">強調テキスト</mark></strong>

### 出典
<!-- wp:quote -->
<blockquote class="wp-block-quote"><p><a href="URL" rel="noopener" target="_blank">出典名</a></p></blockquote>
<!-- /wp:quote -->

### リスト
<!-- wp:list -->
<ul class="wp-block-list"><li>項目1</li><li>項目2</li></ul>
<!-- /wp:list -->`;
}

// ============================================================
// セクションリライト用ユーザープロンプト
// ============================================================
function buildSectionRewriteUserPrompt(params) {
  const d = params.design;
  const sd = params.sectionDesign;
  const ns = params.newSectionsAfter;

  // ペルソナ情報
  const personaText = d.persona
    ? `【ペルソナ】
年齢層: ${d.persona.age_range || '?'}
状況: ${d.persona.situation || '?'}
知識レベル: ${d.persona.knowledge_level || '?'}
不安・疑問: ${(d.persona.concerns || []).join(' / ')}
求める情報: ${d.persona.desired_info || '?'}`
    : '';

  // 検索意図
  const intentText = d.search_intent_analysis
    ? `【検索意図】
${d.search_intent_analysis.primary_intent || ''}
改善方向: ${d.search_intent_analysis.improvement_direction || ''}`
    : '';

  // セクション固有の指示
  let instructionText = '';
  if (sd) {
    instructionText = `【このセクションへの指示】
アクション: ${sd.action}
${sd.instructions}`;
    if (sd.new_heading) {
      instructionText += `\n見出し変更: ${sd.h2_heading} → ${sd.new_heading}`;
    }
  }

  // 新規セクション追加指示
  let newSectionText = '';
  if (ns && ns.length > 0) {
    newSectionText = '【このセクションの後に追加する新規セクション】\n' +
      ns.map(n => `H${n.heading_level}: ${n.suggested_heading}\n内容: ${n.content_outline}`).join('\n\n');
  }

  // 表現改善（該当セクション分）
  const exprImps = (d.expression_improvements || [])
    .filter(e => params.sectionContent.includes(e.current_text))
    .map(e => `現在: ${e.current_text}\n改善: ${e.improved_text}\n理由: ${e.rationale}`)
    .join('\n\n');
  const exprText = exprImps ? `【表現改善指示】\n${exprImps}` : '';

  // 古い情報（該当セクション分）
  const outdated = (d.outdated_info || [])
    .filter(o => {
      return params.sectionContent.includes(o.current_info) ||
        (params.sectionHeading && o.location === params.sectionHeading);
    })
    .map(o => `古い情報: ${o.current_info}\n更新方向: ${o.update_needed}`)
    .join('\n\n');
  const outdatedText = outdated ? `【古い情報の更新指示】\n${outdated}` : '';

  // 人間の追加メモ
  const notesText = params.humanNotes ? `【人間による追加指示】\n${params.humanNotes}` : '';

  return `以下のセクションをリライトしてください。Gutenbergブロックマークアップのみを出力してください。

メインKW: ${params.keyword}
セクション: ${params.sectionIndex + 1}/${params.totalSections}

${personaText}

${intentText}

${instructionText}

${newSectionText}

${exprText}

${outdatedText}

${notesText}

---

【現在のセクション（Gutenbergマークアップ）】
${params.sectionContent}`;
}

// ============================================================
// 全文出力シート
// ============================================================
function writeFulltextSheet(ss, pageUrl, postId, keyword, fullText) {
  const sheetName = STEP3_CONFIG.FULLTEXT_SHEET;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = ['記事URL', '投稿ID', 'メインKW', '生成日時', 'ステータス', '全文マークアップ'];
    sheet.getRange(1, 1, 1, 6).setValues([headers]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 350);
    sheet.setColumnWidth(4, 180);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 800);
    const sr = sheet.getRange(2, 5, 200, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('確認待ち').setBackground('#FFF3E0').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([sr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('入稿済み').setBackground('#BBDEFB').setRanges([sr]).build(),
    ]);
  }

  const nextRow = sheet.getLastRow() + 1;
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  sheet.getRange(nextRow, 1, 1, 6).setValues([[
    pageUrl, postId, keyword, now, '確認待ち', fullText,
  ]]);
  sheet.getRange(nextRow, 6).setWrap(true);

  Logger.log(`「${sheetName}」に出力完了`);
}

// ============================================================
// Step 4: 承認済み全文をWordPressに入稿
// ============================================================
function applyApprovedFulltext() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STEP3_CONFIG.FULLTEXT_SHEET);
  if (!sheet) {
    Logger.log('rewrite_fulltextシートが見つかりません。先にStep 3を実行してください。');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  let applied = 0;

  for (let i = 0; i < data.length; i++) {
    const status = data[i][4];
    if (status !== '承認') continue;

    const pageUrl = data[i][0];
    const postId = data[i][1];
    const fullText = data[i][5];
    const rowNum = i + 2;

    Logger.log(`--- 入稿: ${pageUrl} (ID: ${postId}) ---`);

    if (!fullText || fullText.length < 100) {
      Logger.log('全文が空または極端に短い。スキップ。');
      sheet.getRange(rowNum, 5).setValue('データ不正');
      continue;
    }

    if (updateWpPost(postId, fullText)) {
      Logger.log(`更新成功: ${fullText.length}文字`);
      sheet.getRange(rowNum, 5).setValue('入稿済み');
      applied++;
    } else {
      Logger.log('更新失敗');
      sheet.getRange(rowNum, 5).setValue('入稿失敗');
    }

    Utilities.sleep(1000);
  }

  Logger.log(`=== Step 4完了: ${applied}件入稿 ===`);
}

// ============================================================
// テスト用
// ============================================================
function testStep3() {
  Logger.log('=== Step 3 テスト実行 ===');
  runRewriteStep3();
}

function testSplitByH2() {
  Logger.log('=== H2分割テスト ===');
  const postId = 18087;
  const wpPost = fetchWpPost(postId);
  if (!wpPost) { Logger.log('記事取得失敗'); return; }
  const sections = splitByH2(wpPost.content.raw);
  Logger.log(`セクション数: ${sections.length}`);
  sections.forEach((s, i) => {
    Logger.log(`[${i}] ${s.heading || '(冒頭)'}: ${s.content.length}文字, CTA=${s.hasCta}`);
  });
}
