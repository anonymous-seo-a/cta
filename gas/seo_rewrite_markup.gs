// ============================================================
// Phase 2.5: Gutenbergマークアップ生成
// ============================================================
// 前提: Phase 2のrewrite_planシートに「承認待ち」の記事が存在すること
// 動作: 1記事/実行。rewrite_*シートの分析結果 + WP記事のrawコンテンツ +
//        デザインパターンテンプレートをClaude APIに渡し、
//        変更箇所ごとに完成形Gutenbergブロックマークアップを生成する。

const MARKUP_CONFIG = {
  MAX_ARTICLES_PER_RUN: 1,
  MARKUP_MODEL: 'claude-sonnet-4-20250514',
  MARKUP_MAX_TOKENS: 8192,
  MARKUP_SHEET_PREFIX: 'rewrite_markup_',
  // WPコンテンツの最大文字数（プロンプトサイズ制御）
  MAX_WP_CONTENT_LENGTH: 40000,
};

// ============================================================
// メイン関数
// ============================================================
function runRewritePhase25() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const START_TIME = new Date().getTime();
  const elapsed = () => Math.round((new Date().getTime() - START_TIME) / 1000);

  // 1. rewrite_planから「承認待ち」記事を取得
  const planSheet = ss.getSheetByName(REWRITE_CONFIG.REWRITE_PLAN_SHEET);
  if (!planSheet) {
    Logger.log('rewrite_planシートが見つかりません。先にPhase 2を実行してください。');
    return;
  }

  const planLastRow = planSheet.getLastRow();
  if (planLastRow < 2) {
    Logger.log('rewrite_planにデータがありません。');
    return;
  }

  const planData = planSheet.getRange(2, 1, planLastRow - 1, 8).getValues();
  // rewrite_plan: [URL, 投稿ID, メインKW, 現在順位, リライト概要, 不足トピック数, 本文改善数, ステータス]

  let processedThisRun = 0;

  for (let i = 0; i < planData.length; i++) {
    if (processedThisRun >= MARKUP_CONFIG.MAX_ARTICLES_PER_RUN) break;

    const status = planData[i][7];
    if (status !== '承認待ち') continue;

    const pageUrl = planData[i][0];
    const postId = planData[i][1];
    const keyword = planData[i][2];
    const position = planData[i][3];
    const planRowNum = i + 2;

    Logger.log(`\n========================================`);
    Logger.log(`[${elapsed()}秒] Phase 2.5開始: ${pageUrl}`);
    Logger.log(`  投稿ID: ${postId}, KW: ${keyword}`);
    Logger.log(`========================================`);

    // ステータスを「マークアップ生成中」に
    planSheet.getRange(planRowNum, 8).setValue('マークアップ生成中');

    try {
      // 2. rewrite_*シートから詳細分析を取得
      const rewriteSheet = getLatestRewriteSheet(ss);
      if (!rewriteSheet) {
        Logger.log('rewrite_*シートが見つかりません。');
        planSheet.getRange(planRowNum, 8).setValue('承認待ち');
        continue;
      }

      const analysisRaw = getRewriteAnalysisRaw(rewriteSheet, pageUrl);
      if (!analysisRaw) {
        Logger.log(`rewrite_*シートに該当記事がありません: ${pageUrl}`);
        planSheet.getRange(planRowNum, 8).setValue('データ不足');
        processedThisRun++;
        continue;
      }
      Logger.log(`[A] 分析データ取得完了 (${elapsed()}秒)`);

      // 3. WordPress REST APIで現在のrawコンテンツ取得
      const wpPost = fetchWpPost(postId);
      if (!wpPost || !wpPost.content || !wpPost.content.raw) {
        Logger.log(`WP記事の取得に失敗: postId=${postId}`);
        planSheet.getRange(planRowNum, 8).setValue('WP取得失敗');
        processedThisRun++;
        continue;
      }

      let rawContent = wpPost.content.raw;
      const originalLength = rawContent.length;
      if (rawContent.length > MARKUP_CONFIG.MAX_WP_CONTENT_LENGTH) {
        rawContent = rawContent.substring(0, MARKUP_CONFIG.MAX_WP_CONTENT_LENGTH);
        Logger.log(`  コンテンツ切り詰め: ${originalLength} → ${rawContent.length}文字`);
      }
      Logger.log(`[B] WPコンテンツ取得: ${originalLength}文字 (${elapsed()}秒)`);

      // 4. Claude APIでGutenbergマークアップ生成
      Logger.log(`[C] Claude API開始... (${elapsed()}秒)`);
      const stepC = new Date().getTime();

      const markupResult = callClaudeMarkupGeneration({
        articleUrl: pageUrl,
        postId: postId,
        keyword: keyword,
        position: position,
        rawContent: rawContent,
        analysis: analysisRaw,
      });

      Logger.log(`[C] Claude API完了: ${Math.round((new Date().getTime() - stepC) / 1000)}秒`);

      if (!markupResult || !markupResult.changes || markupResult.changes.length === 0) {
        Logger.log('マークアップ生成結果が空です。');
        planSheet.getRange(planRowNum, 8).setValue('生成失敗');
        processedThisRun++;
        continue;
      }

      // 5. シートに出力
      const dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
      writeMarkupSheet(ss, pageUrl, postId, markupResult, dateStr);

      planSheet.getRange(planRowNum, 8).setValue('マークアップ生成済み');
      Logger.log(`★ 成功: ${markupResult.changes.length}件の変更 (トータル${elapsed()}秒)`);
      processedThisRun++;

    } catch (e) {
      Logger.log(`✗ エラー: ${e.message}\n${e.stack}`);
      planSheet.getRange(planRowNum, 8).setValue('承認待ち');
      processedThisRun++;
    }
  }

  if (processedThisRun === 0) {
    Logger.log('処理対象の「承認待ち」記事がありません。');
  }
  Logger.log(`\n=== Phase 2.5完了 (${elapsed()}秒) ===`);
}

