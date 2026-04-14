/**
 * アフィリエイトリンク張替ツール
 *
 * 提携審査前のパターンブロック・TAリンク・CTAブロックを
 * 提携審査通過後のものに一括差し替えする。
 *
 * 現在はアコム用。将来的にアイフル等にも拡張予定。
 */

// ============================================================
// 差替ルール定義
// partner ごとに差替パターンを定義。将来の拡張はここに追加するだけ。
// ============================================================
const REPLACE_RULES = {
  acom: {
    label: 'アコム',
    // パターンブロック差替 (ref ID)
    patternBlocks: [
      { before: 6278, after: 16758, description: '画像CTA' },
      { before: 6281, after: 16759, description: 'ボタンCTA' },
    ],
    // ThirstyAffiliates リンク差替
    taLink: {
      before: '/recommends/acom',
      after: '/recommends/acom_checked',
    },
    // soico-cta ブロックに customThirstyLinkId を追加
    ctaBlock: {
      companySlug: 'acom',
      customThirstyLinkId: 16757, // acom_checked の TA link ID
    },
  },
  // 将来: aiful をここに追加
};

// ============================================================
// コンテンツ内の差替箇所をスキャン（プレビュー用）
// ============================================================
function scanReplacements(content, partner) {
  const rule = REPLACE_RULES[partner];
  if (!rule) return { error: `Unknown partner: ${partner}` };

  const findings = [];

  // 1. パターンブロック
  for (const pb of rule.patternBlocks) {
    const pattern = `<!-- wp:block {"ref":${pb.before}} /-->`;
    let idx = -1;
    while ((idx = content.indexOf(pattern, idx + 1)) !== -1) {
      findings.push({
        type: 'pattern-block',
        description: `${pb.description}: ref:${pb.before} → ref:${pb.after}`,
        before: pattern,
        after: `<!-- wp:block {"ref":${pb.after}} /-->`,
        position: idx,
      });
    }
  }

  // 2. ThirstyAffiliates リンク
  // /recommends/acom/ や /recommends/acom" にマッチ（acom_checked は除外）
  const taBeforeEscaped = rule.taLink.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taRegex = new RegExp(`${taBeforeEscaped}(?!/|_checked)([/"\\s])`, 'g');
  let taMatch;
  while ((taMatch = taRegex.exec(content)) !== null) {
    findings.push({
      type: 'ta-link',
      description: `TAリンク: ${rule.taLink.before} → ${rule.taLink.after}`,
      before: taMatch[0],
      after: `${rule.taLink.after}${taMatch[1]}`,
      position: taMatch.index,
    });
  }

  // 3. soico-cta ブロックの company:acom に customThirstyLinkId 追加
  const ctaRegex = /<!-- wp:soico-cta\/([a-z-]+)\s+(\{[^}]*\})\s*\/-->/g;
  let ctaMatch;
  while ((ctaMatch = ctaRegex.exec(content)) !== null) {
    try {
      const attrs = JSON.parse(ctaMatch[2]);
      const entityKey = attrs.company !== undefined ? 'company' : attrs.exchange !== undefined ? 'exchange' : null;
      if (!entityKey) continue;

      const slug = attrs[entityKey];
      if (slug !== rule.ctaBlock.companySlug) continue;

      // 既に customThirstyLinkId が設定済みならスキップ
      if (attrs.customThirstyLinkId === rule.ctaBlock.customThirstyLinkId) continue;

      const newAttrs = { ...attrs, customThirstyLinkId: rule.ctaBlock.customThirstyLinkId };
      const newBlock = `<!-- wp:soico-cta/${ctaMatch[1]} ${JSON.stringify(newAttrs)} /-->`;

      findings.push({
        type: 'cta-block',
        description: `CTAブロック: ${slug} に customThirstyLinkId:${rule.ctaBlock.customThirstyLinkId} を追加`,
        before: ctaMatch[0],
        after: newBlock,
        position: ctaMatch.index,
      });
    } catch {}
  }

  return {
    partner,
    label: rule.label,
    totalFindings: findings.length,
    findings,
  };
}

// ============================================================
// コンテンツに差替を適用
// ============================================================
function applyReplacements(content, findings) {
  // 後ろから適用（位置ずれ防止）
  const sorted = [...findings].sort((a, b) => b.position - a.position);
  let result = content;

  for (const f of sorted) {
    const idx = result.indexOf(f.before, Math.max(0, f.position - 10));
    if (idx === -1) continue;
    result = result.substring(0, idx) + f.after + result.substring(idx + f.before.length);
  }

  return result;
}

module.exports = { REPLACE_RULES, scanReplacements, applyReplacements };
