// ============================================================
// CTA Gap Fill: CTA空白セクションを検出し挿入候補を自動生成
//
// 既存のCVR診断パイプラインとは独立して動作する。
// Claude API は以下の3点を判定:
//   1. セクション購買意欲（intent: high/medium/low）
//   2. 文脈に最も合う提携案件（partner）
//   3. セクション内容に合ったマイクロコピー（featureText）
//
// セクション冒頭150文字を Claude に渡すことで、
// 見出しだけでは分からない具体的な文脈を理解させる。
//
// コストは既存フル診断の約1/3（~$0.012/記事）。
//
// フロー:
//   1. WP REST API で記事コンテンツを取得
//   2. H2見出し一覧を抽出 + 各セクション冒頭150文字を取得
//   3. 各セクションの既存CTA有無を検出
//   4. Claude で intent + partner + featureText を判定
//   5. intent=high/medium のセクションにのみ挿入候補を生成
//   6. cta_gap_fill_plan シートに出力（featureText列あり、承認前にDaiki編集可能）
//
// 承認後の反映: applyApprovedGapFills() を実行
//   → シートのL列 featureText を読み取って CTAブロックを再構築
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
// ============================================================
function detectExistingCtaInSection(sectionContent) {
  if (/<!-- wp:soico-cta\//.test(sectionContent)) return true;
  if (/\/recommends\/[a-z0-9_-]+/i.test(sectionContent)) return true;
  return false;
}

// ============================================================
// セクションコンテンツからプレーンテキスト要約を抽出
// HTMLタグ・Gutenbergコメント・改行を除去し、先頭maxChars文字を返す
// ============================================================
function extractSectionExcerpt(sectionContent, maxChars) {
  const cleaned = sectionContent
    .replace(/<!-- [\s\S]*?-->/g, '')   // Gutenbergコメント除去
    .replace(/<[^>]+>/g, '')            // HTMLタグ除去
    .replace(/\n+/g, ' ')              // 改行→スペース
    .replace(/\s+/g, ' ')             // 連続スペース圧縮
    .trim();
  return cleaned.substring(0, maxChars);
}

// ============================================================
// Gap Fill 用 Claude API 呼び出し
// 入力: セクション一覧（見出し+冒頭要約）+ 提携案件リスト
// 出力: 各セクションの intent + partner + featureText
// ============================================================
function callGapFillDiagnosis(params, apiKey) {
  const sectionList = params.sections.map(s => {
    const marker = s.hasCta ? '★' : '　';
    const excerptLine = s.hasCta
      ? '   → （CTA設置済み）'
      : `   → ${s.excerpt}`;
    return `${s.index}. ${marker} ${s.heading}\n${excerptLine}`;
  }).join('\n');

  const partnerPriority = fetchPartnerPriority(params.category);
  const partnerListText = partnerPriority.join(', ');

  const systemPrompt = `あなたは金融アフィリエイトメディアのCTA配置最適化の専門家です。
記事の各セクション（見出し＋内容要約）を読み、以下の3つを判定してください。

1. 読者の購買意欲レベル（intent）
2. セクションの文脈に最も合う提携案件（partner）
3. セクション内容に合ったCTAマイクロコピー（featureText）

【intent判定ルール】
- intent: "high" / "medium" / "low"
  - high: 商品比較・メリット解説・具体的な始め方・おすすめ紹介・シミュレーション結果・申込方法など、読者が行動を検討するセクション
  - medium: 制度解説・基本情報・仕組み説明・費用概要など、理解が深まり間接的に行動につながるセクション
  - low: リスク注意喚起・デメリット・税務処理・法的注意・Q&A・まとめなど、購買意欲と無関係または逆方向のセクション
- ★付きセクション（CTA設置済み）は intent: "skip" とする

【partner選定ルール】
- intent が high/medium のセクションにのみ、提携案件リストからセクション内容に最も合う案件slugを1つ選ぶ
- 案件リストは優先順位順。文脈に合う案件が複数ある場合はリスト先頭を優先
- 1記事内で同じ partner が連続しないよう分散させる
- セクションの話題（例: 口座開設の簡便さ、ポイント投資、手数料比較）と案件の強みがマッチするものを選ぶ

【featureText生成ルール】
- intent が high/medium のセクションに、CTAボタン上に表示する訴求テキストを1行（15〜30文字）で生成する
- セクションの内容を読者が読んだ直後を想定し、「このセクションを読んだ人が次に取りたい行動」を後押しするコピーにする
- 良い例:
  - 教育資金の積立方法セクション → 「新制度開始まで親名義で教育資金作りを始めるなら」
  - メリット解説セクション → 「非課税で教育資金を増やせる口座を今すぐ開設」
  - 証券会社比較セクション → 「手数料0円で始められる楽天証券の詳細」
  - 仮想通貨の始め方セクション → 「最短10分で口座開設｜取引手数料無料」
- 悪い例:
  - 「詳細はこちら」（具体性がない）
  - 「業界No.1」（根拠なき最上級表現。景表法リスク）
  - 「今すぐ申し込む」（CTAボタン文言はレギュレーション固定のため変更不可）

【出力形式】JSON配列のみ出力してください。JSON以外のテキストは出力しないでください。
[{"section": 1, "intent": "high", "partner": "rakuten", "featureText": "教育資金の積立をポイントで始めるなら", "reason": "理由1行"}]`;

  const userPrompt = `以下の記事を判定してください。

【記事カテゴリ】${params.category}
【記事URL】${params.url}

【セクション一覧】（★=CTA設置済み、各セクションの冒頭内容を要約付き）
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
        max_tokens: 2048,
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
// ============================================================
function runGapFill(targetPostIds) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('CLAUDE_API_KEY が設定されていません');
    return;
  }

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

    // 各H2セクションのCTA有無 + 冒頭150文字を取得
    const sections = [];
    for (let i = 0; i < h2Headings.length; i++) {
      const sectionStart = h2Headings[i].endPosition;
      const sectionEnd = i + 1 < h2Headings.length
        ? h2Headings[i + 1].startPosition
        : content.length;
      const sectionContent = content.substring(sectionStart, sectionEnd);
      const hasCta = detectExistingCtaInSection(sectionContent);
      const excerpt = extractSectionExcerpt(sectionContent, 150);

      sections.push({
        index: i + 1,
        heading: h2Headings[i].text,
        hasCta: hasCta,
        excerpt: excerpt,
        headingData: h2Headings[i],
      });
    }

    const gapCount = sections.filter(s => !s.hasCta).length;
    Logger.log(`H2: ${h2Headings.length}個, CTA既存: ${h2Headings.length - gapCount}個, Gap: ${gapCount}個`);

    if (gapCount === 0) {
      Logger.log('CTA空白セクションなし — スキップ');
      continue;
    }

    // Claude で intent + partner + featureText 判定
    const diagnosis = callGapFillDiagnosis({
      url: url,
      category: category,
      sections: sections,
    }, apiKey);

    if (!diagnosis || !Array.isArray(diagnosis)) {
      Logger.log('Gap Fill 診断失敗');
      continue;
    }

    // partner 優先順位（ラウンドロビンフォールバック用）
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
        const idxInPriority = partnerPriority.indexOf(partnerSlug);
        if (idxInPriority >= 0) partnerIdx = idxInPriority + 1;
      }

      // プラグインスラッグ変換
      const pluginSlug = mapPartnerToPluginSlug(partnerSlug);
      if (!pluginSlug) {
        Logger.log(`  スラッグ変換失敗: ${partnerSlug}`);
        continue;
      }

      // featureText: Claude生成値を使用
      const featureText = (item.featureText || '').trim();

      // CTAブロック生成（featureText付き）
      const ctaBlock = buildCtaBlockComment(category, {
        proposed: featureText ? `「${featureText}」` : '',
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
        featureText: featureText,
        status: '承認待ち',
      });

      Logger.log(`  ✓ ${section.heading} → ${pluginSlug} (${item.intent}) 「${featureText}」`);
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
// ============================================================
function testGapFill() {
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
//
// 列構造:
//   A: 記事URL, B: 投稿ID, C: カテゴリ, D: 挿入位置, E: 提案内容,
//   F: 案件(TA slug), G: 案件(プラグイン), H: CTAブロック,
//   I: マッチ見出し, J: ステータス, K: 備考,
//   L: featureText（★Daiki編集可能。承認前に書き換えると反映時に使われる）
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
    'featureText（編集可）', // L ★
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
    p.featureText || '',
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
  sheet.setColumnWidth(12, 350);

  // L列（featureText）のスタイル: 編集可能であることを視覚的に示す
  if (rows.length > 0) {
    const ftRange = sheet.getRange(2, 12, rows.length, 1);
    ftRange.setBackground('#FFF9C4'); // 薄い黄色: 編集可能
  }

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
//
// シートの L列 featureText を読み取り、CTAブロックを再構築する。
// Daikiが承認前にL列を書き換えた場合、書き換え後の値が使われる。
// ============================================================
function applyApprovedGapFills() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('cta_gap_fill_plan');

  if (!sheet) {
    Logger.log('cta_gap_fill_planシートが見つかりません。');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データがありません。');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();

  const changesByPost = {};
  for (let i = 0; i < data.length; i++) {
    const postId = data[i][1];       // B列: 投稿ID
    const status = data[i][9];       // J列: ステータス
    const category = data[i][2];     // C列: カテゴリ
    const pluginSlug = data[i][6];   // G列: 案件(プラグイン)
    const matchedHeading = data[i][8]; // I列: マッチ見出し
    const featureText = (data[i][11] || '').trim(); // L列: featureText（編集後）

    if (status !== '承認') continue;
    if (!postId) continue;

    // L列の featureText で CTAブロックを再構築
    const ctaBlock = buildCtaBlockComment(category, {
      proposed: featureText ? `「${featureText}」` : '',
      partnerSlug: '',
    }, pluginSlug);

    if (!changesByPost[postId]) {
      changesByPost[postId] = {
        url: data[i][0],
        category: category,
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

  Logger.log(`=== Gap Fill 反映: ${postIds.length}記事 ===`);

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

  Logger.log('=== Gap Fill 反映完了 ===');
}