// ============================================================
// rewrite_*シートから生テキストの分析データを取得
// ============================================================
function getRewriteAnalysisRaw(sheet, url) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  // [URL, 投稿ID, メインKW, 現在順位, クリック数, 表示回数, 競合数,
  //  総合評価, 目標順位, 不足トピック, 不要トピック, 本文改善, 構造変更, 優先改善]
  for (const row of data) {
    if (row[0] === url) {
      return {
        overall_assessment: row[7] || '',
        target_position: row[8] || '',
        missing_topics: row[9] || '',
        unnecessary_topics: row[10] || '',
        content_improvements: row[11] || '',
        structure_changes: row[12] || '',
        priority_summary: row[13] || '',
      };
    }
  }
  return null;
}

// ============================================================
// Claude APIでGutenbergマークアップ生成
// ============================================================
function callClaudeMarkupGeneration(params) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  const systemPrompt = buildMarkupSystemPrompt();
  const userPrompt = buildMarkupUserPrompt(params);

  Logger.log(`  プロンプト: system=${systemPrompt.length}字, user=${userPrompt.length}字`);

  try {
    const response = UrlFetchApp.fetch(CLAUDE_CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: MARKUP_CONFIG.MARKUP_MODEL,
        max_tokens: MARKUP_CONFIG.MARKUP_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`  Claude APIエラー: ${response.getResponseCode()} - ${response.getContentText().substring(0, 300)}`);
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
// Phase 2.5用システムプロンプト
// ============================================================
function buildMarkupSystemPrompt() {
  return `あなたは金融アフィリエイトメディアのWordPressコンテンツ編集の専門家です。
SEOリライト分析の結果に基づき、完成形のGutenbergブロックマークアップを生成してください。

## 重要なルール
1. 出力するマークアップは、WPのコードエディタにそのまま貼り付けて使える完成形であること
2. 既存の記事で使用されているデザインパターン（class名・インラインスタイル）を正確に踏襲すること
3. 景品表示法・金融商品取引法に抵触する表現は生成しない
4. CTAプラグインブロック（<!-- wp:soico-cta/xxx -->）は生成しない（別システムで管理）
5. 再利用ブロック（<!-- wp:block {"ref":数字} /-->）は変更しない
6. 変更は最小限に。分析で指示された箇所のみ変更する

## 利用可能なデザインパターン

### ボックスデザイン
- 注意・警告: <div class="box-004">内容</div>
- 補足・アドバイス: <div class="box-006">内容</div>
- ポイント・メリット: <div class="box-008">内容</div>

### 比較表（スクロール対応）
<table style="border-collapse: collapse; width: 100%; min-width: 600px;">
  <tr style="background-color: #f0f0f0;"><th>項目</th><th>A</th><th>B</th></tr>
  <tr><td>内容</td><td>内容</td><td>内容</td></tr>
</table>

### Q&Aアコーディオン
<div style="background-color: #f0f8ff; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <details style="margin-bottom: 8px;">
    <summary style="font-weight: bold; cursor: pointer; padding: 8px;">質問テキスト</summary>
    <div style="padding: 8px 8px 0;"><p>回答テキスト</p></div>
  </details>
</div>

### ステップ表示
<div style="background-color: #f0f7ff; border: 1px solid #b6d4fe; border-radius: 8px; padding: 16px; margin: 16px 0;">
  <div style="margin-bottom: 15px; padding: 8px; background-color: #e6f2ff; border-radius: 4px;">
    <div style="color: #0056b3; font-weight: bold;">1.<b>タイトル</b>：説明テキスト</div>
  </div>
</div>

### 記事要約ボックス
<div style="border: 2px solid #007BFF; border-radius: 8px; overflow: hidden; margin: 16px 0;">
  <div style="background-color: #007BFF; color: #fff; padding: 12px 16px; font-weight: bold;">この記事の要約</div>
  <div style="padding: 16px;"><ul><li>要約項目</li></ul></div>
</div>

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

### 強調テキスト
<strong><mark class="has-inline-color has-gold-color" style="background-color:rgba(0, 0, 0, 0)">強調テキスト</mark></strong>

### 出典
<blockquote class="wp-block-quote"><p><a href="URL" rel="noopener" target="_blank">出典名</a></p></blockquote>

### リスト
<!-- wp:list -->
<ul class="wp-block-list"><li>項目1</li><li>項目2</li></ul>
<!-- /wp:list -->

## 出力形式（JSON以外のテキストは出力しない）
{
  "article_url": "記事URL",
  "post_id": "投稿ID",
  "changes": [
    {
      "change_type": "追加 | 書き換え | 削除 | 構造変更",
      "description": "変更内容の説明（1行）",
      "target_heading": "変更対象の見出しテキスト（該当する場合）",
      "insert_position": "挿入位置の説明（追加の場合: 'XX見出しの直後' 等）",
      "gutenberg_markup": "完成形のGutenbergブロックマークアップ（HTML文字列）",
      "seo_rationale": "SEO改善の根拠（1文）",
      "priority": "高 | 中 | 低"
    }
  ],
  "summary": "全変更の要約（2文）"
}`;
}

// ============================================================
// Phase 2.5用ユーザープロンプト
// ============================================================
function buildMarkupUserPrompt(params) {
  const analysisText = [
    `## 総合評価\n${params.analysis.overall_assessment}`,
    `## 目標順位\n${params.analysis.target_position}`,
    `## 不足トピック\n${params.analysis.missing_topics || 'なし'}`,
    `## 不要トピック\n${params.analysis.unnecessary_topics || 'なし'}`,
    `## 本文改善\n${params.analysis.content_improvements || 'なし'}`,
    `## 構造変更\n${params.analysis.structure_changes || 'なし'}`,
    `## 優先改善\n${params.analysis.priority_summary}`,
  ].join('\n\n');

  return `以下の記事に対してSEOリライト分析が完了しています。
分析結果に基づき、各変更箇所の完成形Gutenbergブロックマークアップを生成してください。

【記事情報】
URL: ${params.articleUrl}
投稿ID: ${params.postId}
メインKW: ${params.keyword}
現在順位: ${params.position}

---

【リライト分析結果】
${analysisText}

---

【現在の記事コンテンツ（Gutenbergブロックマークアップ）】
${params.rawContent}`;
}

// ============================================================
// マークアップシート出力
// ============================================================
function writeMarkupSheet(ss, pageUrl, postId, markupResult, dateStr) {
  const sheetName = MARKUP_CONFIG.MARKUP_SHEET_PREFIX + dateStr;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = ['記事URL', '投稿ID', '変更種別', '対象見出し', '挿入位置', '変更説明', 'Gutenbergマークアップ', '優先度', 'SEO根拠', 'ステータス'];
    sheet.getRange(1, 1, 1, 10).setValues([headers]);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 350);
    sheet.setColumnWidth(4, 200);
    sheet.setColumnWidth(5, 200);
    sheet.setColumnWidth(6, 300);
    sheet.setColumnWidth(7, 600);
    sheet.setColumnWidth(9, 300);
    sheet.setColumnWidth(10, 100);

    // ステータス列の条件付き書式
    const statusRange = sheet.getRange(2, 10, 200, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認待ち').setBackground('#FFF3E0').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('承認').setBackground('#C8E6C9').setFontColor('#1B5E20').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('反映済み').setBackground('#BBDEFB').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('スキップ').setBackground('#ECEFF1').setFontColor('#546E7F').setRanges([statusRange]).build(),
    ]);
  }

  const nextRow = sheet.getLastRow() + 1;
  const rows = markupResult.changes.map(c => [
    pageUrl,
    postId,
    c.change_type || '',
    c.target_heading || '',
    c.insert_position || '',
    c.description || '',
    c.gutenberg_markup || '',
    c.priority || '',
    c.seo_rationale || '',
    '承認待ち',
  ]);

  if (rows.length > 0) {
    sheet.getRange(nextRow, 1, rows.length, 10).setValues(rows);
    // マークアップ列を折り返し表示に
    sheet.getRange(nextRow, 7, rows.length, 1).setWrap(true);
  }

  Logger.log(`「${sheetName}」に${rows.length}件出力`);
}

