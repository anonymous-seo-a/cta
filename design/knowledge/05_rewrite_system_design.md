# ナレッジファイル5：リライトAIシステム設計

最終更新: 2026年4月30日（案B 完了後の統合版）
ステータス: 設計フェーズ完了（Phase 2: Step A〜案E〜案C〜案D〜案B 全確定、Phase 3 詳細設計待ち）

このファイルは、Daikiの「自走リライトシステム」の設計確定事項を記録する。
新規チャットセッションでの設計継続のために必要な情報を構造化保存する。

---

## I. 設計プロセスの全体像

```
Phase 0: リサーチお題設計          完了
Phase 1: Researchモードでの調査     完了
Phase 2: 採用判定（Step A〜B）
  Step A-1: Information Gain        完了
  Step A-2: Query Fan-out           完了
  Step A-3: Evidence Layer          完了
  Step A-4: SEO A/B Testing         完了
  案E: リライト対象選定の新規設計   完了
  案C: LLM実行レイヤー設計         完了
  案D: 統合確認                    完了
  案B: 強推奨手法の確定            完了
  ──────設計フェーズ全完了──────
Phase 3: 詳細設計                  未着手  ← 次の作業
Phase 4: 実装                      未着手
```

---

## II. システム全体像（リライト処理8工程）

```
工程1: リライト対象選定        AI（案E: 4軸独立キュー）
工程2: 競合構造分析（SERP分析） AI（Query Fan-out 二段構造）
工程3: 検索意図分解            AI（工程2と統合実装、JTBD 5次元拡張）
工程4: ギャップ抽出            AI（Information Gain）
工程5: 差分生成                AI + 人間（IG Score 駆動）
工程6: 人間判定（真=美フィルタ） 人間（Daiki）
工程6': LLM実行レイヤー        AI（案C: Opus 4.7 分析 + Sonnet 4.6 生成、差分パッチ）
工程7: 実装（WordPress 反映）  AI
工程8: 効果測定・学習ループ    AI + 人間（A/Bテスト 3層学習）
```

---

## III. 採用した手法（最優先5手法 + 案B 採用8件）

レポート（Phase 1の調査結果）から「日本未採用×海外採用×Google一次情報支持」の最優先5手法を全て採用。
さらに案B で強推奨手法の精査を行い、追加8件採用、3件不採用、1件既確定として確定。

### 最優先5手法（Step A 採用）

#### 1. Information Gain 駆動の差分生成（Step A-1）
- 一次情報根拠: Contextual Estimation of Link Information Gain 特許
  + HCU "Does the content provide insightful analysis or interesting information that is beyond the obvious?"
- KPI: Information Gain スコア（特許準拠）を直接KPI化
- 3レイヤー全採用（エンティティ + 事実主張 + 経験）

#### 2. Query Fan-out 構造シミュレーション（Step A-2）
- 一次情報根拠: developers.google.com/search/docs/appearance/ai-features
  + 特許 US 12158907B1（Thematic Search）, US 2024/0289407A1（Search with Stateful Chat）
- 二段構造（Layer1主題分解 + Layer2 micro-intent展開）
- Layer1のみ競合URL収集、Layer2はセクション設計の参考情報

#### 3. Original research / 独自データ生成（Step A-3 統合）
- 一次情報根拠: HCU "Does the content provide original information, reporting, research, or analysis?"
- Evidence Layer に統合管理

#### 4. First-hand experience markers（Step A-3 統合）
- 一次情報根拠: E-E-A-Tの "Experience"（2022年12月追加）
- Evidence Layer に統合管理

#### 5. SearchPilot方式 SEO A/B Testing（Step A-4）
- 一次情報根拠: John Mueller "test things" 推奨発言
  + SearchPilot 実証ベンチマーク（業界広範な交差確認）
- 完全SearchPilot方式採用（記事数3,000規模で統計的検出力成立）

### 案B 採用8件（強推奨手法の追加採用）

| # | 手法 | 配置 |
|---|---|---|
| 1 | Content decay 検出 + pruning | 案E 軸4 独立キュー |
| 2 | Cannibalization 検出（SERP重複ベース） | 関連度テーブル共有（Phase 3） |
| 3 | Micro-intent × JTBD 分解 | Step A-2 統合（intent_dimension JSON） |
| 4 | Question gap (PAA + サジェスト + 関連検索) | Step A-2 既存スキーマで完結 |
| 5 | HCU 22項目チェックリスト | 独立テーブル master_hcu_checklist |
| 9 | Hub-and-spoke internal linking | 関連度テーブル共有（Phase 2 α） |
| 11 | SC API 多変量 decay 検出 | Phase 2 案C 入力情報（クエリレベル） |
| 12 | 28日窓×90日窓 traffic 差分 | 案E 軸4 統合 |

### 案B 不採用3件（採用却下）

| # | 手法 | 却下理由 |
|---|---|---|
| 6 | Author expertise schema | CMS 側で構造化、監修判断は人間 |
| 7 | 階層的 schema（Article + Product + Review + Person + Organization） | CMS 側で対応、リライトシステム責務外 |
| 10 | Core Web Vitals (INP) 監視 | リライト主流路外 + Clarity engagement_score と機能重複 |

### 案B 既確定1件

| # | 手法 | 確定箇所 |
|---|---|---|
| 8 | FAQ/HowTo schema 不実装 | 既確定（VII章） |

---

## IV. 採用したインフラ

| 項目 | 選定 | 月額目安 | 備考 |
|---|---|---|---|
| SERP API | SerpApi（サブスクStarter） | $25 | 月50記事ペースで250クエリ/月想定 |
| CDN/Edge Layer | Cloudflare Workers | 既存 | A/Bテストvariant injection用 |
| ヒートマップ | Microsoft Clarity | 無料 | A/Bテスト判定 + リライト計画補助 |
| LLM | Anthropic Claude API（OpenAI / Gemini Adapter 対応） | 数千円〜1万円 | 工程6': Opus 4.7 + Sonnet 4.6 |
| 既存スタック | Node.js + Express + better-sqlite3 + React/Vite | - | 維持 |
| GitHub | anonymous-seo-a/s-tools | - | Single Source of Truth |
| Archive | Wayback + archive.today (Adapter化) | 無料 | URL アーカイブ・健全性チェック |

合計運用コスト目安: 月1〜1.5万円程度。

### 既存システム（s-tools/monitor）の再利用方針

| 既存資産 | 再利用方針 |
|---|---|
| monitor-collectors.js（GA4/GSC/WP取得層） | 流用、当面は monitor.db 経由で間接利用 |
| monitor.db（articles, daily_metrics 等） | Read-Only 参照（リライトシステムから） |
| EXCLUDED_CATEGORIES（カテゴリ除外定数） | 共通定数として継承 |
| monitor-analysis.js（buildPrompt） | 案C LLM実行レイヤーの起点として活用、再発明禁止 |
| A系（runScoring）スコア | リライト対象選定では使わない（CTA優先度が本来の目的） |
| B系（alertScore）スコア | リライト対象選定では使わない（順位観測が本来の目的） |
| analysis_comments | 案V: 直近1件を案C プロンプトに参考情報として渡す（NULL 許容） |

### 物理ディレクトリ構成（s-tools 配下、案C + 案D 確定）

