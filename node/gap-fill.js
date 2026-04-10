const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============================================================
// PHP エンドポイントから記事データを一括取得
// ============================================================
const BATCH_SIZE = 50;

async function fetchArticlesFromPHP(postIds) {
  if (postIds && postIds.length > 0) {
    // 指定IDの場合は1リクエスト（少量なのでOK）
    const params = new URLSearchParams({ token: config.site.phpToken, post_ids: postIds.join(',') });
    const res = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
    if (!res.ok) throw new Error(`gap_fill_prepare.php: HTTP ${res.status}`);
    const data = await res.json();
    console.log(`PHP前処理: ${data.total}件取得`);
    return data.posts;
  }

  // 全件取得: バッチ方式（PHPメモリ制限回避）
  const allPosts = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      token: config.site.phpToken,
      limit: String(BATCH_SIZE),
      offset: String(offset),
    });
    const res = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
    if (!res.ok) throw new Error(`gap_fill_prepare.php: HTTP ${res.status} (offset=${offset})`);

    const data = await res.json();
    if (!data.posts || data.posts.length === 0) break;

    allPosts.push(...data.posts);
    console.log(`PHP前処理: ${allPosts.length}件取得済み (batch ${offset / BATCH_SIZE + 1})`);

    if (data.posts.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log(`PHP前処理 完了: 合計${allPosts.length}件`);
  return allPosts;
}

// ============================================================
// Claude で intent + partner + featureText を判定
// ============================================================
async function callGapFillDiagnosis(post) {
  const partnerPriority = config.partnerPriority[post.category] || [];
  const partnerListText = partnerPriority.join(', ');

  const sectionList = post.sections.map(s => {
    const marker = s.hasCta ? '★' : '　';
    const excerptLine = s.hasCta
      ? '   → （CTA設置済み）'
      : `   → ${s.excerpt}`;
    return `${s.index}. ${marker} ${s.heading}\n${excerptLine}`;
  }).join('\n');

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

【featureText生成ルール】
- intent が high/medium のセクションに、CTAボタン上に表示する訴求テキストを1行（15〜30文字）で生成する
- セクションの内容を読者が読んだ直後を想定し、行動を後押しするコピーにする
- 良い例: 「新制度開始まで親名義で教育資金作りを始めるなら」「手数料0円で始められる楽天証券の詳細」
- 悪い例: 「詳細はこちら」「業界No.1」「今すぐ申し込む」

【出力形式】JSON配列のみ出力してください。
[{"section": 1, "intent": "high", "partner": "rakuten", "featureText": "...", "reason": "理由1行"}]`;

  const userPrompt = `以下の記事を判定してください。

【記事カテゴリ】${post.category}
【記事URL】${post.url}

【セクション一覧】（★=CTA設置済み、各セクションの冒頭内容を要約付き）
${sectionList}

【提携済み案件（優先順位順）】${partnerListText}`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error(`  JSON解析失敗: ${text.substring(0, 200)}`);
    return null;
  }

  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// CTA ブロック HTML を生成
// ============================================================
function buildCtaBlock(category, pluginSlug, featureText) {
  const blockConfig = config.categoryBlockConfig[category];
  if (!blockConfig) return '';

  const attributes = { version: '2' };
  attributes[blockConfig.entityKey] = pluginSlug;
  if (featureText) attributes.featureText = featureText;

  return `<!-- wp:soico-cta/${blockConfig.inlineCta} ${JSON.stringify(attributes)} /-->`;
}

// ============================================================
// WordPress REST API で記事を更新（書き込みのみ REST）
// ============================================================
async function updateWpPost(postId, newContent) {
  const url = `${config.wp.restBase}/posts/${postId}`;
  const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: newContent }),
  });

  if (!res.ok) {
    console.error(`WP更新失敗 (ID ${postId}): HTTP ${res.status}`);
    return false;
  }
  return true;
}

// ============================================================
// メイン: Gap Fill 全記事処理
// ============================================================
async function runGapFill(postIds) {
  console.log('=== Gap Fill 開始 ===\n');

  // PHP前処理で全記事のセクション情報を一括取得
  const articles = await fetchArticlesFromPHP(postIds);

  // 対応カテゴリのみ
  const targets = articles.filter(a => config.supportedCategories.includes(a.category));
  console.log(`対象: ${targets.length}記事（${articles.length}件中）\n`);

  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const post = targets[i];

    // CTA空白セクションがあるか
    const gapCount = post.sections.filter(s => !s.hasCta).length;
    if (gapCount === 0) {
      console.log(`[${i + 1}/${targets.length}] ${post.title} → CTA空白なし、スキップ`);
      continue;
    }

    console.log(`[${i + 1}/${targets.length}] ${post.title} (${post.category}, Gap: ${gapCount})`);

    // Claude 判定
    const diagnosis = await callGapFillDiagnosis(post);
    if (!diagnosis) {
      console.log('  → 診断失敗');
      continue;
    }

    const partnerPriority = config.partnerPriority[post.category] || [];
    let partnerIdx = 0;

    for (const item of diagnosis) {
      if (!item || item.intent === 'low' || item.intent === 'skip') continue;

      const section = post.sections.find(s => s.index === item.section);
      if (!section || section.hasCta) continue;

      // partner 決定
      let partnerSlug = item.partner;
      if (!partnerSlug || !partnerPriority.includes(partnerSlug)) {
        partnerSlug = partnerPriority[partnerIdx % partnerPriority.length];
        partnerIdx++;
      } else {
        const idx = partnerPriority.indexOf(partnerSlug);
        if (idx >= 0) partnerIdx = idx + 1;
      }

      const pluginSlug = config.partnerSlugMap[partnerSlug] || partnerSlug.replace(/-/g, '_');
      const featureText = (item.featureText || '').trim();
      const ctaBlock = buildCtaBlock(post.category, pluginSlug, featureText);

      results.push({
        postId: post.id,
        url: post.url,
        title: post.title,
        category: post.category,
        heading: section.heading,
        intent: item.intent,
        partner: pluginSlug,
        featureText: featureText,
        reason: item.reason || '',
        ctaBlock: ctaBlock,
      });

      console.log(`  ✓ [${item.intent}] ${section.heading} → ${pluginSlug} 「${featureText}」`);
    }

    // API レート制限回避
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Gap Fill 完了: ${results.length}件の挿入候補 ===`);
  return results;
}

