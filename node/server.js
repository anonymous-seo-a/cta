const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const store = require('./store');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// React ビルド済みファイルを配信（本番用）
app.use(express.static(path.join(__dirname, 'client/dist')));

// ============================================================
// Gap Fill コアロジック（gap-fill.js から関数を再利用）
// ============================================================
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const BATCH_SIZE = 50;

async function fetchArticlesFromPHP(postIds) {
  if (postIds && postIds.length > 0) {
    const params = new URLSearchParams({ token: config.site.phpToken, post_ids: postIds.join(',') });
    const res = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
    if (!res.ok) throw new Error(`PHP: HTTP ${res.status}`);
    return (await res.json()).posts;
  }

  const allPosts = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ token: config.site.phpToken, limit: String(BATCH_SIZE), offset: String(offset) });
    const res = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
    if (!res.ok) throw new Error(`PHP: HTTP ${res.status} (offset=${offset})`);
    const data = await res.json();
    if (!data.posts || data.posts.length === 0) break;
    allPosts.push(...data.posts);
    if (data.posts.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return allPosts;
}

async function loadPartnerDB() {
  const fs = require('fs').promises;
  const data = await fs.readFile(path.join(__dirname, 'data/partners.json'), 'utf-8');
  return JSON.parse(data);
}

function buildPartnerListForPrompt(partners) {
  return partners.map(p =>
    `- ${p.slug}（${p.name}）: ${p.features.join('、')}\n  向いている文脈: ${p.bestFor.join(' / ')}`
  ).join('\n');
}

async function callGapFillDiagnosis(post) {
  const partnerDB = await loadPartnerDB();
  const partners = partnerDB[post.category] || [];
  const partnerListText = buildPartnerListForPrompt(partners);

  const sectionList = post.sections.map(s => {
    const marker = s.hasCta ? '★' : '　';
    const excerptLine = s.hasCta ? '   → （CTA設置済み）' : `   → ${s.excerpt}`;
    return `${s.index}. ${marker} ${s.heading}\n${excerptLine}`;
  }).join('\n');

  const systemPrompt = `あなたは金融アフィリエイトメディアのCTA配置最適化の専門家です。
記事の各セクション（見出し＋内容要約）を読み、以下の3つを判定してください。

1. 読者の購買意欲レベル（intent）
2. セクションの文脈に最も合う提携案件（partner）
3. セクション内容に合ったCTAマイクロコピー（featureText）

【intent判定ルール】
- intent: "high" / "medium" / "low"
  - high: 商品比較・メリット解説・具体的な始め方・おすすめ紹介・シミュレーション結果・申込方法
  - medium: 制度解説・基本情報・仕組み説明・費用概要
  - low: リスク注意喚起・デメリット・税務処理・法的注意・Q&A・まとめ
- ★付きセクション（CTA設置済み）は intent: "skip"

【partner選定ルール】
- high/medium のセクションにのみ、案件リストから**セクション内容に最も合う案件**を選ぶ
- 各案件の「特徴」と「向いている文脈」を参照し、セクションの話題との関連度で判断する
- 例: NISAの積立方法の説明 → 楽天証券（ポイント投資・NISA口座数No.1）
- 例: 手数料比較セクション → SBI証券（最安手数料）
- 例: 初心者向けの始め方 → 楽天証券 or Coincheck（UI/初心者向き）
- 1記事内で同じ partner が連続しないよう分散させる
- low のセクションは partner: null

【featureText生成ルール】
- 15〜30文字のCTAマイクロコピー。セクション内容と選定した案件の強みを組み合わせる
- 良い例: 「楽天ポイントで積立投資を始めるなら」「手数料0円のSBI証券で口座開設」
- 悪い例: 「詳細はこちら」「業界No.1」「今すぐ申し込む」

【カードローンカテゴリの法令遵守ルール（貸金業法・景表法）】
※ カテゴリが cardloan の場合、以下を厳守すること。違反した場合は法的リスクが生じる。
- 金利を記載する場合は「実質年率○%〜○%」と上限・下限の両方を必ず併記すること。「年率17.8%」のような上限のみ・下限のみの表示は不可
- 「最安」「最低金利」「業界No.1」「審査が甘い」「誰でも借りられる」等の優位性・断定的表現は不可
- 「即日融資」は事実であれば使用可だが、「必ず」「確実に」等の断定は不可。「最短○分」は可
- 融資条件の優位性を訴求しない。「他社より低金利」「どこよりも早い」等は不可
- featureTextには金利数値を含めないことを推奨（併記義務を満たしにくいため）
- 安全な表現例: 「まずは借入診断から」「Web完結で手続き簡単」「公式サイトで詳細を確認」「お借入れシミュレーションはこちら」
- 避けるべき表現例: 「金利17.8%で借りる」「審査最短3分で融資」「無利息で30日間お得」

【出力】JSON配列のみ
[{"section": 1, "intent": "high", "partner": "rakuten", "featureText": "...", "reason": "..."}]`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: `以下の記事を判定してください。\n\n【記事カテゴリ】${post.category}\n【記事URL】${post.url}\n\n【セクション一覧】（★=CTA設置済み）\n${sectionList}\n\n【提携済み案件（優先順位順・特徴付き）】\n${partnerListText}` }],
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : null;
}