```
s-tools/
├── node/
│   ├── shared/                           ← 案C 5-c で確立
│   │   ├── article-context.js            （共通コンテキスト集約）
│   │   ├── wp-structured.js              （fetchWpStructured: 82%削減実測）
│   │   ├── llm-adapters/                 （Anthropic + OpenAI + Gemini）
│   │   │   ├── anthropic-adapter.js
│   │   │   ├── openai-adapter.js
│   │   │   ├── gemini-adapter.js
│   │   │   └── adapter-interface.js
│   │   └── archive-adapters/             ← 案D 3.H で追加
│   │       ├── wayback-adapter.js        （Phase 1 稼働）
│   │       ├── archive-today-adapter.js  （Phase 2-3 拡張）
│   │       └── adapter-interface.js
│   ├── monitor/                          （既存）
│   └── rewrite/                          ← 案C 5-c-2 で確立
│       ├── target-selection/             （工程1 案E）
│       ├── query-fanout/                 （工程2-3 Step A-2）
│       ├── ig-score/                     （工程4-5 Step A-1）
│       ├── llm-execution/                （工程6' 案C）
│       ├── ab-testing/                   （工程8 Step A-4）
│       └── api/                          （Express ルーティング）
└── data/
    ├── monitor.db                        （既存、Read-Only 参照対象）
    └── rewrite.db                        ← 案E で確立（新規）
```

---

## V. 全20テーブル一覧（案D完了 + 案B 確定後）

### Phase 別配置

```
[Phase 1 で実装: 2 テーブル]
  1. master_rewrite_target_score
  2. master_rewrite_queue

[Phase 2 で実装: 12 テーブル]   ← 案B で +2
  3. master_post_target_query              ★ 案D 2.A
  4. master_query_fanout
  5. master_competitor_corpus
  6. master_fact_set
  7. master_evidence
  8. master_evidence_article_link
  9. master_information_gain_score
  10. master_rewrite_session
  11. master_rewrite_diff
  12. master_rewrite_queue_session_link    ★ 案D 4.M'
  13. master_hcu_checklist                 ★ 案B (#5)
  14. master_article_similarity            ★ 案B (#9, #2) - α指標のみPhase 2

[Phase 3 で実装: 6 テーブル]
  15. master_regulation_event
  16. master_partner_status_history
  17. master_ab_test
  18. master_ab_test_result
  19. master_ab_test_pattern
  20. master_clarity_signal
```

合計: 20テーブル（案D完了時点 18 + 案B 追加 2）

---

## V-A. 全テーブル SQL 定義（案D + 案B 反映 最終版）

### Phase 1: 案E 関連

```sql
-- リライト対象選定スコアの永続化（軸1/2/3/4 統合管理）
-- 案B (#1, #12) で axis 値に 'axis4_decay' を追加
CREATE TABLE master_rewrite_target_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  axis TEXT NOT NULL,
  -- 'axis1_information_gain' / 'axis2_potential' / 'axis3_freshness' / 'axis4_decay'
  -- ※ axis4_decay は案B 4-1 で追加（Content decay 実測シグナル）
  score_value REAL NOT NULL,
  score_components TEXT,                    -- JSON: 軸別の構成要素
  calculated_at DATETIME NOT NULL,
  period_days INTEGER,                      -- 軸2/軸4用（デフォルト28日）
  notes TEXT
);
CREATE INDEX idx_rewrite_target_post ON master_rewrite_target_score(post_id);
CREATE INDEX idx_rewrite_target_axis ON master_rewrite_target_score(axis);
CREATE INDEX idx_rewrite_target_calc ON master_rewrite_target_score(calculated_at);

-- 対象選定キューの記録
-- 案D 2.W で selected_axis / selected_score を NULL 許容化
CREATE TABLE master_rewrite_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  selected_axis TEXT,                       -- NULL 許容（selected_by='daiki_manual' 時）
  selected_score REAL,                      -- NULL 許容（selected_by='daiki_manual' 時）
  selected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  selected_by TEXT,                         -- 'daiki_manual' / 'auto_top_n'
  status TEXT DEFAULT 'queued',             -- 'queued' / 'in_progress' / 'completed' / 'cancelled'
  rewrite_target_score_id INTEGER,          -- どのスコア計算で選定されたか
  notes TEXT,
  FOREIGN KEY (rewrite_target_score_id) REFERENCES master_rewrite_target_score(id)
);
CREATE INDEX idx_queue_status ON master_rewrite_queue(status);
CREATE INDEX idx_queue_post ON master_rewrite_queue(post_id);
```

### Phase 2: Step A-1 関連（案D で post_id 統一・FK削除）

```sql
CREATE TABLE master_fact_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  layer INTEGER NOT NULL,                   -- 1: entity / 2: claim / 3: experience
  content TEXT NOT NULL,
  source_url TEXT,
  extraction_method TEXT NOT NULL,          -- 'kg_api' / 'llm' / 'human'
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  verified_status TEXT DEFAULT 'unverified',
  verified_by TEXT,
  verified_at DATETIME,
  notes TEXT,
  evidence_id INTEGER,                      -- このファクトの「発生源」となった Evidence
                                            -- 記事中の「引用位置」は master_evidence_article_link 経由
  FOREIGN KEY (evidence_id) REFERENCES master_evidence(id)
);
CREATE INDEX idx_fact_set_post ON master_fact_set(post_id);
CREATE INDEX idx_fact_set_layer ON master_fact_set(layer);
CREATE INDEX idx_fact_set_status ON master_fact_set(verified_status);

-- 案D 2.B で query_fanout_id カラム + FK 追加
CREATE TABLE master_competitor_corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_fanout_id INTEGER,                  -- 通常は master_query_fanout.id 経由（NULL 許容）
  target_query TEXT NOT NULL,               -- query_fanout_id NULL 時のフォールバック
  competitor_url TEXT NOT NULL,
  rank_position INTEGER NOT NULL,
  fact_set_snapshot TEXT NOT NULL,          -- JSON形式
  crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  competitor_url_count INTEGER NOT NULL,    -- 取得時のN値（デフォルト3、可変）
  serp_features TEXT,                       -- JSON: PAA/snippet/AI Overview等
  source_type TEXT DEFAULT 'organic',       -- 'organic' / 'ai_overview_citation' / 'paa' / 'related_search'
  notes TEXT,
  UNIQUE(target_query, competitor_url, crawled_at),
  FOREIGN KEY (query_fanout_id) REFERENCES master_query_fanout(id)
);
CREATE INDEX idx_competitor_fanout ON master_competitor_corpus(query_fanout_id);
CREATE INDEX idx_competitor_query ON master_competitor_corpus(target_query);
CREATE INDEX idx_competitor_url ON master_competitor_corpus(competitor_url);
CREATE INDEX idx_competitor_crawled ON master_competitor_corpus(crawled_at);

CREATE TABLE master_information_gain_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  target_query TEXT NOT NULL,
  layer1_gain_score INTEGER NOT NULL,
  layer2_gain_score INTEGER NOT NULL,
  layer3_gain_score INTEGER NOT NULL,
  layer1_gap_count INTEGER NOT NULL,
  layer2_gap_count INTEGER NOT NULL,
  competitor_url_count INTEGER NOT NULL,
  calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);
CREATE INDEX idx_ig_score_post ON master_information_gain_score(post_id);
CREATE INDEX idx_ig_score_query ON master_information_gain_score(target_query);
CREATE INDEX idx_ig_score_calculated ON master_information_gain_score(calculated_at);
```

### Phase 2: Step A-2 関連（案B で intent_dimension 追加）

```sql
-- 案B (#3) で intent_dimension JSON カラム追加
CREATE TABLE master_query_fanout (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_query TEXT NOT NULL,
  sub_query TEXT NOT NULL,
  layer INTEGER NOT NULL,                   -- 1: 主題分解 / 2: micro-intent展開
  parent_sub_query_id INTEGER,
  generation_method TEXT NOT NULL,          -- 'llm' / 'paa' / 'related_search' / 'ai_overview_subquery'
  source_evidence TEXT,
  priority INTEGER DEFAULT 0,               -- 0=未判定 / 1=採用 / 2=保留 / 3=不採用
  intent_dimension TEXT,                    -- 案B (#3): JTBD 5次元 JSON
                                            -- {"purpose":"医療費","barrier":"審査落ち","constraint":"今日中",
                                            --  "comparison_axis":"金利","expected_format":"比較表"}
                                            -- スキーマ: shared/schemas/intent_dimension.schema.json
                                            -- 将来の独立カラム/別テーブル化を想定
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  notes TEXT,
  FOREIGN KEY (parent_sub_query_id) REFERENCES master_query_fanout(id)
);
CREATE INDEX idx_fanout_seed ON master_query_fanout(seed_query);
CREATE INDEX idx_fanout_layer ON master_query_fanout(layer);
CREATE INDEX idx_fanout_priority ON master_query_fanout(priority);
```