// ============================================================
// Phase 3改: 承認済みマークアップをWordPressに反映
// ============================================================
function applyApprovedMarkup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const START_TIME = new Date().getTime();
  const elapsed = () => Math.round((new Date().getTime() - START_TIME) / 1000);

  // 最新のrewrite_markup_*シートを探す
  const markupSheet = getLatestMarkupSheet(ss);
  if (!markupSheet) {
    Logger.log('rewrite_markup_*シートが見つかりません。先にPhase 2.5を実行してください。');
    return;
  }

  const lastRow = markupSheet.getLastRow();
  if (lastRow < 2) return;

  const data = markupSheet.getRange(2, 1, lastRow - 1, 10).getValues();
  // [URL, 投稿ID, 変更種別, 対象見出し, 挿入位置, 変更説明, マークアップ, 優先度, SEO根拠, ステータス]

  // 承認済みの変更を記事ごとにグループ化
  const approvedByPost = {};
  const rowMap = {};

  for (let i = 0; i < data.length; i++) {
    if (data[i][9] !== '承認') continue;
    const postId = data[i][1];
    if (!approvedByPost[postId]) {
      approvedByPost[postId] = { url: data[i][0], changes: [] };
      rowMap[postId] = [];
    }
    approvedByPost[postId].changes.push({
      change_type: data[i][2],
      target_heading: data[i][3],
      insert_position: data[i][4],
      description: data[i][5],
      gutenberg_markup: data[i][6],
    });
    rowMap[postId].push(i + 2); // シートの行番号
  }

  const postIds = Object.keys(approvedByPost);
  if (postIds.length === 0) {
    Logger.log('承認済みの変更がありません。');
    return;
  }

  Logger.log(`反映対象: ${postIds.length}記事`);
  let applied = 0;

  for (const postId of postIds) {
    const info = approvedByPost[postId];
    Logger.log(`\n--- 反映: ${info.url} (ID: ${postId}, 変更${info.changes.length}件) ---`);

    // WPから現在のコンテンツ取得
    const wpPost = fetchWpPost(postId);
    if (!wpPost || !wpPost.content || !wpPost.content.raw) {
      Logger.log('WP記事の取得に失敗');
      for (const rowNum of rowMap[postId]) {
        markupSheet.getRange(rowNum, 10).setValue('WP取得失敗');
      }
      continue;
    }

    let content = wpPost.content.raw;

    // 各変更を適用
    for (const change of info.changes) {
      if (change.change_type === '追加' && change.target_heading) {
        // 見出しの後に挿入
        const insertPos = findSectionEndInsertPosition(content, change.target_heading);
        if (insertPos >= 0) {
          content = content.substring(0, insertPos) + '\n\n' + change.gutenberg_markup + content.substring(insertPos);
          Logger.log(`  追加: ${change.description}`);
        } else {
          Logger.log(`  挿入位置が見つからない: ${change.target_heading}`);
        }
      } else if (change.change_type === '書き換え' && change.target_heading) {
        // 見出し〜次の同レベル見出しまでを置換
        const replaced = replaceSectionContent(content, change.target_heading, change.gutenberg_markup);
        if (replaced) {
          content = replaced;
          Logger.log(`  書き換え: ${change.description}`);
        } else {
          Logger.log(`  書き換え対象が見つからない: ${change.target_heading}`);
        }
      }
      // 削除・構造変更は手動確認後の適用を想定
    }

    if (content === wpPost.content.raw) {
      Logger.log('変更なし（適用できる変更がなかった）');
      for (const rowNum of rowMap[postId]) {
        markupSheet.getRange(rowNum, 10).setValue('適用失敗');
      }
      continue;
    }

    // WordPress更新
    if (updateWpPost(postId, content)) {
      Logger.log('更新成功');
      for (const rowNum of rowMap[postId]) {
        markupSheet.getRange(rowNum, 10).setValue('反映済み');
      }
      applied++;
    } else {
      Logger.log('更新失敗');
      for (const rowNum of rowMap[postId]) {
        markupSheet.getRange(rowNum, 10).setValue('更新失敗');
      }
    }

    Utilities.sleep(1000);
  }

  Logger.log(`\n=== マークアップ反映完了: ${applied}記事 (${elapsed()}秒) ===`);
}