function buildCtaBlock(category, pluginSlug, featureText) {
  const bc = config.categoryBlockConfig[category];
  if (!bc) return '';
  const attrs = { version: '2' };
  attrs[bc.entityKey] = pluginSlug;
  if (featureText) attrs.featureText = featureText;
  return `<!-- wp:soico-cta/${bc.inlineCta} ${JSON.stringify(attrs)} /-->`;
}

function findSectionEndPosition(content, headingText) {
  const blockRegex = /<!-- wp:heading(?:\s+\{[^}]*\})?\s*-->\s*<h([23])[^>]*>([\s\S]*?)<\/h\1>\s*<!-- \/wp:heading -->/gi;
  const headings = [];
  let m;
  while ((m = blockRegex.exec(content)) !== null) {
    headings.push({ text: m[2].replace(/<[^>]+>/g, '').trim(), level: parseInt(m[1]), start: m.index, end: m.index + m[0].length });
  }
  if (headings.length === 0) {
    const htmlRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((m = htmlRegex.exec(content)) !== null) {
      headings.push({ text: m[2].replace(/<[^>]+>/g, '').trim(), level: parseInt(m[1]), start: m.index, end: m.index + m[0].length });
    }
  }
  let idx = headings.findIndex(h => h.text === headingText);
  if (idx === -1) idx = headings.findIndex(h => h.text.includes(headingText) || headingText.includes(h.text));
  if (idx === -1) return -1;

  const target = headings[idx];
  let sectionEnd = content.length;
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= target.level) { sectionEnd = headings[i].start; break; }
  }
  const sec = content.substring(target.end, sectionEnd);
  const cbr = /<!-- \/wp:(paragraph|list|table|html|quote|image|heading)\s*-->/gi;
  let lastEnd = -1, bm;
  while ((bm = cbr.exec(sec)) !== null) lastEnd = bm.index + bm[0].length;
  return lastEnd > 0 ? target.end + lastEnd : sectionEnd;
}

// ============================================================
// API Routes
// ============================================================

// 統計ダッシュボード
app.get('/api/stats', async (req, res) => {
  const results = await store.getResults();
  const history = await store.getHistory();
  res.json({
    total: results.length,
    pending: results.filter(r => r.status === 'pending').length,
    approved: results.filter(r => r.status === 'approved').length,
    rejected: results.filter(r => r.status === 'rejected').length,
    applied: results.filter(r => r.status === 'applied').length,
    articles: [...new Set(results.map(r => r.postId))].length,
    recentHistory: history.slice(0, 10),
  });
});

// Gap Fill 結果一覧
app.get('/api/results', async (req, res) => {
  const results = await store.getResults();
  res.json(results);
});