### Phase 2: Step A-3 関連（案D で archive_service / archived_urls_extra 追加、post_id 統一）

```sql
CREATE TABLE master_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  content_text TEXT,
  format_type TEXT NOT NULL,                -- 'number' / 'image' / 'video' / 'audio' / 'text'
  file_path TEXT,
  generation_method TEXT NOT NULL,          -- 'survey' / 'measurement' / 'interview' / 'first_hand' / 'official_source'
  source_url TEXT,
  archived_url TEXT,                        -- 正規アーカイブの単一 URL（後方互換）
  archive_service TEXT,                     -- 案D 3.H: 'wayback' / 'archive_today' / 'other'
  archived_urls_extra TEXT,                 -- 案D 3.H: JSON配列、複数アーカイブ保持
  acquired_at DATETIME NOT NULL,
  acquired_by TEXT NOT NULL,
  use_case_tags TEXT NOT NULL,              -- JSON配列: ['information_gain','eeat_experience','compliance','trust_signal']
  volatility TEXT NOT NULL,                 -- 'high' / 'medium' / 'low' / 'static'
  valid_until DATETIME,
  last_url_check_at DATETIME,
  url_health_status TEXT DEFAULT 'unknown',
  verified_status TEXT DEFAULT 'unverified',
  verified_by TEXT,
  verified_at DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_evidence_volatility ON master_evidence(volatility);
CREATE INDEX idx_evidence_valid_until ON master_evidence(valid_until);
CREATE INDEX idx_evidence_url_health ON master_evidence(url_health_status);
CREATE INDEX idx_evidence_status ON master_evidence(verified_status);

CREATE TABLE master_evidence_article_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  citation_position TEXT,
  citation_purpose TEXT,                    -- 'fact_claim' / 'experience_proof' / 'compliance_reference' / 'trust_signal'
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT,
  UNIQUE(evidence_id, post_id, citation_position),
  FOREIGN KEY (evidence_id) REFERENCES master_evidence(id)
);
CREATE INDEX idx_evidence_link_evidence ON master_evidence_article_link(evidence_id);
CREATE INDEX idx_evidence_link_post ON master_evidence_article_link(post_id);
```

### Phase 2: 案D 由来テーブル

```sql
-- 案D 2.A: post_id ↔ target_query 中間テーブル
CREATE TABLE master_post_target_query (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  target_query TEXT NOT NULL,               -- 主たるリライト対象キーワード
  query_role TEXT NOT NULL,                 -- 'primary' / 'secondary'
  source TEXT NOT NULL,                     -- 'manual' / 'gsc_max_impression' / 'gsc_max_clicks' / 'inferred_from_title'
  is_active INTEGER NOT NULL DEFAULT 1,
  set_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  set_by TEXT,
  notes TEXT,
  UNIQUE(post_id, target_query, query_role)
);
CREATE INDEX idx_ptq_post ON master_post_target_query(post_id);
CREATE INDEX idx_ptq_query ON master_post_target_query(target_query);
CREATE INDEX idx_ptq_active ON master_post_target_query(is_active);

-- 案D 4.M': queue ↔ session 多対多中間テーブル
CREATE TABLE master_rewrite_queue_session_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(queue_id, session_id),
  FOREIGN KEY (queue_id) REFERENCES master_rewrite_queue(id),
  FOREIGN KEY (session_id) REFERENCES master_rewrite_session(id)
);
CREATE INDEX idx_qsl_queue ON master_rewrite_queue_session_link(queue_id);
CREATE INDEX idx_qsl_session ON master_rewrite_queue_session_link(session_id);
```

### Phase 2: 案C 由来テーブル（案D で SQL 最終確定）

```sql
-- 案D 1.C-α/β/γ/δ/ε + 4.M' + 3.J 適用後の最終形
CREATE TABLE master_rewrite_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  -- queue_id は master_rewrite_queue_session_link 経由で多対多接続（案D 4.M'）
  -- アプリケーションレベルで「最低1件のリンク」を保証

  -- LLM 実行情報（案C 役割別モデル分離）
  model_analysis TEXT NOT NULL,             -- 例: 'claude-opus-4-7'
  model_generation TEXT NOT NULL,           -- 例: 'claude-sonnet-4-6'

  -- トークン/コスト記録
  input_tokens_analysis INTEGER,
  output_tokens_analysis INTEGER,
  input_tokens_generation INTEGER,
  output_tokens_generation INTEGER,
  cost_total_usd REAL,

  -- ワークフロー状態
  status TEXT NOT NULL DEFAULT 'planned',
  -- 'planned' / 'analyzing' / 'awaiting_policy_judgment' (案K発動時)
  -- / 'generating' / 'awaiting_diff_judgment' / 'completed' / 'aborted'

  -- 工程6'-A 出力
  analysis_output TEXT,                     -- JSON: 構造分析結果
  high_risk_categories TEXT,                -- 案D 1.C-β3: JSON配列、5カテゴリ
                                            -- 'title_change' / 'major_restructure'
                                            -- / 'regulation_citation' / 'rate_update'
                                            -- / 'low_confidence_output'
                                            -- ※ session レベルでは low_confidence_output を維持
                                            --    （案K 発動条件として必要）
  policy_summary TEXT,                      -- Daiki 提示用の方針サマリ

  -- 案K 発動時のみ記録（方針判定）
  policy_judgment TEXT,                     -- 'approved' / 'rejected' / 'edit_approved' / NULL
  policy_judgment_at DATETIME,
  policy_reject_reason TEXT,                -- 5カテゴリ
  policy_reject_note TEXT,

  -- 案V: 過去要因分析の参考情報
  reference_analysis_id INTEGER,            -- monitor.analysis_comments.id 論理参照
                                            -- NULL可（参考情報なし）

  -- タイムスタンプ
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysis_completed_at DATETIME,
  generation_completed_at DATETIME,
  completed_at DATETIME,

  -- 起票
  triggered_by TEXT NOT NULL,               -- 'queue_auto' / 'daiki_manual'
  notes TEXT
);
CREATE INDEX idx_session_post ON master_rewrite_session(post_id);
CREATE INDEX idx_session_status ON master_rewrite_session(status);
CREATE INDEX idx_session_started ON master_rewrite_session(started_at);

CREATE TABLE master_rewrite_diff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  diff_order INTEGER NOT NULL,              -- セッション内の差分順序

  -- 差分の特定
  target_section TEXT NOT NULL,             -- 例: 'h2#申込手順', 'p#3-2', 'meta:title'

  -- 案D 1.C-α1: 操作種別（LLM 出力構造、9種）
  change_type TEXT NOT NULL,
  -- 'rewrite_section' / 'rewrite_paragraph'
  -- / 'insert_after' / 'insert_before' / 'insert_evidence'
  -- / 'delete_section'
  -- / 'update_title' / 'update_meta_description'
  -- / 'restructure_outline'

  -- 案D 1.C-α1: A/Bテスト分類軸（学習ループ用、8種）
  change_category TEXT NOT NULL,
  -- 'title' / 'h2_structure' / 'evidence_insertion' / 'schema'
  -- / 'internal_link' / 'paragraph_rewrite' / 'compliance_update' / 'other'

  -- 案H 差分構造
  content_before TEXT,                      -- 既存箇所（insert系では NULL可）
  content_after TEXT,                       -- 提案内容（delete系では NULL可）
  rationale TEXT NOT NULL,                  -- JSON: 根拠（IG gap / Evidence / Compliance 等）
  estimated_impact TEXT,                    -- JSON: 予測効果
  llm_confidence TEXT NOT NULL,             -- 'high' / 'medium' / 'low'

  -- 案D 3.J: diff 単位の高リスクフラグ（4カテゴリ、'low_confidence_output' 除外）
  risk_flag TEXT,                           -- NULL or:
                                            -- 'title_change' / 'major_restructure'
                                            -- / 'regulation_citation' / 'rate_update'
                                            -- ※ low_confidence は llm_confidence で代替

  -- 案D 1.C-δ1: Evidence 接続（必要な差分のみ、NULL 可）
  evidence_id INTEGER,

  -- 案L: 差分判定（Daiki）
  daiki_judgment TEXT DEFAULT 'pending',    -- 'pending' / 'approved' / 'rejected' / 'edit_approved'
  daiki_edit_content TEXT,                  -- edit_approved 時の編集後内容
  daiki_reject_reason TEXT,                 -- 5カテゴリ:
  -- 'truth_beauty_violation' / 'factual_error'
  -- / 'regulation_violation' / 'evidence_inadequate' / 'other'
  daiki_reject_note TEXT,
  judged_at DATETIME,

  -- 工程7 接続
  applied_to_wp INTEGER DEFAULT 0,          -- 0/1
  applied_at DATETIME,

  -- 案D 1.C-ε1: A/B テスト後追い接続
  ab_test_id INTEGER,                       -- NULL 許容、テスト対象選定時に更新

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id) REFERENCES master_rewrite_session(id),
  FOREIGN KEY (evidence_id) REFERENCES master_evidence(id),
  FOREIGN KEY (ab_test_id) REFERENCES master_ab_test(id)
);
CREATE INDEX idx_diff_session ON master_rewrite_diff(session_id);
CREATE INDEX idx_diff_judgment ON master_rewrite_diff(daiki_judgment);
CREATE INDEX idx_diff_category ON master_rewrite_diff(change_category);
CREATE INDEX idx_diff_risk ON master_rewrite_diff(risk_flag);
CREATE INDEX idx_diff_applied ON master_rewrite_diff(applied_to_wp);
```

