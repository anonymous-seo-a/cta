import { useState, useEffect, useCallback } from 'react';
import { api } from './api';

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return <div className={`toast ${type}`}>{message}</div>;
}

function Dashboard({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats">
      <div className="stat-card"><div className="number">{stats.articles}</div><div className="label">対象記事</div></div>
      <div className="stat-card"><div className="number">{stats.total}</div><div className="label">挿入候補</div></div>
      <div className="stat-card"><div className="number">{stats.pending}</div><div className="label">承認待ち</div></div>
      <div className="stat-card"><div className="number">{stats.approved}</div><div className="label">承認済み</div></div>
      <div className="stat-card"><div className="number">{stats.applied}</div><div className="label">反映済み</div></div>
      <div className="stat-card"><div className="number">{stats.rejected}</div><div className="label">却下</div></div>
    </div>
  );
}

function SectionMap({ sections, resultHeadings }) {
  if (!sections) return null;
  return (
    <div className="section-map">
      {sections.map(s => {
        const cls = s.hasCta ? 'has-cta' : resultHeadings.has(s.heading) ? 'gap-fill' : 'no-action';
        const icon = s.hasCta ? '★' : resultHeadings.has(s.heading) ? '🟡' : '·';
        return <span key={s.index} className={`section-dot ${cls}`}>{icon} {s.heading}</span>;
      })}
    </div>
  );
}

function CtaPreview({ partner, featureText }) {
  return (
    <div className="cta-preview">
      <div className="cta-preview-label">CTAプレビュー</div>
      <div className="cta-preview-box">
        <div className="cta-preview-company">{partner}</div>
        {featureText && <div className="cta-preview-feature">{featureText}</div>}
        <div className="cta-preview-button">詳細はこちら</div>
      </div>
    </div>
  );
}

function ResultRow({ item, onUpdate, onRegenerate, onApplySingle, partners }) {
  const [editing, setEditing] = useState(false);
  const [featureText, setFeatureText] = useState(item.featureText);
  const [partner, setPartner] = useState(item.partner);
  const [candidates, setCandidates] = useState([]);
  const [regenerating, setRegenerating] = useState(false);

  const handleSave = async () => {
    await onUpdate(item.id, { featureText, partner });
    setEditing(false);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    const result = await onRegenerate(item.id);
    if (result?.candidates) setCandidates(result.candidates);
    setRegenerating(false);
  };

  return (
    <div className="result-row">
      <div className="result-row-header">
        <div>
          <span className="result-heading">{item.heading}</span>
          <span className={`result-intent ${item.intent}`} style={{ marginLeft: 8 }}>{item.intent}</span>
          <span className={`status-badge ${item.status}`} style={{ marginLeft: 8 }}>{item.status}</span>
        </div>
      </div>
      <div className="result-reason">{item.reason}</div>

      <div className="result-body">
        <div className="result-field">
          <label>案件</label>
          {editing ? (
            <select value={partner} onChange={e => setPartner(e.target.value)}>
              {(partners || []).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <span>{item.partner}</span>
          )}
        </div>
        <div className="result-field">
          <label>コピー</label>
          {editing ? (
            <input value={featureText} onChange={e => setFeatureText(e.target.value)} />
          ) : (
            <span>{item.featureText || '(なし)'}</span>
          )}
        </div>

        {candidates.length > 0 && (
          <div className="result-field" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label>候補</label>
            {candidates.map((c, i) => (
              <button key={i} className="btn-small btn-secondary" style={{ marginTop: 4 }}
                onClick={() => { setFeatureText(c); setCandidates([]); }}>
                {c}
              </button>
            ))}
          </div>
        )}

        <CtaPreview partner={editing ? partner : item.partner} featureText={editing ? featureText : item.featureText} />
      </div>

      <div className="result-actions">
        {item.status === 'pending' && (
          <>
            <button className="btn-approve btn-small" onClick={() => onUpdate(item.id, { status: 'approved' })}>承認</button>
            <button className="btn-reject btn-small" onClick={() => onUpdate(item.id, { status: 'rejected' })}>却下</button>
          </>
        )}
        {item.status === 'approved' && (
          <button className="btn-apply btn-small" onClick={() => onApplySingle(item.id)}>即時反映</button>
        )}
        {editing ? (
          <>
            <button className="btn-approve btn-small" onClick={handleSave}>保存</button>
            <button className="btn-secondary btn-small" onClick={() => setEditing(false)}>キャンセル</button>
          </>
        ) : (
          <button className="btn-secondary btn-small" onClick={() => setEditing(true)}>編集</button>
        )}
        <button className="btn-regenerate" onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? '生成中...' : '再生成'}
        </button>
      </div>
    </div>
  );
}

