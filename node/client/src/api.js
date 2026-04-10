const BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  getStats: () => request('/api/stats'),
  getResults: () => request('/api/results'),
  getHistory: () => request('/api/history'),
  getPartners: (category) => request(`/api/partners/${category}`),

  runGapFill: (postIds) =>
    request('/api/gap-fill/run', { method: 'POST', body: JSON.stringify({ postIds }) }),

  getGapFillStatus: () => request('/api/gap-fill/status'),

  stopGapFill: () => request('/api/gap-fill/stop', { method: 'POST' }),

  updateResult: (id, updates) =>
    request(`/api/results/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),

  bulkStatus: (ids, status) =>
    request('/api/results/bulk-status', { method: 'POST', body: JSON.stringify({ ids, status }) }),

  regenerateFeatureText: (id) =>
    request(`/api/results/${id}/regenerate`, { method: 'POST' }),

  apply: (ids) =>
    request('/api/apply', { method: 'POST', body: JSON.stringify({ ids }) }),

  rollback: (historyId) =>
    request(`/api/rollback/${historyId}`, { method: 'POST' }),

  getAllPartners: () => request('/api/partners'),

  updatePartner: (category, slug, data) =>
    request(`/api/partners/${category}/${slug}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePartner: (category, slug) =>
    request(`/api/partners/${category}/${slug}`, { method: 'DELETE' }),
};