### Phase 2: 案B 由来 新規テーブル

```sql
-- 案B (#5): HCU 22項目チェックリスト
-- ※ 22 は Phase 1 リサーチ時点の数値、Phase 2 実装時に Google 公式から再取得
CREATE TABLE master_hcu_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,                 -- monitor.db.articles.post_id 論理参照
  checklist_version TEXT NOT NULL,          -- 'v2025_09' 等、Google 改訂対応
  evaluation_method TEXT NOT NULL,          -- 'llm' / 'human'
  pass_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  pass_rate REAL NOT NULL,                  -- pass_count / total_count
  item_results TEXT NOT NULL,               -- JSON: 各項目の Yes/No + コメント
                                            -- {"item_1":{"pass":true,"comment":"..."}, ...}
  evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  evaluated_by TEXT,
  notes TEXT
);
CREATE INDEX idx_hcu_post ON master_hcu_checklist(post_id);
CREATE INDEX idx_hcu_evaluated ON master_hcu_checklist(evaluated_at);
CREATE INDEX idx_hcu_pass_rate ON master_hcu_checklist(pass_rate);
CREATE INDEX idx_hcu_version ON master_hcu_checklist(checklist_version);

-- 案B (#9, #2): 関連度テーブル基盤
-- Phase 2 で α (text_similarity) のみ実装、Phase 3 で β/γ 追加
-- 用途: # 9 internal linking / # 2 cannibalization / Phase 3 サイト全体監査
CREATE TABLE master_article_similarity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL,          -- 起点記事（monitor.db.articles.post_id 論理参照）
  target_post_id INTEGER NOT NULL,          -- 関連先記事（monitor.db.articles.post_id 論理参照）
  text_similarity REAL,                     -- α: テキスト類似度 (0.0-1.0) Phase 2
  query_overlap REAL,                       -- β: クエリ重複度 (0.0-1.0) Phase 3
  entity_overlap REAL,                      -- γ: エンティティ共起度 (0.0-1.0) Phase 3
  rank_in_source INTEGER NOT NULL,          -- source 視点の類似度順位 (Top-K=20〜50)
  calculation_method TEXT NOT NULL,         -- 'tfidf' / 'embedding' / 'hybrid'
  calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(source_post_id, target_post_id, calculated_at)
);
CREATE INDEX idx_similarity_source ON master_article_similarity(source_post_id);
CREATE INDEX idx_similarity_target ON master_article_similarity(target_post_id);
CREATE INDEX idx_similarity_text ON master_article_similarity(text_similarity);
CREATE INDEX idx_similarity_query ON master_article_similarity(query_overlap);

-- 月次バッチで全記事再計算 + 手動トリガー API 提供:
-- POST /api/rewrite/similarity/recalculate
--   Body: { target_post_ids: [123, 456] | null, indicators: ['text','query','entity'] | null }
--   Response: { job_id, estimated_duration_seconds }
-- GET /api/rewrite/similarity/jobs/:job_id
--   Response: { status: 'running'|'completed'|'failed', progress: 0-100 }
```

### Phase 3: 案E + Step A-4 関連

```sql
-- 法令変更マスター
CREATE TABLE master_regulation_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regulation_name TEXT NOT NULL,            -- '貸金業法' / '景表法' / 'ステマ規制' 等
  event_date DATETIME NOT NULL,
  event_type TEXT NOT NULL,                 -- 'amendment' / 'enforcement' / 'guideline_update'
  affected_categories TEXT,                 -- JSON配列
  description TEXT,
  source_url TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT
);

-- 商材ステータス履歴
CREATE TABLE master_partner_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT NOT NULL,               -- monitor.daily_affiliate_clicks.partner と整合
  status TEXT NOT NULL,                     -- 'active' / 'terminated' / 'modified' / 'suspended'
  changed_at DATETIME NOT NULL,
  description TEXT,
  notes TEXT
);

-- A/Bテスト関連（Step A-4）
CREATE TABLE master_ab_test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_name TEXT NOT NULL,
  test_type TEXT NOT NULL,                  -- 'before_after' / 'staged_rollout' / 'searchpilot_full'
  hypothesis TEXT NOT NULL,
  change_category TEXT NOT NULL,
  -- 'title' / 'h2_structure' / 'evidence_insertion' / 'schema'
  -- / 'internal_link' / 'paragraph_rewrite' / 'compliance_update' / 'other'
  change_description TEXT NOT NULL,
  target_urls TEXT NOT NULL,                -- JSON配列
  control_urls TEXT,                        -- 段階的リリース時のコントロール
  applied_at DATETIME NOT NULL,
  observation_start DATETIME NOT NULL,
  observation_end DATETIME NOT NULL,
  status TEXT DEFAULT 'planned',            -- 'planned' / 'running' / 'completed' / 'aborted'
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);
CREATE INDEX idx_ab_test_status ON master_ab_test(status);
CREATE INDEX idx_ab_test_category ON master_ab_test(change_category);
CREATE INDEX idx_ab_test_applied ON master_ab_test(applied_at);

CREATE TABLE master_ab_test_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  period TEXT NOT NULL,                     -- 'pre' / 'post'
  url TEXT NOT NULL,
  clicks INTEGER,
  impressions INTEGER,
  ctr REAL,
  avg_position REAL,
  conversions INTEGER,
  conversion_rate REAL,
  ai_overview_citation_count INTEGER,
  data_start DATETIME NOT NULL,
  data_end DATETIME NOT NULL,
  google_update_in_period BOOLEAN DEFAULT 0,
  measured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  clarity_signal_id INTEGER,                -- Clarity連携
  FOREIGN KEY (test_id) REFERENCES master_ab_test(id),
  FOREIGN KEY (clarity_signal_id) REFERENCES master_clarity_signal(id)
);
CREATE INDEX idx_ab_result_test ON master_ab_test_result(test_id);
CREATE INDEX idx_ab_result_period ON master_ab_test_result(period);

CREATE TABLE master_ab_test_pattern (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  pattern_type TEXT NOT NULL,               -- 'adopt' / 'avoid' / 'condition'
  change_category TEXT NOT NULL,
  pattern_description TEXT NOT NULL,
  effect_size_percent REAL,
  confidence_level TEXT NOT NULL,           -- 'high' / 'medium' / 'low'
  applicable_conditions TEXT,
  active_status TEXT DEFAULT 'active',      -- 'active' / 'deprecated' / 'review_needed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (test_id) REFERENCES master_ab_test(id)
);
CREATE INDEX idx_ab_pattern_type ON master_ab_test_pattern(pattern_type);
CREATE INDEX idx_ab_pattern_status ON master_ab_test_pattern(active_status);

CREATE TABLE master_clarity_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  ab_test_id INTEGER,
  ab_test_period TEXT,                      -- 'pre' / 'post' / NULL
  scroll_depth_avg REAL,
  scroll_depth_p50 REAL,
  engagement_score REAL,
  dead_click_rate REAL,
  rage_click_rate REAL,
  session_count INTEGER,
  data_start DATETIME NOT NULL,
  data_end DATETIME NOT NULL,
  measured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ab_test_id) REFERENCES master_ab_test(id)
);
CREATE INDEX idx_clarity_url ON master_clarity_signal(url);
CREATE INDEX idx_clarity_test ON master_clarity_signal(ab_test_id);
CREATE INDEX idx_clarity_period ON master_clarity_signal(ab_test_period);
```

