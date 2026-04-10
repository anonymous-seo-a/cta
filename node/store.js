/**
 * データ永続化（JSONファイルベース）
 * VPS移行後はSQLiteやPostgreSQLに差し替え可能
 */
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'gap-fill-results.json');
const HISTORY_FILE = path.join(DATA_DIR, 'apply-history.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

async function readJSON(filepath, fallback = []) {
  try {
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJSON(filepath, data) {
  await ensureDataDir();
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// Gap Fill 結果の管理
// ============================================================
async function getResults() {
  return readJSON(RESULTS_FILE, []);
}

async function saveResults(results) {
  await writeJSON(RESULTS_FILE, results);
}

async function addResults(newResults) {
  const existing = await getResults();
  // 重複排除（同じ postId + heading の組み合わせ）
  const key = r => `${r.postId}:${r.heading}`;
  const existingKeys = new Set(existing.map(key));
  const deduped = newResults.filter(r => !existingKeys.has(key(r)));

  const merged = [...existing, ...deduped.map(r => ({
    ...r,
    id: `${r.postId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'pending', // pending / approved / rejected / applied
    createdAt: new Date().toISOString(),
    appliedAt: null,
  }))];

  await saveResults(merged);
  return merged;
}

async function updateResult(id, updates) {
  const results = await getResults();
  const idx = results.findIndex(r => r.id === id);
  if (idx === -1) return null;
  results[idx] = { ...results[idx], ...updates };
  await saveResults(results);
  return results[idx];
}

async function bulkUpdateStatus(ids, status) {
  const results = await getResults();
  const idSet = new Set(ids);
  for (const r of results) {
    if (idSet.has(r.id)) r.status = status;
  }
  await saveResults(results);
  return results;
}

// ============================================================
// 反映履歴の管理
// ============================================================
async function getHistory() {
  return readJSON(HISTORY_FILE, []);
}

async function addHistoryEntry(entry) {
  const history = await getHistory();
  history.unshift({
    ...entry,
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  });
  await writeJSON(HISTORY_FILE, history);
  return history;
}

// ============================================================
// バックアップ（ロールバック用）
// ============================================================
async function saveBackup(postId, content) {
  await ensureDataDir();
  const filename = `${postId}-${Date.now()}.html`;
  await fs.writeFile(path.join(BACKUPS_DIR, filename), content, 'utf-8');
  return filename;
}

async function loadBackup(filename) {
  return fs.readFile(path.join(BACKUPS_DIR, filename), 'utf-8');
}

module.exports = {
  getResults, saveResults, addResults, updateResult, bulkUpdateStatus,
  getHistory, addHistoryEntry,
  saveBackup, loadBackup,
};