// Gap Fill ジョブ状態
let gapFillJob = { running: false, progress: null };

// Gap Fill 進捗取得
app.get('/api/gap-fill/status', (req, res) => {
  res.json(gapFillJob);
});

// Gap Fill 停止
app.post('/api/gap-fill/stop', (req, res) => {
  if (gapFillJob.running) {
    gapFillJob.stopRequested = true;
    res.json({ message: '停止リクエスト送信' });
  } else {
    res.json({ message: '実行中のジョブなし' });
  }
});

// Gap Fill 実行（バックグラウンド・1記事ずつ即保存）
app.post('/api/gap-fill/run', async (req, res) => {
  if (gapFillJob.running) {
    return res.status(409).json({ error: '既に実行中です' });
  }

  const { postIds } = req.body;
  gapFillJob = { running: true, stopRequested: false, progress: { phase: 'fetching', fetched: 0, total: 0, processed: 0, added: 0, errors: 0, currentArticle: '' } };

  // 即座にレスポンス返却（バックグラウンド実行）
  res.json({ started: true, message: 'バックグラウンドで実行開始' });

  // バックグラウンドで処理
  try {
    // PHP からバッチ取得（進捗更新しながら）
    let articles = [];
    if (postIds && postIds.length > 0) {
      const params = new URLSearchParams({ token: config.site.phpToken, post_ids: postIds.join(',') });
      const r = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
      if (r.ok) articles = (await r.json()).posts || [];
      gapFillJob.progress.fetched = articles.length;
    } else {
      let offset = 0;
      while (!gapFillJob.stopRequested) {
        const params = new URLSearchParams({ token: config.site.phpToken, limit: String(BATCH_SIZE), offset: String(offset) });
        const r = await fetch(`${config.site.url}/gap_fill_prepare.php?${params}`);
        if (!r.ok) break;
        const data = await r.json();
        if (!data.posts || data.posts.length === 0) break;
        articles.push(...data.posts);
        gapFillJob.progress.fetched = articles.length;
        gapFillJob.progress.phase = 'fetching';
        if (data.posts.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
    }

    const targets = articles.filter(a => config.supportedCategories.includes(a.category));
    gapFillJob.progress.total = targets.length;
    gapFillJob.progress.phase = 'processing';

    for (let i = 0; i < targets.length; i++) {
      if (gapFillJob.stopRequested) {
        gapFillJob.progress.phase = 'stopped';
        break;
      }

      const post = targets[i];
      gapFillJob.progress.processed = i;
      gapFillJob.progress.currentArticle = post.title;

      const gapCount = post.sections.filter(s => !s.hasCta).length;
      if (gapCount === 0) continue;

      try {
        const diagnosis = await callGapFillDiagnosis(post);
        if (!diagnosis) { gapFillJob.progress.errors++; continue; }

        const partnerDB = await loadPartnerDB();
        const partners = partnerDB[post.category] || [];
        const prioritySlugs = partners.sort((a, b) => (a.priority || 99) - (b.priority || 99)).map(p => p.slug);
        let pidx = 0;

        const articlePlans = [];
        for (const item of diagnosis) {
          if (!item || item.intent === 'low' || item.intent === 'skip') continue;
          const section = post.sections.find(s => s.index === item.section);
          if (!section || section.hasCta) continue;

          let slug = item.partner;
          if (!slug || !prioritySlugs.includes(slug)) { slug = prioritySlugs[pidx % prioritySlugs.length]; pidx++; }
          else { const idx = prioritySlugs.indexOf(slug); if (idx >= 0) pidx = idx + 1; }

          const pluginSlug = config.partnerSlugMap[slug] || slug.replace(/-/g, '_');
          const featureText = (item.featureText || '').trim();

          articlePlans.push({
            postId: post.id,
            url: post.url,
            title: post.title,
            category: post.category,
            heading: section.heading,
            intent: item.intent,
            partner: pluginSlug,
            featureText,
            reason: item.reason || '',
            ctaBlock: buildCtaBlock(post.category, pluginSlug, featureText),
            sections: post.sections,
          });
        }

        // 1記事分を即保存（フロントで即時表示される）
        if (articlePlans.length > 0) {
          await store.addResults(articlePlans);
          gapFillJob.progress.added += articlePlans.length;
        }
      } catch (e) {
        gapFillJob.progress.errors++;
        console.error(`Gap Fill error [${post.id}]: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    gapFillJob.progress.processed = targets.length;
    if (gapFillJob.progress.phase !== 'stopped') gapFillJob.progress.phase = 'done';
  } catch (e) {
    gapFillJob.progress = { ...gapFillJob.progress, phase: 'error', error: e.message };
    console.error('Gap Fill fatal:', e.message);
  } finally {
    gapFillJob.running = false;
  }
});

// 単一アイテム更新（承認/却下/featureText編集/partner変更）
app.patch('/api/results/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // featureText や partner が変更された場合、ctaBlock を再生成
  if (updates.featureText !== undefined || updates.partner !== undefined) {
    const results = await store.getResults();
    const item = results.find(r => r.id === id);
    if (item) {
      const partner = updates.partner || item.partner;
      const featureText = updates.featureText !== undefined ? updates.featureText : item.featureText;
      updates.ctaBlock = buildCtaBlock(item.category, partner, featureText);
    }
  }

  const updated = await store.updateResult(id, updates);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// 一括ステータス変更
app.post('/api/results/bulk-status', async (req, res) => {
  const { ids, status } = req.body;
  const results = await store.bulkUpdateStatus(ids, status);
  res.json({ updated: ids.length });
});

// featureText 再生成
app.post('/api/results/:id/regenerate', async (req, res) => {
  const { id } = req.params;
  const results = await store.getResults();
  const item = results.find(r => r.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: `以下のセクションに対するCTAマイクロコピーを3つ提案してください。15〜30文字で、読者の行動を後押しする内容。\n\n記事: ${item.title}\nセクション: ${item.heading}\nカテゴリ: ${item.category}\n案件: ${item.partner}\n\nJSON配列で出力: ["候補1", "候補2", "候補3"]` }],
    });
    const text = response.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    const candidates = match ? JSON.parse(match[0]) : [];
    res.json({ candidates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 承認済みアイテムを WordPress に反映
app.post('/api/apply', async (req, res) => {
  const { ids } = req.body; // 指定なしなら全approved
  const results = await store.getResults();
  const targets = ids
    ? results.filter(r => ids.includes(r.id) && (r.status === 'approved' || r.status === 'pending'))
    : results.filter(r => r.status === 'approved');

  if (targets.length === 0) return res.json({ applied: 0 });

  const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');
  const byPost = {};
  for (const t of targets) {
    if (!byPost[t.postId]) byPost[t.postId] = [];
    byPost[t.postId].push(t);
  }

  let appliedCount = 0;
  const errors = [];

  for (const [postId, changes] of Object.entries(byPost)) {
    try {
      // 記事取得
      const getRes = await fetch(`${config.wp.restBase}/posts/${postId}?context=edit`, {
        headers: { 'Authorization': `Basic ${auth}` },
      });
      if (!getRes.ok) { errors.push({ postId, error: `GET ${getRes.status}` }); continue; }

      const postData = await getRes.json();
      const originalContent = postData.content.raw;

      // バックアップ保存（ロールバック用）
      const backupFile = await store.saveBackup(postId, originalContent);

      // 挿入位置を特定して後ろから挿入
      let content = originalContent;
      const insertions = [];
      for (const c of changes) {
        const pos = findSectionEndPosition(content, c.heading);
        if (pos >= 0) insertions.push({ position: pos, ctaBlock: c.ctaBlock, id: c.id });
      }
      insertions.sort((a, b) => b.position - a.position);
      for (const ins of insertions) {
        content = content.substring(0, ins.position) + '\n\n' + ins.ctaBlock + '\n\n' + content.substring(ins.position);
      }

      // WordPress 更新
      const putRes = await fetch(`${config.wp.restBase}/posts/${postId}`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (putRes.ok) {
        for (const c of changes) {
          await store.updateResult(c.id, { status: 'applied', appliedAt: new Date().toISOString() });
        }
        await store.addHistoryEntry({
          postId,
          title: changes[0].title,
          url: changes[0].url,
          insertedCount: insertions.length,
          backupFile,
          items: changes.map(c => ({ id: c.id, heading: c.heading, partner: c.partner })),
        });
        appliedCount += insertions.length;
      } else {
        errors.push({ postId, error: `POST ${putRes.status}` });
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      errors.push({ postId, error: e.message });
    }
  }

  res.json({ applied: appliedCount, errors });
});

// ロールバック
app.post('/api/rollback/:historyId', async (req, res) => {
  const history = await store.getHistory();
  const entry = history.find(h => h.id === req.params.historyId);
  if (!entry) return res.status(404).json({ error: 'History not found' });

  try {
    const originalContent = await store.loadBackup(entry.backupFile);
    const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');

    const putRes = await fetch(`${config.wp.restBase}/posts/${entry.postId}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: originalContent }),
    });

    if (putRes.ok) {
      // 関連する results のステータスを pending に戻す
      for (const item of entry.items) {
        await store.updateResult(item.id, { status: 'pending', appliedAt: null });
      }
      await store.addHistoryEntry({
        postId: entry.postId,
        title: entry.title,
        url: entry.url,
        action: 'rollback',
        originalHistoryId: entry.id,
      });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: `WordPress更新失敗: ${putRes.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 反映履歴
app.get('/api/history', async (req, res) => {
  const history = await store.getHistory();
  res.json(history);
});

// ============================================================
// CTA監査: 重複CTA検出
// ============================================================
app.post('/api/audit/duplicates', async (req, res) => {
  const { postIds } = req.body;
  try {
    const articles = await fetchArticlesFromPHP(postIds);
    const duplicates = [];

    for (const post of articles) {
      for (const section of post.sections) {
        // PHP側でサブセクション（H3単位）の重複検出済み
        if (!section.subDuplicates || section.subDuplicates.length === 0) continue;

        for (const sub of section.subDuplicates) {
          duplicates.push({
            postId: post.id,
            url: post.url,
            title: post.title,
            category: post.category,
            h2Heading: section.heading,
            heading: sub.heading,
            level: sub.level,
            ctaCount: sub.ctaCount,
            dupCount: sub.dupCount,
            ctaBlocks: sub.ctaBlocks,
          });
        }
      }
    }

    const totalRemovable = duplicates.reduce((s, d) => s + d.dupCount, 0);
    res.json({ total: duplicates.length, totalRemovable, duplicates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CTA除外: サブセクション（H2/H3）内の重複CTAを削除
//
// ロジック:
//   1. 記事の content.raw を取得
//   2. H2 + H3 の全見出しを抽出
//   3. sectionHeading にマッチする見出しを見つける
//   4. その見出し→次の同レベル以上の見出し の範囲でCTAを検索
//   5. partner でフィルタし、occurrence 番目を削除
app.post('/api/audit/remove-cta', async (req, res) => {
  const { postId, partner, featureText, sectionHeading, occurrence } = req.body;
  if (!postId || !sectionHeading) return res.status(400).json({ error: 'postId and sectionHeading required' });

  const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');
  const targetOccurrence = occurrence || 2;

  try {
    const getRes = await fetch(`${config.wp.restBase}/posts/${postId}?context=edit`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    if (!getRes.ok) return res.status(500).json({ error: `GET ${getRes.status}` });

    const postData = await getRes.json();
    const originalContent = postData.content.raw;

    // バックアップ
    await store.saveBackup(postId, originalContent);

    // H2 + H3 見出しを全抽出（Gutenberg + 生HTML 混在対応）
    // 両形式を同時に検索し、位置順でソート
    const headings = [];
    let hm;

    // Gutenbergブロック形式
    const gutenbergRegex = /<!-- wp:heading(?:\s+\{[^}]*\})?\s*-->\s*<h([23])[^>]*>([\s\S]*?)<\/h\1>\s*<!-- \/wp:heading -->/gi;
    const gutenbergPositions = new Set();
    while ((hm = gutenbergRegex.exec(originalContent)) !== null) {
      headings.push({
        text: hm[2].replace(/<[^>]+>/g, '').trim(),
        level: parseInt(hm[1]),
        start: hm.index,
        end: hm.index + hm[0].length,
      });
      // このブロック内の <h2>/<h3> 位置を記録（重複検出防止）
      const innerH = /<h[23]/gi;
      let ih;
      while ((ih = innerH.exec(hm[0])) !== null) {
        gutenbergPositions.add(hm.index + ih.index);
      }
    }

    // 生HTML形式（Gutenbergブロックに含まれないもののみ）
    const rawRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((hm = rawRegex.exec(originalContent)) !== null) {
      if (gutenbergPositions.has(hm.index)) continue; // Gutenberg内のh2/h3はスキップ
      headings.push({
        text: hm[2].replace(/<[^>]+>/g, '').trim(),
        level: parseInt(hm[1]),
        start: hm.index,
        end: hm.index + hm[0].length,
      });
    }

    // 位置順でソート
    headings.sort((a, b) => a.start - b.start);

    // 対象セクションを特定
    const targetIdx = headings.findIndex(h =>
      h.text === sectionHeading || h.text.includes(sectionHeading) || sectionHeading.includes(h.text)
    );
    if (targetIdx === -1) {
      return res.status(404).json({ error: `見出し「${sectionHeading}」が見つかりません` });
    }

    const targetLevel = headings[targetIdx].level;
    const sectionStart = headings[targetIdx].end;
    let sectionEnd = originalContent.length;
    for (let i = targetIdx + 1; i < headings.length; i++) {
      if (headings[i].level <= targetLevel) {
        sectionEnd = headings[i].start;
        break;
      }
    }
    const sectionContent = originalContent.substring(sectionStart, sectionEnd);

    // セクション内の soico-cta ブロックを全検索
    const ctaRegex = /<!-- wp:soico-cta\/[a-z-]+\s+\{[^}]*\}\s*\/-->/g;
    const matches = [];
    let cm;
    while ((cm = ctaRegex.exec(sectionContent)) !== null) {
      // partner でフィルタ（指定されている場合）
      if (partner) {
        const hasPartner = cm[0].includes(`"${partner}"`) || cm[0].includes(`"company":"${partner}"`) || cm[0].includes(`"exchange":"${partner}"`);
        if (!hasPartner) continue;
      }
      matches.push({
        localIndex: cm.index,
        globalIndex: sectionStart + cm.index,
        length: cm[0].length,
        text: cm[0],
      });
    }

    if (matches.length < 2) {
      return res.status(400).json({ error: `セクション内にCTAが${matches.length}個しかありません（重複なし）` });
    }

    if (targetOccurrence > matches.length) {
      return res.status(404).json({ error: `セクション内に${matches.length}個のCTA（${targetOccurrence}番目は存在しない）` });
    }

    // セクション内 N 番目を削除
    const target = matches[targetOccurrence - 1];
    let removeStart = target.globalIndex;
    let removeEnd = target.globalIndex + target.length;
    while (removeStart > 0 && originalContent[removeStart - 1] === '\n') removeStart--;
    while (removeEnd < originalContent.length && originalContent[removeEnd] === '\n') removeEnd++;

    const newContent = originalContent.substring(0, removeStart) + originalContent.substring(removeEnd);

    const putRes = await fetch(`${config.wp.restBase}/posts/${postId}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });

    if (putRes.ok) {
      await store.addHistoryEntry({
        postId,
        title: postData.title.raw,
        url: postData.link,
        action: 'remove-cta',
        sectionHeading,
        removedBlock: target.text.substring(0, 100),
        partner: partner || '(all)',
        occurrence: targetOccurrence,
        totalInSection: matches.length,
      });
      res.json({ success: true, removed: target.text.substring(0, 100), totalInSection: matches.length });
    } else {
      res.status(500).json({ error: `POST ${putRes.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CTA除外: 検出した重複を全て一括削除
app.post('/api/audit/remove-all-duplicates', async (req, res) => {
  const { duplicates } = req.body; // フロントから渡される重複一覧
  if (!duplicates || duplicates.length === 0) return res.json({ removed: 0 });

  const auth = Buffer.from(`${config.wp.username}:${config.wp.appPassword}`).toString('base64');
  let totalRemoved = 0;
  const errors = [];

  // 記事単位でグルーピング（1記事につき1回だけWP取得・更新する）
  const byPost = {};
  for (const dup of duplicates) {
    for (const block of (dup.ctaBlocks || [])) {
      if (block.action !== 'remove') continue;
      if (!byPost[dup.postId]) byPost[dup.postId] = { title: dup.title, url: dup.url, sections: [] };
      byPost[dup.postId].sections.push({ heading: dup.heading, level: dup.level, block });
    }
  }

  for (const [postId, info] of Object.entries(byPost)) {
    try {
      const getRes = await fetch(`${config.wp.restBase}/posts/${postId}?context=edit`, {
        headers: { 'Authorization': `Basic ${auth}` },
      });
      if (!getRes.ok) { errors.push({ postId, error: `GET ${getRes.status}` }); continue; }

      const postData = await getRes.json();
      let content = postData.content.raw;

      // バックアップ
      await store.saveBackup(postId, content);

      // H2+H3 見出しを全抽出（Gutenberg + 生HTML混在対応）
      const headings = extractAllHeadingsFromContent(content);

      let removedInPost = 0;

      // セクションごとに処理（後ろのセクションから処理してインデックスずれを防ぐ）
      const sortedSections = [...info.sections].sort((a, b) => {
        const idxA = headings.findIndex(h => h.text === a.heading || h.text.includes(a.heading) || a.heading.includes(h.text));
        const idxB = headings.findIndex(h => h.text === b.heading || h.text.includes(b.heading) || b.heading.includes(h.text));
        return idxB - idxA; // 後ろのセクションを先に処理
      });

      for (const sec of sortedSections) {
        const targetIdx = headings.findIndex(h =>
          h.text === sec.heading || h.text.includes(sec.heading) || sec.heading.includes(h.text)
        );
        if (targetIdx === -1) continue;

        const targetLevel = headings[targetIdx].level;
        const sectionStart = headings[targetIdx].end;
        let sectionEnd = content.length;
        for (let i = targetIdx + 1; i < headings.length; i++) {
          if (headings[i].level <= targetLevel) { sectionEnd = headings[i].start; break; }
        }
        const sectionContent = content.substring(sectionStart, sectionEnd);

        // セクション内で同じ blockType+partner の2番目を見つけて削除
        const ctaRegex = /<!-- wp:soico-cta\/[a-z-]+\s+\{[^}]*\}\s*\/-->/g;
        const matches = [];
        let cm;
        while ((cm = ctaRegex.exec(sectionContent)) !== null) {
          const hasPartner = cm[0].includes(`"${sec.block.partner}"`);
          const hasBlockType = cm[0].includes(`soico-cta/${sec.block.blockType}`);
          if (hasPartner && hasBlockType) {
            matches.push({ globalIndex: sectionStart + cm.index, length: cm[0].length });
          }
        }

        // 2番目以降を削除（後ろから）
        if (matches.length >= 2) {
          const target = matches[matches.length - 1]; // 最後のマッチ（=重複側）
          let removeStart = target.globalIndex;
          let removeEnd = target.globalIndex + target.length;
          while (removeStart > 0 && content[removeStart - 1] === '\n') removeStart--;
          while (removeEnd < content.length && content[removeEnd] === '\n') removeEnd++;
          content = content.substring(0, removeStart) + content.substring(removeEnd);
          removedInPost++;

          // headings の位置が変わるので再抽出
          headings.length = 0;
          headings.push(...extractAllHeadingsFromContent(content));
        }
      }

      if (removedInPost > 0) {
        const putRes = await fetch(`${config.wp.restBase}/posts/${postId}`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (putRes.ok) {
          totalRemoved += removedInPost;
          await store.addHistoryEntry({
            postId, title: info.title, url: info.url,
            action: 'bulk-remove-duplicates',
            removedCount: removedInPost,
          });
        } else {
          errors.push({ postId, error: `POST ${putRes.status}` });
        }
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      errors.push({ postId, error: e.message });
    }
  }

  res.json({ removed: totalRemoved, errors });
});

// 共通: コンテンツからH2+H3見出しを全抽出（Gutenberg+生HTML混在対応）
function extractAllHeadingsFromContent(content) {
  const headings = [];
  let hm;
  const gutenbergRegex = /<!-- wp:heading(?:\s+\{[^}]*\})?\s*-->\s*<h([23])[^>]*>([\s\S]*?)<\/h\1>\s*<!-- \/wp:heading -->/gi;
  const gutenbergPositions = new Set();
  while ((hm = gutenbergRegex.exec(content)) !== null) {
    headings.push({ text: hm[2].replace(/<[^>]+>/g, '').trim(), level: parseInt(hm[1]), start: hm.index, end: hm.index + hm[0].length });
    const innerH = /<h[23]/gi;
    let ih;
    while ((ih = innerH.exec(hm[0])) !== null) gutenbergPositions.add(hm.index + ih.index);
  }
  const rawRegex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((hm = rawRegex.exec(content)) !== null) {
    if (gutenbergPositions.has(hm.index)) continue;
    headings.push({ text: hm[2].replace(/<[^>]+>/g, '').trim(), level: parseInt(hm[1]), start: hm.index, end: hm.index + hm[0].length });
  }
  headings.sort((a, b) => a.start - b.start);
  return headings;
}

// Partner DB — CRUD
app.get('/api/partners', async (req, res) => {
  const db = await loadPartnerDB();
  res.json(db);
});

app.get('/api/partners/:category', async (req, res) => {
  const db = await loadPartnerDB();
  res.json(db[req.params.category] || []);
});

app.put('/api/partners', async (req, res) => {
  const fs = require('fs').promises;
  await fs.writeFile(path.join(__dirname, 'data/partners.json'), JSON.stringify(req.body, null, 2), 'utf-8');
  res.json({ success: true });
});

app.put('/api/partners/:category/:slug', async (req, res) => {
  const fs = require('fs').promises;
  const db = await loadPartnerDB();
  const cat = req.params.category;
  const slug = req.params.slug;
  if (!db[cat]) db[cat] = [];

  const idx = db[cat].findIndex(p => p.slug === slug);
  if (idx >= 0) {
    db[cat][idx] = { ...db[cat][idx], ...req.body };
  } else {
    db[cat].push({ slug, ...req.body });
  }
  await fs.writeFile(path.join(__dirname, 'data/partners.json'), JSON.stringify(db, null, 2), 'utf-8');
  res.json(db[cat]);
});

app.delete('/api/partners/:category/:slug', async (req, res) => {
  const fs = require('fs').promises;
  const db = await loadPartnerDB();
  const cat = req.params.category;
  if (db[cat]) {
    db[cat] = db[cat].filter(p => p.slug !== req.params.slug);
  }
  await fs.writeFile(path.join(__dirname, 'data/partners.json'), JSON.stringify(db, null, 2), 'utf-8');
  res.json({ success: true });
});

// React SPA フォールバック
app.get('/{0,}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CTA Gap Fill Server: http://localhost:${PORT}`);
});