---

## VI. 各Step / 案の確定事項（議論結論のサマリ）

### Step A-1: Information Gain

| 項目 | 確定 |
|---|---|
| レイヤー方式 | 3レイヤー全採用（エンティティ + 事実主張 + 経験） |
| KPI | Information Gain スコア（特許準拠）を直接KPI化 |
| 競合上位URL数 | デフォルト N=3、可変設定 |
| 既存スコアリング統合 | 案E にて方針確定。リライト対象選定は新規軸（軸1）、IG は軸1の主構成要素 |
| 著者・監修管理 | 別途人間が管理（システム対象外） |

### Step A-2: Query Fan-out

| 項目 | 確定 |
|---|---|
| Fan-out 生成主体 | LLM + 実SERP ハイブリッド |
| 分解次元 | Layer1主題 + Layer2 micro-intent（二段構造） |
| Layer2への競合URL収集 | 行わない（Layer1のみ） |
| AI Overview citation源 | 統合追跡（source_typeカラムで区別） |
| 工程2-3の統合 | 統合（Query Fan-out が両方を担う） |
| SERP API | SerpApi（サブスクStarter） |
| 抽象化レイヤー | Adapter層を挟む（将来差し替え可能） |
| 案B (#3) JTBD | intent_dimension JSON カラム追加（将来独立化想定） |
| 案B (#4) Question gap | PAA + サジェスト + 関連検索のみ、既存スキーマで完結 |

### Step A-3: Evidence Layer

| 項目 | 確定 |
|---|---|
| Original research と First-hand experience の統合 | 統合（Evidence Layerとして一元管理） |
| 4軸タグ分類 | 形式 × 生成方法 × 用途 × 変動性 |
| Evidence と記事の関係 | 多対多（共有プール） |
| 劣化管理 | volatility + valid_until 併用 |
| URL検証 | Wayback Machine + archive.today（案D 3.H で Adapter 化） |

### Step A-4: A/B Testing

| 項目 | 確定 |
|---|---|
| 方式 | 案1（完全SearchPilot方式）採用 |
| サンプル数 | 3,000記事を control / variant A / variant B に1,000ずつ分割 |
| 学習ループ | 3層（記録 → パターン抽出 → 戦略反映） |
| 効果測定指標 | クリック / インプ / CTR / CV + Clarity（A/Bテスト判定にも統合） |
| 判定方式 | 主指標統計検定 × Clarity gating の二段判定 |
| 結果分類 | positive / positive_with_warning / negative / inconclusive |
| Google Update対応 | 完全除外せず信頼度補正 |
| 実装フェーズ | 案D 4.N: Phase 3 同時実装（蓄積件数前提を満たすライン） |

### 案E: リライト対象選定（新規設計）

| 項目 | 確定 |
|---|---|
| 設計方針 | 既存スコアリングとは別目的のため、新規ロジックを構築 |
| 軸構成 | 4軸（軸1=構造的不足 / 軸2=経済合理性 / 軸3=鮮度・正確性 / 軸4=Content decay 実測） |
| 旧軸4の扱い | 「構造的健全性」は対象選定から分離、サイト全体監査として別レイヤー |
| 統合方式 | 独立キュー（合算スコアは採用しない） |
| 既存システムとの関係 | データ層は monitor.db を Read-Only 参照、スコア層は完全独立 |
| 物理DB配置 | rewrite.db（新規） + monitor.db（既存）の別DB方式、ATTACH DATABASE で同時参照 |
| 既存資産の活用 | monitor-collectors.js / EXCLUDED_CATEGORIES / monitor-analysis.js（buildPrompt） |

### 案C: LLM 実行レイヤー

| 項目 | 確定 |
|---|---|
| 工程6' 構造 | 二段構造（6'-A 分析 + 6'-B 生成） |
| LLM 選定 | 役割別: Opus 4.7（分析）+ Sonnet 4.6（生成） |
| Adapter 層 | Phase 1 から3社対応（Anthropic + OpenAI + Gemini、画像生成将来対応） |
| 出力形式 | 案H（差分パッチ、change_type 9種） |
| 本文取得 | fetchWpStructured（cheerio ベース、82%削減実測） |
| 削減フィルタ | 監修者ブロック除去 + 目次除去 + CTA バナーマーカー化 |
| 人間判定境界 | 案L ベース + 案K（高リスク 5カテゴリ）発動 |
| 棄却カテゴリ | 5（真=美違反 / 事実誤認 / 規制違反 / Evidence不適切 / その他） |
| 既存資産統合 | shared/ ディレクトリ + s-tools/rewrite/ サブディレクトリ |
| 過去要因分析 | 案V: 直近1件を「参考情報」として渡す |
| MAX_CONTENT_CHARS | 既存 monitor 側の改修は別案件として保留 |

### 案D: 統合確認

| 項目 | 確定 |
|---|---|
| 1.A: ATTACH 越し FK | 全削除、論理参照に統一、コメント明示 |
| 1.B: 識別子 | post_id に統一（monitor.db Single Source of Truth） |
| 1.D: fact_set ↔ evidence | 二経路維持（発生源 vs 引用位置の役割分離） |
| 1.C-α: change_type/category | α1 両方保持（操作 vs 学習用分類） |
| 1.C-β: high_risk_categories | β3 session 配列 + diff 単一フラグ両方 |
| 1.C-γ: queue_id NOT NULL | γ2 採用後、4.M' で多対多化（カラム削除） |
| 1.C-δ: evidence_id | δ1 NULL 許容 |
| 1.C-ε: ab_test_id | ε1 後追い設定 |
| 2.A: post_id ↔ seed_query | 新規テーブル master_post_target_query |
| 2.B: fanout ↔ corpus | query_fanout_id FK 追加 |
| 2.W: queue NULL 許容 | selected_axis / selected_score を NULL 可 |
| 2.F: diff → ab_test 集約 | F1 月次バッチ、change_category 単位 |
| 2.G: pattern 注入 | G2 active 限定、上位5件 |
| 3.H: archive Adapter | H1 archive_service カラム + 複数アーカイブ対応 |
| 3.I: IG Score 独立 | I2 維持（target_score と責務分離） |
| 3.J: risk_flag 重複 | J1 'low_confidence_output' 除外（diff レベル、4カテゴリ） |
| 4.K: post_target_query | K2 Phase 2 構築（Phase 1 では利用先なし） |
| 4.L: Phase 1 の用語 | L1 「対象選定の自動化」段階（自走ではない） |
| 4.M: queue ↔ session | M1' 多対多化（master_rewrite_queue_session_link） |
| 4.N: A/Bテスト実装 | N2 Phase 3 同時 |

### 案B: 強推奨手法の確定

| 項目 | 確定 |
|---|---|
| 採用件数 | 8件（# 1, 2, 3, 4, 5, 9, 11, 12） |
| 不採用件数 | 3件（# 6, 7, 10 - CMS / リライト主流路外） |
| 既確定 | 1件（# 8 FAQ/HowTo 不実装） |
| Reddit/Quora 採用 | 見送り（実装困難） |
| Content decay 統合判断 | 軸4 独立キューで採用、実運用後に統合判断 |
| HCU 22項目 | 独立テーブル新設、LLM 自動評価 |
| 関連度テーブル | レベル3（事前計算）+ 共有基盤化（# 2 / # 9 / Phase 3 サイト全体監査） |
| 月次バッチ | 自動 + 手動トリガー API |
| クエリレベル decay (#11) | Phase 2 案C 入力情報（軸ではなく方向性指示） |

### 全体共通の確定事項

| 項目 | 確定 |
|---|---|
| 評価軸（API選定） | 速度 > 精度 > 費用（順序付き）。日本語Google対応は必須 |
| 「精度」の解釈 | AI Overview citation源の取得精度を含む |
| 処理方式 | 遅延評価型（lazy evaluation）。月50記事ペース、スキャン数可変 |
| 「初回フルスキャン」概念 | 削除。実運用しながら拡張する設計 |

---

## VII. 採用却下した選択肢と理由

| 却下案 | 理由 |
|---|---|
| Yahoo!スクレイピングでSERP取得 | Yahoo! JAPAN利用規約で明示禁止、Yahoo検索エンジンはGoogle同等のためメリットなし |
| DataForSEO（標準速度） | 45分待ちの非同期APIで速度要件を満たさない |
| Serper | AI Overview検出率36-48%、PAA回答全文取得不可で精度要件を満たさない |
| Scrape.do | SerpApiサブスクで採用決定 |
| 国別軸（米独英日）でのリサーチ整理 | 工程別軸の方が構造的に正しい |
| 「実務家が使っている」を有効性根拠とする | ポジトーク汚染リスク。Google一次情報ベースに変更 |
| 文字数神話・密度神話・dwell time KPI | Google公式が複数回否定 |
| FAQ schema大量実装 / HowTo schema | 2023年8月以降廃止・限定化 |
| Information Gain初回フルスキャン | 真=美の最小性テスト違反、遅延評価に変更 |
| 案4 Before/After A/Bテスト必須採用 | 3,000記事規模なら完全SearchPilot方式が成立、案4は不要 |
| 既存スコアリング（A系/B系）のリライト対象選定への流用 | 目的が違う（CTA優先度・順位観測 vs リライト対象選定）。流用は構造的混濁を生む |
| 旧軸4（構造的健全性）を対象選定軸として採用 | 個別記事選定とサイト全体監査は別レイヤー、混在は閉合性違反 |
| 合算スコア方式（軸を加重和） | 軸の意味が消え、Daikiの真=美判定が機能しなくなる |
| 同一DB（monitor.db 拡張）方式 | 責任境界が混濁、障害分離不可 |
| 案G（完全書き直し）出力形式 | A/Bテスト粒度不足、既存記事の検索順位資産を破壊 |
| 案I（指示書のみ）出力形式 | 工程7（実装）への接続が弱い |
| 案N（人間判定なし） | YMYL致命的、Daikiの認知が外部に出る経路が消滅 |
| 本文単純キャップ拡張（案A/B/C） | 構造化抽出（案E）で根本解決 |
| 階層化処理（案D） | 構造化抽出で予算問題解決 → 不要 |
| ハイブリッド（案F） | 案E 単独で全記事カバー可能、2系統共存は最小性違反 |
| GPT-5.5 / GPT-5.4 メインLLM | ハルシネーション弱点（GPT-5.5）、日本語品質劣勢、Adapter 層は将来用に対応 |
| analysis_comments テーブルへのリライト統合保存 | 案E の DB分離原則と矛盾 |
| ATTACH 越し FK 宣言維持 | SQLite で機能しない、誤解を招く宣言は閉合性違反 |
| article_id 維持 | post_id に統一（Single Source of Truth） |
| queue_id NOT NULL 維持 | 多対多化（案D 4.M'）で更に強化 |
| M1 素朴採用（軸別独立 session） | 差分衝突、Daiki 判定負荷3倍、実装で破綻 |
| M2（最新1件のみ） | 軸別選定履歴の損失、学習ループ精度低下 |
| 階層的 schema をリライトシステムに組込み（案B # 7） | CMS（WordPress）側で扱う領域。責務分離が構造的に正しい |
| INP 監視をリライトシステムに組込み（案B # 10） | リライト主流路外（記事本文リライトで INP は変化しない）+ Clarity engagement_score との機能重複 |
| Author expertise schema をリライトシステム側で構造保存（案B # 6） | CMS 側で対応 + 監修判断は人間（今回フェーズ対象外） |
| Reddit / Quora API 連携（案B # 4 拡張） | Reddit API 課金化、Quora API なし、Yahoo知恵袋スクレイピング規約違反 |
| Content decay 軸4 を軸2 サブシグナルに統合（案B 4-1） | 実測 traffic decay と機会損失指標は別概念、独立キュー採用 |

---

## VIII. 真=美フレームワーク適用ルール（システム設計向け）

各Step・各設計判断で適用：

```
必然性テスト: この要素を除いたら構造は崩壊するか
閉合性テスト: 内部で全ての関係が完結しているか
最小性テスト: より少ない要素で同じ機能を実現できないか
```

設計上の派生原則：
- 遅延評価（lazy evaluation）型処理
- 抽象化レイヤー（API / LLM / Archive 全て差し替え可能）
- 3層学習ループ（記録 → 抽出 → 反映）
- 主指標 × Clarity gating の二段判定
- ポジトーク回避（Google一次情報ベース）
- 既存資産の最大流用（再発明禁止、ただし目的が一致する範囲のみ）
- 複雑性の局所化（複雑な要件は1箇所に集めて他を守る、案D 4.M' 確立）

---

## IX. 案E確定事項: リライト対象選定の3軸 → 4軸構成（案B で拡張）

### 設計方針の修正

旧案E（既存スコアリング統合）→ 新案E（リライト対象選定の新規設計）→ 案B (#1, #12) で軸4 追加

理由: 既存スコアリング（s-tools 内の A系/B系）は本来 CTA挿入優先度 と 順位観測 を目的としたもので、リライト対象選定とは目的が異なる。流用は構造的混濁を生む。

### 4軸構成

| 軸 | 内容 | スコア要素 | Phase |
|---|---|---|---|
| 軸1 | 構造的不足 | IG Score + 検索意図3層カバレッジ | 2 |
| 軸2 | 経済合理性 | impressions × position_gap_factor | 1 |
| 軸3 | 鮮度・正確性 | 経過月数 / 法令変更アラート / 商材ステータス変更アラート | 1+3 |
| 軸4 | Content decay 実測 | 28日窓×90日窓 traffic 差分（クリック+インプ+順位の3指標統合） | 1 |

[削除] 旧軸4: 構造的健全性
  → サイト全体監査として別レイヤーに分離（案E対象外、別案で扱う）

### 軸2の計算ロジック（Phase 1）

```
position_gap_factor:
  1-3位:    0.1（上昇余地小）
  4-10位:   1.0（上昇しやすい）
  11-20位:  0.7（上昇可能）
  21-50位:  0.3（困難）
  51位以下: 0.05

axis2_score = impressions × position_gap_factor

入力: monitor.daily_metrics 過去N日（デフォルト28日）
出力: post_id, axis2_score, axis2_components(JSON)
永続化: master_rewrite_target_score (axis='axis2_potential')
```

### 軸3の計算ロジック（Phase 1: 経過月数のみ → Phase 3 拡張）

```
[Phase 1]
axis3_freshness_score = (現在日 - articles.wp_modified) の経過月数

[Phase 3 拡張]
regulation_alert: 関連法令変更日 > 記事最終更新日 のフラグ
service_termination_alert: 言及している商品/サービスの終了フラグ
```

### 軸4の計算ロジック（Phase 1、案B 4-1-β）

```
3指標の窓差分を統合（標準版）:
  click_delta_pct  = (recent_28d_clicks - prev_28d_clicks) / prev_28d_clicks
  impr_delta_pct   = (recent_28d_impr - prev_28d_impr) / prev_28d_impr
  position_delta   = recent_28d_avg_position - prev_28d_avg_position

axis4_decay_score = 各指標の悪化度を合算してスコア化（具体重み付けは Phase 1 実装時確定）

入力: monitor.daily_metrics 過去56日（28日 × 2窓）
出力: post_id, axis4_decay_score, axis4_components(JSON)
永続化: master_rewrite_target_score (axis='axis4_decay')

注意:
  - α (クリック数のみ) は採用却下: ノイズ多い
  - γ (URL × クエリ多変量) は Phase 1 では過剰、案B # 11 として Phase 2 案C 入力情報で実装
```

### 既存システムとの役割分離

| 項目 | 既存システム | リライトシステム |
|---|---|---|
| 目的 | CTA挿入優先度 / 順位観測 / 要因分析 | リライト対象選定 / 差分生成 / A/Bテスト |
| DB | monitor.db | rewrite.db（新規） |
| データ層 | 既存テーブルを継続更新 | monitor.db を Read-Only 参照 |
| スコア層 | A系（runScoring）/ B系（alertScore）で完結 | 軸1/2/3/4の独立スコアを構築 |
| 効果測定の役割 | リライト後の指標継続観測 + Claude要因分析 | A/Bテストの統計検定 + パターン抽出 |

### DB物理配置

```sql
-- リライトシステム側で使う
ATTACH DATABASE '/path/to/monitor.db' AS monitor;

-- JOIN例: 軸1のIG高スコア記事を取得
SELECT 
  m.post_id, m.url, m.title,
  r.score_value
FROM monitor.articles m
INNER JOIN main.master_rewrite_target_score r ON m.post_id = r.post_id
WHERE r.axis = 'axis1_information_gain'
ORDER BY r.score_value DESC;
```

監視: monitor.db への接続は SQLite URI `file:/path/to/monitor.db?mode=ro` で Read-Only 強制。
注意: ATTACH 越しの FOREIGN KEY 制約は SQLite で機能しないため、論理参照（コメント明示）で運用（案D 1.A 確定）。

### 統合方式: 独立キュー

4軸を独立キューで提示。合算スコアは採用しない。

```
キュー1: 軸1スコア降順 Top N
キュー2: 軸2スコア降順 Top N
キュー3: 軸3スコア降順 Top N
キュー4: 軸4スコア降順 Top N

Daikiが月次で「今月はどの軸を優先するか」を真=美判定
4キュー全てで上位に来る記事 = 自然に最優先候補
```

---

## X. 案C確定事項: LLM 実行レイヤー（工程6'）

### 二段構造

```
工程6'-A: 分析・構造判断 (Opus 4.7)
  入力: case_d 4.M' 適用後の master_rewrite_session 起票データ
        + IG gap + Evidence Layer + Query Fan-out + 過去 analysis（案V）+ active pattern（案D 2.G）
  処理: 構造分析、リライト方針決定、高リスク判定
  出力: master_rewrite_session.analysis_output, high_risk_categories, policy_summary

  → 高リスク変更（5カテゴリ）検出時:
      master_rewrite_session.status = 'awaiting_policy_judgment'
      Daiki が方針承認/却下 (案K 発動)
      承認 → 工程6'-B へ進行
      却下 → master_rewrite_session.status = 'aborted'

工程6'-B: 差分テキスト生成 (Sonnet 4.6)
  入力: 6'-A の方針 + コンテキスト
  処理: 案H 差分パッチ生成（change_type 9種）
  出力: master_rewrite_diff レコード群

  → master_rewrite_session.status = 'awaiting_diff_judgment'
  Daiki が差分単位で判定（案L、5棄却カテゴリ）
  承認 → master_rewrite_diff.daiki_judgment = 'approved' / 'edit_approved'
       → 工程7 で WordPress 反映
```

### 高リスク変更 5カテゴリ（案K 発動条件）

```
1. title_change                  タイトル変更
2. major_restructure             構成大変更（h2 順序変更、セクション削除）
3. regulation_citation           法令引用の修正
4. rate_update                   金利・限度額・料率の更新
5. low_confidence_output         LLM confidence: low の出力（session レベルのみ）
```

### 棄却理由 5カテゴリ（案L、Daiki 判定時）

```
1. truth_beauty_violation        真=美違反（必然性なし）
2. factual_error                 事実誤認
3. regulation_violation          規制違反
4. evidence_inadequate           Evidence不適切
5. other                         その他（自由記述）

→ 棄却データは Step A-4 の3層学習ループ Layer2 に接続（学習元データ）
```

### LLM コスト（参考）

```
工程6'-A (Opus 4.7):
  入力 80K × $5/M + 出力 2.5K × $25/M = $0.46

工程6'-B (Sonnet 4.6):
  入力 18K × $3/M + 出力 10K × $15/M = $0.21

計 $0.67/記事 × 50記事 = $33.5/月
```

### fetchWpStructured（案C 5-c）

```
従来 fetchWpContent (既存 monitor):
  記事本文を style タグ含めて取得
  実測: max 210K 文字、p50 114K 文字
  既存システムでは MAX_CONTENT_CHARS=12,000 でカットして利用 → 冒頭5-10%しか LLM に見せていない

新 fetchWpStructured (shared/wp-structured.js):
  cheerio ベースで構造化抽出（Markdown 互換）
  実測: max 210K → 38K (82.5%削減、n=3)
  さらに削減フィルタ:
    - 監修者ブロック除去（全記事共通テキスト）
    - 目次（ez-toc）除去（h タグ階層で代替）
    - CTA バナー → [CTA: {partner_slug}] マーカー化（位置情報を保持）
  推定さらに 20% 圧縮（max級記事 38K → 25-30K）

→ Phase 2 で案C と並行実装、既存 monitor-analysis.js (C系) への転用は別案件として保留
```

---

## XI. MVP 3 Phase 戦略（案D完了 + 案B 反映 工数最終版）

```
Phase 1: 対象選定の自動化（実工数 9〜14日）
  - rewrite.db 構築、monitor.db Read-Only接続
  - 軸2スコア計算ロジック（既存 daily_metrics 活用）
  - 軸3経過月数スコア計算ロジック
  - 軸4 Content decay スコア計算ロジック（案B (#1, #12)、+3〜4日）
  - 対象選定APIエンドポイント（GET /api/rewrite/queue?axis=N&limit=20）
  - 簡易UI（軸別キュー表示、4軸独立）
  - 日次バッチ（cron）
  → 完了条件: 単独でMVP運用可能（用語: 「対象選定の自動化」段階）

Phase 2: 自走システム本格稼働（実工数 16〜25日）
  - Step A-1/A-2 のテーブル構築
  - master_post_target_query 構築（案D 2.A）
  - SerpApi Adapter 層
  - IG Score 計算ロジック（3レイヤー、競合 N=3）
  - Query Fan-out 二段構造 + JTBD 拡張（案B (#3)、+1〜2日）
  - Question gap (PAA + サジェスト + 関連検索)（案B (#4)、Step A-2 内包）
  - 軸1スコアを master_rewrite_target_score に統合
  - HCU 22項目チェックリスト + LLM 自動評価（案B (#5)、+2〜3日）
  - master_article_similarity (α: テキスト類似度)（案B (#9, #2)、+3〜5日）
  - 案C: shared/wp-structured.js 実装
  - 案C: shared/llm-adapters/ 実装（3社対応）
  - 案C: shared/article-context.js 実装
  - 案C: master_rewrite_session + master_rewrite_diff 実装
  - 案C: master_rewrite_queue_session_link 実装
  - 案C: 工程6'-A/6'-B オーケストレーション
  - 案C: 差分パッチ承認UI（案L + 案K 発動）
  - クエリレベル decay 検出（案B (#11)、案C 入力情報として実装）
  → 完了条件: 自走システム本格稼働ライン

Phase 3: 学習ループ稼働（実工数 8.5〜13日）
  - master_regulation_event 構築 + 初期データ投入
  - master_partner_status_history 構築
  - 法令変更/商材ステータス変更アラート
  - shared/archive-adapters/ 実装（Wayback + archive.today）
  - master_ab_test* テーブル群構築（4テーブル）
  - SearchPilot variant 割当ロジック（Cloudflare Workers）
  - 統計検定 + Clarity gating
  - 3層学習ループ実装
  - master_article_similarity (β/γ 拡張、Cannibalization 検出)（案B (#9, #2) 後半、+4〜6日）
  - HCU 改訂対応バッチ（案B (#5)、+1日）
  → 完了条件: YMYL最重要対策の自動化完了 + 自走システム完成形

実装工数合計: 33.5〜52日
  (案D完了時点見積もり 24.5〜38日 + 案B 追加 +9〜14日)
  カレンダー時間想定: 3〜5ヶ月
```

---

## XII. データフロー閉合性（案D 確定 + 案B 反映）

```
[工程1] 案E 対象選定
  rewrite.db.master_rewrite_target_score (軸1/2/3/4)
    → rewrite.db.master_rewrite_queue (軸別キュー)
        ↓ post_id

[工程2-3] Step A-2 Query Fan-out
  rewrite.db.master_post_target_query から target_query 取得 ★案D 2.A
    → SerpApi 呼出
    → rewrite.db.master_query_fanout (Layer1主題分解 + JTBD intent_dimension) ★案B (#3)
    → PAA + サジェスト + 関連検索を generation_method で識別 ★案B (#4)
        ↓ query_fanout_id ★案D 2.B

[工程4-5] Step A-1 IG Score
  → rewrite.db.master_competitor_corpus (競合 fact_set)
  → rewrite.db.master_fact_set (自記事 fact)
    → rewrite.db.master_information_gain_score (gap_count)
    → rewrite.db.master_evidence (Step A-3 Evidence Layer)
        ↓ post_id + ig_score + evidence
  
  並行:
    → rewrite.db.master_hcu_checklist (LLM 自動評価) ★案B (#5)
    → rewrite.db.master_article_similarity (関連記事候補) ★案B (#9)

[工程6 + 6'] 案C LLM 実行
  rewrite.db.master_ab_test_pattern から active pattern 注入 ★案D 2.G
  rewrite.db.master_hcu_checklist 結果を案C 入力に追加 ★案B (#5)
  rewrite.db.master_article_similarity から関連記事候補注入 ★案B (#9)
  クエリレベル decay (#11) を案C 入力情報として注入 ★案B (#11)
    → Opus 4.7 (分析・方針)
    → 案K 発動判定 → Daiki 判定 (高リスク時)
    → Sonnet 4.6 (差分生成)
    → rewrite.db.master_rewrite_session (case_d 4.M' 多対多接続)
    → rewrite.db.master_rewrite_queue_session_link
    → rewrite.db.master_rewrite_diff
        ↓ daiki_judgment='approved'

[工程7] 実装
  WordPress REST API
    → master_rewrite_diff.applied_to_wp=1, applied_at=NOW
        ↓

[工程8] Step A-4 A/B Testing
  月次バッチで change_category 集約 ★案D 2.F
    → master_ab_test (planned)
    → SearchPilot variant 割当
    → master_ab_test_result (期間ごと)
    → master_clarity_signal (UX gating)
    → 統計検定 + Clarity gating
    → master_ab_test_pattern (adopt/avoid/condition)
        ↓ feedback to 工程6'-A プロンプト ★案D 2.G
```

---

## XIII. 残課題リスト

### 設計フェーズで未確定（Phase 3 詳細設計で扱う）
- Daikiの真=美判定UI（差分パッチ承認画面）の詳細仕様
- 著者・監修者管理システムとの接続方法
- ステマ規制・貸金業法 Compliance Layer の自動チェック仕様
- サイト全体監査レイヤーの設計（案E 旧軸4 から分離、関連度テーブル γ で接続予定）
- WordPress 反映の冪等性設計（同じ diff を二重適用しない保証）
- SearchPilot variant 割当ロジックの詳細
- HCU 22項目の正確な項目数（Phase 2 実装時に Google 公式から再取得）
- intent_dimension JSON Schema の正規定義（shared/schemas/intent_dimension.schema.json）
- 案B (#9) レベル3 の関連度計算アルゴリズム詳細（埋め込みベクトル選定）

### 環境継続監視
- Google Search Quality Rater Guidelines の年次改訂
- Google Core Updates の発生
- Site Reputation Abuse のアルゴリズム化（現時点は手動措置のみ）
- 景品表示法・貸金業法の改正（直近: 2025年4月2日 日本貸金業協会細則改訂）
- HCU 質問項目の改訂（master_hcu_checklist.checklist_version で対応）

---

## XIV. 警戒すべき AI 側のバイアス（蓄積版）

設計プロセスを通じて、AI（Claude）が陥りやすい以下のバイアスが特定された。次セッション以降のClaudeはこれらに警戒する必要がある。

### 案E で判明: 「既存資産への過剰適応バイアス」
```
資産が高品質 → 流用したい → 流用できる前提で組み立てる
正しくは「目的が一致するか?」を最初に問う必要がある
```

### 案D で判明: 「自分の初期推奨に固着するバイアス」
```
片側照射の傾向あり、初期推奨の構造的破綻を見落とすリスク
Daiki の直感的懸念（「これでちゃんとリライトできるか」等）が
片側照射を暴く重要なシグナルになる
→ 直感的懸念を「実装で確認する」と片付けず、構造的に再検証する
```

### 案B で判明: 「強推奨ラベルへの追従バイアス」
```
リサーチレポートで「強推奨」と評価されているからといって採用すべきとは限らない
Phase 1 リサーチは情報源の質に幅があり、業界専門家支持と Google 一次情報支持を
混同しないことが重要
→ 各手法を Google 一次情報の有無で再フィルタリング
→ 案B では実際に # 9 Hub-and-spoke が Google 一次情報の直接支持なし（業界支持中心）
  であることが浮き彫りになり、Daikiの判断材料となった
```

### 案B で警戒された「機能を盛りたくなるバイアス」
```
設計が複雑になるほど「あれもこれも組み込みたい」という心理が働く
真=美の最小性原則に反する
→ レベル0/レベル1の最小限版を必ず併記、Daikiが選択できる状態を保つ
→ 案B # 9, # 10 の判定で実際に機能した
```

---

## XV. 進行ステータス（次の一歩）

```
次の作業: Phase 3 詳細設計
  対象:
    1. Daikiの真=美判定UI（差分パッチ承認画面）の詳細仕様
    2. エラーハンドリング（LLM API 失敗・SerpApi 失敗・WP 反映失敗）
    3. Compliance Layer 詳細仕様（景品表示法 / 貸金業法 / ASP レギュ）
    4. サイト全体監査レイヤー設計（案E 旧軸4 + 関連度テーブル γ）
    5. SearchPilot variant 割当ロジックの詳細

その後の進行:
  Phase 4: 実装
```

---

## END OF DESIGN SPECIFICATION (案B 完了反映版)