// ============================================================
// 結果を TSV で出力（承認用）
// ============================================================
function outputTSV(results) {
  const headers = ['postId', 'URL', 'category', 'heading', 'intent', 'partner', 'featureText', 'reason', 'ctaBlock'];
  console.log('\n' + headers.join('\t'));
  for (const r of results) {
    console.log([r.postId, r.url, r.category, r.heading, r.intent, r.partner, r.featureText, r.reason, r.ctaBlock].join('\t'));
  }
}

// ============================================================
// 結果を JSON ファイルに保存
// ============================================================
async function saveResults(results, filename) {
  const fs = require('fs').promises;
  await fs.writeFile(filename, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n結果を ${filename} に保存`);
}

// ============================================================
// CLI エントリーポイント
// ============================================================
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--help') {
    console.log('Usage:');
    console.log('  node gap-fill.js                    # 全記事を処理');
    console.log('  node gap-fill.js 5286 18924 6504    # 指定記事のみ');
    console.log('  node gap-fill.js --dry-run 5286     # 結果表示のみ（WP更新しない）');
    return;
  }

  const dryRun = args.includes('--dry-run');
  const postIds = args.filter(a => a !== '--dry-run' && /^\d+$/.test(a));

  const results = await runGapFill(postIds.length > 0 ? postIds : null);

  if (results.length === 0) {
    console.log('挿入候補なし');
    return;
  }

  // JSON保存
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  await saveResults(results, `gap-fill-results-${timestamp}.json`);

  if (dryRun) {
    console.log('\n[dry-run] WordPress への反映はスキップ');
    outputTSV(results);
  } else {
    console.log('\n承認されたら以下を実行:');
    console.log(`  node gap-fill.js --apply gap-fill-results-${timestamp}.json`);
  }
}

// --apply モード: JSON から承認済みの結果を WordPress に反映
async function applyFromFile() {
  const args = process.argv.slice(2);
  const applyIdx = args.indexOf('--apply');
  if (applyIdx === -1 || !args[applyIdx + 1]) return false;

  const fs = require('fs').promises;
  const filename = args[applyIdx + 1];
  const results = JSON.parse(await fs.readFile(filename, 'utf-8'));

  console.log(`=== ${filename} から ${results.length}件を WordPress に反映 ===\n`);

  // postId ごとにグループ化
  const byPost = {};
  for (const r of results) {
    if (!byPost[r.postId]) byPost[r.postId] = [];
    byPost[r.postId].push(r);
  }

  for (const [postId, changes] of Object.entries(byPost)) {
    console.log(`記事 ID ${postId}: ${changes.length}件のCTA挿入`);

    // 記事コンテンツ取得（REST API）
    const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');
    const getRes = await fetch(`${config.wp.restBase}/posts/${postId}?context=edit`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (!getRes.ok) {
      console.log(`  取得失敗: HTTP ${getRes.status}`);
      continue;
    }

    const postData = await getRes.json();
    let content = postData.content.raw;

    // 見出し位置を特定して後ろから挿入
    const insertions = [];
    for (const change of changes) {
      const pos = findSectionEndPosition(content, change.heading);
      if (pos >= 0) {
        insertions.push({ position: pos, ctaBlock: change.ctaBlock });
      } else {
        console.log(`  位置不明: ${change.heading}`);
      }
    }

    insertions.sort((a, b) => b.position - a.position);
    for (const ins of insertions) {
      content = content.substring(0, ins.position) + '\n\n' + ins.ctaBlock + '\n\n' + content.substring(ins.position);
    }

    if (insertions.length > 0) {
      const success = await updateWpPost(postId, content);
      console.log(`  ${success ? '✓ 更新成功' : '✗ 更新失敗'}: ${insertions.length}箇所`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n=== 反映完了 ===');
  return true;
}

// ============================================================
// 見出しテキストからセクション末尾の挿入位置を特定
// ============================================================
function findSectionEndPosition(content, headingText) {
  // H2見出しを全抽出
  const blockRegex = /<!-- wp:heading(?:\s+\{[^}]*\})?\s*-->\s*<h([23])[^>]*>([\s\S]*?)<\/h\1>\s*<!-- \/wp:heading -->/gi;
  const headings = [];
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    headings.push({
      text: match[2].replace(/<[^>]+>/g, '').trim(),
      level: parseInt(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (headings.length === 0) {
    const htmlRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((match = htmlRegex.exec(content)) !== null) {
      headings.push({
        text: match[2].replace(/<[^>]+>/g, '').trim(),
        level: parseInt(match[1]),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // 対象見出しを特定
  let targetIdx = headings.findIndex(h => h.text === headingText);
  if (targetIdx === -1) {
    targetIdx = headings.findIndex(h => h.text.includes(headingText) || headingText.includes(h.text));
  }
  if (targetIdx === -1) return -1;

  const target = headings[targetIdx];

  // セクション終了境界
  let sectionEnd = content.length;
  for (let i = targetIdx + 1; i < headings.length; i++) {
    if (headings[i].level <= target.level) {
      sectionEnd = headings[i].start;
      break;
    }
  }

  // セクション内の最後のコンテンツブロックの終了位置
  const sectionContent = content.substring(target.end, sectionEnd);
  const contentBlockRegex = /<!-- \/wp:(paragraph|list|table|html|quote|image|heading)\s*-->/gi;
  let lastEnd = -1;
  let blockMatch;
  while ((blockMatch = contentBlockRegex.exec(sectionContent)) !== null) {
    lastEnd = blockMatch.index + blockMatch[0].length;
  }

  return lastEnd > 0 ? target.end + lastEnd : sectionEnd;
}

// ============================================================
// 実行
// ============================================================
(async () => {
  const applied = await applyFromFile();
  if (!applied) await main();
})();