function HistoryView({ history, onRollback }) {
  if (!history || history.length === 0) return <div className="loading">履歴なし</div>;
  return (
    <div>
      {history.map(h => (
        <div key={h.id} className="history-item">
          <div className="history-info">
            <div className="history-title">
              {h.action === 'rollback' ? '🔄 ロールバック' : `📝 ${h.insertedCount}箇所挿入`}
              {' — '}{h.title}
            </div>
            <div className="history-meta">
              ID: {h.postId} | {new Date(h.timestamp).toLocaleString('ja-JP')}
              {h.url && <> | <a href={h.url} target="_blank" rel="noopener">記事を開く</a></>}
            </div>
          </div>
          {h.action !== 'rollback' && (
            <button className="btn-secondary btn-small" onClick={() => onRollback(h.id)}>ロールバック</button>
          )}
        </div>
      ))}
    </div>
  );
}

function PartnerEditor({ partner, category, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState({
    slug: partner?.slug || '',
    name: partner?.name || '',
    features: partner?.features?.join('\n') || '',
    bestFor: partner?.bestFor?.join('\n') || '',
    caution: partner?.caution || '',
    priority: partner?.priority || 99,
  });
  const isNew = !partner;

  const handleSubmit = () => {
    onSave(category, form.slug, {
      slug: form.slug,
      name: form.name,
      features: form.features.split('\n').map(s => s.trim()).filter(Boolean),
      bestFor: form.bestFor.split('\n').map(s => s.trim()).filter(Boolean),
      caution: form.caution,
      priority: Number(form.priority),
    });
  };

  return (
    <div className="partner-editor">
      <div className="result-field">
        <label>slug</label>
        <input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} disabled={!isNew} placeholder="例: rakuten" />
      </div>
      <div className="result-field">
        <label>名称</label>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例: 楽天証券" />
      </div>
      <div className="result-field" style={{ alignItems: 'flex-start' }}>
        <label>特徴・強み</label>
        <textarea rows={4} value={form.features} onChange={e => setForm({ ...form, features: e.target.value })} placeholder="1行に1つずつ入力" />
      </div>
      <div className="result-field" style={{ alignItems: 'flex-start' }}>
        <label>向いている文脈</label>
        <textarea rows={4} value={form.bestFor} onChange={e => setForm({ ...form, bestFor: e.target.value })} placeholder="1行に1つずつ入力" />
      </div>
      <div className="result-field">
        <label>注意点</label>
        <input value={form.caution} onChange={e => setForm({ ...form, caution: e.target.value })} />
      </div>
      <div className="result-field">
        <label>優先順位</label>
        <input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ width: 80 }} />
      </div>
      <div className="result-actions">
        <button className="btn-approve btn-small" onClick={handleSubmit}>{isNew ? '追加' : '保存'}</button>
        <button className="btn-secondary btn-small" onClick={onCancel}>キャンセル</button>
        {!isNew && onDelete && (
          <button className="btn-reject btn-small" onClick={() => { if (confirm(`${form.name} を削除しますか？`)) onDelete(category, form.slug); }}>削除</button>
        )}
      </div>
    </div>
  );
}