// ============================================================
// セクション内容の置換（見出し〜次の同レベル見出しまで）
// ============================================================
function replaceSectionContent(content, headingText, newMarkup) {
  // 見出しを含むブロックを探す
  const escapedHeading = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(
    `(<!-- wp:heading[^>]*-->\\s*<h(\\d)[^>]*>\\s*${escapedHeading}\\s*</h\\2>\\s*<!-- /wp:heading -->)`,
    'i'
  );

  const match = content.match(headingPattern);
  if (!match) return null;

  const headingLevel = parseInt(match[2]);
  const sectionStart = content.indexOf(match[0]);
  const afterHeading = sectionStart + match[0].length;

  // 次の同レベル以上の見出しを探す
  const nextHeadingPattern = new RegExp(
    `<!-- wp:heading(\\s+\\{[^}]*\\})?\\s*-->\\s*<h([${headingLevel}-6])`,
    'g'
  );
  nextHeadingPattern.lastIndex = afterHeading;

  let sectionEnd;
  const nextMatch = nextHeadingPattern.exec(content);
  if (nextMatch) {
    // 次の見出しの直前（Gutenbergコメントの開始位置）
    sectionEnd = content.lastIndexOf('<!-- wp:heading', nextMatch.index);
    if (sectionEnd < afterHeading) sectionEnd = nextMatch.index;
  } else {
    sectionEnd = content.length;
  }

  return content.substring(0, sectionStart) + newMarkup + content.substring(sectionEnd);
}

// ============================================================
// 最新のrewrite_markup_*シートを取得
// ============================================================
function getLatestMarkupSheet(ss) {
  const sheets = ss.getSheets().filter(s => s.getName().startsWith(MARKUP_CONFIG.MARKUP_SHEET_PREFIX));
  if (sheets.length === 0) return null;
  sheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  return sheets[0];
}

// ============================================================
// テスト用
// ============================================================
function testPhase25() {
  Logger.log('=== Phase 2.5 テスト実行 ===');
  runRewritePhase25();
}