function PartnerManager({ showToast }) {
  const [partnerDB, setPartnerDB] = useState(null);
  const [activeCategory, setActiveCategory] = useState('securities');
  const [editingSlug, setEditingSlug] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const categories = [
    { key: 'securities', label: '証券' },
    { key: 'cardloan', label: 'カードローン' },
    { key: 'cryptocurrency', label: '暗号資産' },
  ];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = await api.getAllPartners();
      setPartnerDB(db);
    } catch (e) {
      showToast(e.message, 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = async (category, slug, data) => {
    try {
      await api.updatePartner(category, slug, data);
      await refresh();
      setEditingSlug(null);
      setAdding(false);
      showToast('保存しました');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDelete = async (category, slug) => {
    try {
      await api.deletePartner(category, slug);
      await refresh();
      setEditingSlug(null);
      showToast('削除しました');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  if (loading || !partnerDB) return <div className="loading"><div className="spinner" /> 読み込み中...</div>;

  const partners = (partnerDB[activeCategory] || []).sort((a, b) => (a.priority || 99) - (b.priority || 99));

  return (
    <div>
      <div className="filters" style={{ marginBottom: 16 }}>
        {categories.map(c => (
          <button key={c.key}
            className={activeCategory === c.key ? 'btn-apply btn-small' : 'btn-secondary btn-small'}
            onClick={() => { setActiveCategory(c.key); setEditingSlug(null); setAdding(false); }}>
            {c.label} ({(partnerDB[c.key] || []).length})
          </button>
        ))}
        <button className="btn-approve btn-small" onClick={() => { setAdding(true); setEditingSlug(null); }} style={{ marginLeft: 'auto' }}>
          + 新規追加
        </button>
      </div>

      {adding && (
        <div className="article-group" style={{ marginBottom: 16 }}>
          <div className="article-header"><div className="article-title">新規追加</div></div>
          <div style={{ padding: 16 }}>
            <PartnerEditor category={activeCategory} onSave={handleSave} onCancel={() => setAdding(false)} />
          </div>
        </div>
      )}

      {partners.map(p => (
        <div key={p.slug} className="article-group" style={{ marginBottom: 12 }}>
          <div className="article-header" onClick={() => setEditingSlug(editingSlug === p.slug ? null : p.slug)} style={{ cursor: 'pointer' }}>
            <div>
              <span className="article-title">{p.name}</span>
              <span className="article-meta" style={{ marginLeft: 8 }}>({p.slug})</span>
              <span className="status-badge approved" style={{ marginLeft: 8 }}>優先度 {p.priority}</span>
            </div>
            <span style={{ fontSize: 12, color: '#888' }}>{editingSlug === p.slug ? '▲ 閉じる' : '▼ 編集'}</span>
          </div>

          {editingSlug !== p.slug && (
            <div style={{ padding: '10px 16px', fontSize: 13 }}>
              <div style={{ color: '#555', marginBottom: 4 }}><strong>特徴:</strong> {p.features?.join(' / ')}</div>
              <div style={{ color: '#555', marginBottom: 4 }}><strong>推奨文脈:</strong> {p.bestFor?.join(' / ')}</div>
              {p.caution && <div style={{ color: '#c62828', fontSize: 12 }}>⚠ {p.caution}</div>}
            </div>
          )}

          {editingSlug === p.slug && (
            <div style={{ padding: 16 }}>
              <PartnerEditor
                partner={p}
                category={activeCategory}
                onSave={handleSave}
                onCancel={() => setEditingSlug(null)}
                onDelete={handleDelete}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditView({ showToast }) {
  const [duplicates, setDuplicates] = useState([]);
  const [totalRemovable, setTotalRemovable] = useState(0);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  const handleScan = async () => {
    setLoading(true);
    try {
      const result = await api.auditDuplicates();
      setDuplicates(result.duplicates || []);
      setTotalRemovable(result.totalRemovable || 0);
      setScanned(true);
      showToast(`${result.totalRemovable}件の重複CTAを検出（${result.total}セクション）`);
    } catch (e) {
      showToast(e.message, 'error');
    }
    setLoading(false);
  };

  const handleRemove = async (dup, block) => {
    if (!confirm(`「${dup.heading}」セクション内の重複 ${block.blockType}:${block.partner} を削除しますか？`)) return;

    // このブロックのセクション内での出現番号を計算（同一 blockType+partner の中で何番目か）
    const sameTypeBlocks = dup.ctaBlocks.filter(b => b.blockType === block.blockType && b.partner === block.partner);
    const blockIdx = sameTypeBlocks.indexOf(block);
    // 2番目以降を消すので、occurrence = blockIdx + 1
    const occurrence = blockIdx + 1;

    try {
      await api.removeCta(dup.postId, {
        partner: block.partner,
        featureText: block.featureText,
        sectionHeading: dup.heading,
        occurrence: occurrence,
      });
      // UIから除去して再計算
      setDuplicates(prev => prev.map(d => {
        if (d.postId === dup.postId && d.heading === dup.heading) {
          const newBlocks = d.ctaBlocks.filter(b => b !== block);
          const dupCount = newBlocks.filter(b => b.action === 'remove').length;
          return { ...d, ctaBlocks: newBlocks, dupCount };
        }
        return d;
      }).filter(d => d.dupCount > 0));
      setTotalRemovable(prev => prev - 1);
      showToast('CTAを削除しました');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // 記事単位でグルーピング
  const grouped = {};
  for (const d of duplicates) {
    if (!grouped[d.postId]) grouped[d.postId] = { title: d.title, url: d.url, sections: [] };
    grouped[d.postId].sections.push(d);
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-apply" onClick={handleScan} disabled={loading}>
          {loading ? 'スキャン中...' : '重複CTAスキャン'}
        </button>
        {scanned && <span style={{ fontSize: 14, color: '#888' }}>
          {Object.keys(grouped).length}記事 / {duplicates.length}セクション / {totalRemovable}件の重複
        </span>}
      </div>

      {loading && <div className="loading"><div className="spinner" /> 全記事をスキャン中...</div>}

      {scanned && duplicates.length === 0 && !loading && (
        <div className="loading">重複CTAはありません</div>
      )}

      {Object.entries(grouped).map(([postId, group]) => (
        <div key={postId} className="article-group" style={{ marginBottom: 16 }}>
          <div className="article-header">
            <div>
              <div className="article-title">{group.title}</div>
              <div className="article-meta">ID: {postId} | {group.sections.length}セクションに重複あり</div>
            </div>
            <a href={group.url} target="_blank" rel="noopener" className="article-link">記事を開く →</a>
          </div>

          {group.sections.map((section, si) => (
            <div key={si}>
              <div style={{ padding: '8px 16px', background: '#fff3e0', borderBottom: '1px solid #eee', fontSize: 13, fontWeight: 600 }}>
                H2: {section.heading}（CTA {section.ctaCount}個、うち重複 {section.dupCount}個）
              </div>

              {section.ctaBlocks.map((block, bi) => {
                const actionColor = block.action === 'remove' ? '#ffebee' : block.action === 'keep' ? '#e8f5e9' : '#fafafa';
                const actionLabel = block.action === 'remove' ? '重複（削除候補）' : block.action === 'keep' ? '残す' : '正常';
                const badgeClass = block.action === 'remove' ? 'rejected' : block.action === 'keep' ? 'approved' : 'applied';

                return (
                  <div key={bi} style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', background: actionColor }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <span style={{ fontSize: 12, color: '#888', marginRight: 8 }}>{block.blockType}</span>
                        <span style={{ fontWeight: 500 }}>{block.partner}</span>
                        {block.featureText && <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>「{block.featureText}」</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className={`status-badge ${badgeClass}`}>{actionLabel}</span>
                        {block.action === 'remove' && (
                          <button className="btn-reject btn-small" onClick={() => handleRemove(section, block)}>削除</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RunModal({ onClose, onRun, onStop }) {
  const [postIds, setPostIds] = useState('');
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState(null);

  const handleRun = async () => {
    const ids = postIds.trim() ? postIds.split(/[,\s]+/).filter(Boolean) : undefined;
    await onRun(ids);
    setStarted(true);
  };

  // 進捗ポーリング
  useEffect(() => {
    if (!started) return;
    const interval = setInterval(async () => {
      try {
        const s = await api.getGapFillStatus();
        setStatus(s);
        if (!s.running && s.progress?.phase !== 'fetching') {
          clearInterval(interval);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [started]);

  const p = status?.progress;
  const phaseLabel = {
    fetching: '記事データ取得中...',
    processing: '処理中...',
    done: '完了',
    stopped: '停止済み',
    error: 'エラー',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Gap Fill 実行</h2>
        {!started ? (
          <>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
              記事IDを指定（カンマ区切り）。空欄で全記事対象。
            </p>
            <input placeholder="例: 5286, 18924, 6504" value={postIds} onChange={e => setPostIds(e.target.value)} />
            <div className="actions">
              <button className="btn-secondary" onClick={onClose}>閉じる</button>
              <button className="btn-apply" onClick={handleRun}>実行</button>
            </div>
          </>
        ) : (
          <>
            {p && (
              <div style={{ fontSize: 14 }}>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>{phaseLabel[p.phase] || p.phase}</div>

                {p.phase === 'fetching' && (
                  <div>取得済み: {p.fetched}件</div>
                )}

                {(p.phase === 'processing' || p.phase === 'done' || p.phase === 'stopped') && (
                  <>
                    <div style={{ background: '#e0e0e0', borderRadius: 4, height: 8, marginBottom: 8 }}>
                      <div style={{ background: '#1565c0', borderRadius: 4, height: 8, width: `${p.total > 0 ? (p.processed / p.total * 100) : 0}%`, transition: 'width 0.5s' }} />
                    </div>
                    <div>{p.processed} / {p.total} 記事処理済み</div>
                    <div>挿入候補: {p.added}件</div>
                    {p.errors > 0 && <div style={{ color: '#c62828' }}>エラー: {p.errors}件</div>}
                    {p.currentArticle && p.phase === 'processing' && (
                      <div style={{ color: '#888', marginTop: 4, fontSize: 12 }}>現在: {p.currentArticle}</div>
                    )}
                  </>
                )}

                {p.phase === 'error' && (
                  <div style={{ color: '#c62828' }}>{p.error}</div>
                )}
              </div>
            )}
            <div className="actions" style={{ marginTop: 16 }}>
              {status?.running && <button className="btn-reject" onClick={onStop}>停止</button>}
              <button className="btn-secondary" onClick={onClose}>
                {status?.running ? 'バックグラウンドで継続' : '閉じる'}
              </button>
            </div>
            {status?.running && (
              <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                モーダルを閉じても処理は継続します。承認タブで結果をリアルタイム確認できます。
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('review');
  const [stats, setStats] = useState(null);
  const [results, setResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterIntent, setFilterIntent] = useState('all');
  const [sortBy, setSortBy] = useState('article');

  const showToast = (message, type = 'success') => setToast({ message, type });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, h] = await Promise.all([api.getStats(), api.getResults(), api.getHistory()]);
      setStats(s);
      setResults(r);
      setHistory(h);
    } catch (e) {
      showToast(e.message, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ジョブ実行中は5秒おきに自動リフレッシュ
  useEffect(() => {
    let interval;
    const poll = async () => {
      try {
        const s = await api.getGapFillStatus();
        if (s.running) {
          await refresh();
        } else if (interval) {
          clearInterval(interval);
          interval = null;
          await refresh();
        }
      } catch {}
    };
    interval = setInterval(poll, 5000);
    return () => { if (interval) clearInterval(interval); };
  }, [refresh]);

  const handleUpdate = async (id, updates) => {
    try {
      await api.updateResult(id, updates);
      await refresh();
      if (updates.status) showToast(`${updates.status === 'approved' ? '承認' : updates.status === 'rejected' ? '却下' : '更新'}しました`);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleRegenerate = async (id) => {
    try { return await api.regenerateFeatureText(id); }
    catch (e) { showToast(e.message, 'error'); return null; }
  };

  const handleApplySingle = async (id) => {
    try {
      const res = await api.apply([id]);
      await refresh();
      showToast(`${res.applied}箇所を反映しました`);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleBulkApprove = async () => {
    const ids = filtered.filter(r => r.status === 'pending').map(r => r.id);
    if (ids.length === 0) return;
    try {
      await api.bulkStatus(ids, 'approved');
      await refresh();
      showToast(`${ids.length}件を一括承認`);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleBulkApply = async () => {
    const ids = results.filter(r => r.status === 'approved').map(r => r.id);
    if (ids.length === 0) return showToast('承認済みの項目がありません', 'error');
    try {
      const res = await api.apply(ids);
      await refresh();
      showToast(`${res.applied}箇所を反映しました`);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleRollback = async (historyId) => {
    if (!confirm('この反映を取り消しますか？')) return;
    try {
      await api.rollback(historyId);
      await refresh();
      showToast('ロールバックしました');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleRun = async (postIds) => {
    try {
      const res = await api.runGapFill(postIds);
      await refresh();
      return res;
    } catch (e) { showToast(e.message, 'error'); return null; }
  };

  // フィルタリング
  const filtered = results.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterCategory !== 'all' && r.category !== filterCategory) return false;
    if (filterIntent !== 'all' && r.intent !== filterIntent) return false;
    return true;
  });

  // 記事単位でグルーピング
  const grouped = {};
  for (const r of filtered) {
    if (!grouped[r.postId]) grouped[r.postId] = { title: r.title, url: r.url, category: r.category, sections: r.sections, items: [] };
    grouped[r.postId].items.push(r);
  }

  const pendingInView = filtered.filter(r => r.status === 'pending').length;
  const approvedTotal = results.filter(r => r.status === 'approved').length;

  return (
    <>
      <div className="header">
        <h1>CTA Gap Fill Manager</h1>
        <div className="header-nav">
          <button className={page === 'review' ? 'active' : ''} onClick={() => setPage('review')}>承認</button>
          <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>履歴</button>
          <button className={page === 'audit' ? 'active' : ''} onClick={() => setPage('audit')}>監査</button>
          <button className={page === 'partners' ? 'active' : ''} onClick={() => setPage('partners')}>商材</button>
          <button onClick={() => setShowRunModal(true)}>Gap Fill 実行</button>
        </div>
      </div>

      <div className="container">
        <Dashboard stats={stats} />

        {page === 'review' && (
          <>
            <div className="filters">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">全ステータス</option>
                <option value="pending">承認待ち</option>
                <option value="approved">承認済み</option>
                <option value="rejected">却下</option>
                <option value="applied">反映済み</option>
              </select>
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="all">全カテゴリ</option>
                <option value="securities">証券</option>
                <option value="cardloan">カードローン</option>
                <option value="cryptocurrency">暗号資産</option>
              </select>
              <select value={filterIntent} onChange={e => setFilterIntent(e.target.value)}>
                <option value="all">全intent</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
              </select>
            </div>

            {(pendingInView > 0 || approvedTotal > 0) && (
              <div className="bulk-bar">
                <span>{pendingInView}件が承認待ち / {approvedTotal}件が反映待ち</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pendingInView > 0 && <button onClick={handleBulkApprove}>表示中を一括承認</button>}
                  {approvedTotal > 0 && <button onClick={handleBulkApply}>承認済みを一括反映</button>}
                </div>
              </div>
            )}

            {loading ? (
              <div className="loading"><div className="spinner" /> 読み込み中...</div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="loading">データなし。「Gap Fill 実行」から開始してください。</div>
            ) : (
              Object.entries(grouped).map(([postId, group]) => {
                const resultHeadings = new Set(group.items.map(i => i.heading));
                return (
                  <div key={postId} className="article-group">
                    <div className="article-header">
                      <div>
                        <div className="article-title">{group.title}</div>
                        <div className="article-meta">{group.category} | ID: {postId} | {group.items.length}件</div>
                      </div>
                      <a href={group.url} target="_blank" rel="noopener" className="article-link">記事を開く →</a>
                    </div>
                    <SectionMap sections={group.sections} resultHeadings={resultHeadings} />
                    {group.items.map(item => (
                      <ResultRow
                        key={item.id}
                        item={item}
                        onUpdate={handleUpdate}
                        onRegenerate={handleRegenerate}
                        onApplySingle={handleApplySingle}
                        partners={config.partnerPriority?.[item.category]}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </>
        )}

        {page === 'history' && <HistoryView history={history} onRollback={handleRollback} />}

        {page === 'audit' && <AuditView showToast={showToast} />}

        {page === 'partners' && <PartnerManager showToast={showToast} />}
      </div>

      {showRunModal && <RunModal onClose={() => setShowRunModal(false)} onRun={handleRun} onStop={async () => { try { await api.stopGapFill(); showToast('停止リクエスト送信'); } catch (e) { showToast(e.message, 'error'); } }} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

// config を API から取得するのではなく、フロント用にインライン定義
const config = {
  partnerPriority: {
    securities: ['rakuten', 'sbi', 'monex', 'matsui', 'moomoo', 'okasan', 'mufjesmart'],
    cardloan: ['promise', 'aiful', 'acom', 'lakealsa', 'smbcmobit'],
    cryptocurrency: ['bitflyer', 'coincheck', 'gmo_coin', 'sbi_vc'],
  },
};
