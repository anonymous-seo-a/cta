# 次セッション用ハンドオフプロンプト（Phase 3 詳細設計）

このファイルは、Claude Code 環境で新規セッションを開始するときに、Claudeに最初に渡すプロンプトとして使用する。

最終更新: 2026年4月30日（案B 完了後 / Claude Code 環境への引き継ぎ完了後）
前提環境: Claude Code（s-tools/design/ 配下に全資産統合済み）

---

## 使い方（Claude Code 環境）

Claude Code 起動時、ルート直下の `CLAUDE.md` が自動読込される。
新規チャットを開始したら、以下のテキストブロックを最初のメッセージとしてコピペで送る。

---

## ハンドオフプロンプト本文（以下をコピペ）

```
このセッションは、Daikiの「自走リライトシステム」の設計を継続するためのもの。
Claude Code 環境で動作している前提。

# 現在地
- Phase 2 設計フェーズ完了
  - Step A-1〜A-4: 最優先5手法（Information Gain / Query Fan-out / Original Research / 
                  First-hand Experience / SearchPilot A/B Testing）
  - 案E: リライト対象選定の新規設計（4軸独立キュー、案B で軸4 追加）
  - 案C: LLM実行レイヤー（Opus 4.7 + Sonnet 4.6 / 差分パッチ）
  - 案D: 統合確認（全20テーブル真=美原則合格）
  - 案B: 強推奨手法の確定（採用8件 + 不採用3件 + 既確定1件）

- 次の作業: Phase 3 詳細設計

# プロジェクト構造（s-tools/design/ 配下）

s-tools/design/
├── CLAUDE.md                              ← Claude Code 起動時自動読込
├── README.md                              ← この設計サブディレクトリの概要
├── knowledge/
│   ├── 01_cognitive_profile.md            ← Daiki 認知プロファイル（必読）
│   ├── 02_truth_beauty_framework.md       ← 真=美フレームワーク（必読）
│   ├── 03_interpersonal_modes.md          ← 対人モード
│   ├── 04_seo_domain.md                   ← SEOドメインコンテキスト
│   └── 05_rewrite_system_design.md        ← 設計確定事項（必読、全20テーブルSQL含む）
├── sessions/
│   ├── 2026-04-30_step_a1_to_a4.md
│   ├── 2026-04-30_case_e.md
│   ├── 2026-04-30_case_c.md
│   ├── 2026-04-30_case_d.md
│   └── 2026-04-30_case_b.md
├── research/
│   └── phase_1_research_report.md         ← 全設計の起点リサーチ
└── handoff/
    └── handoff_prompt_for_next_session.md ← このファイル

# 最初のタスク
1. CLAUDE.md / knowledge/05_rewrite_system_design.md / sessions/ 直近のものを読み込み、
   現状を把握する
2. 把握した内容を簡潔にサマリして提示する（特に案D + 案B の確定事項）
3. Phase 3 詳細設計の論点を提示する

# Phase 3 詳細設計の主要論点（先出し）

## 論点1: Daikiの真=美判定UI（差分パッチ承認画面）の詳細仕様
- 案L 差分単位判定の操作フロー
- 案K 発動時の方針承認フロー（高リスク 5カテゴリ）
- Before/After 比較表示
- 棄却カテゴリ選択（5カテゴリ）
- 編集承認時の編集UI
- 全差分適用後プレビュー機能
- 著者・監修者管理 UI（master_evidence の人間運用部分）

## 論点2: エラーハンドリング設計
- LLM API 失敗時のリトライ戦略（Adapter 層レベル）
- SerpApi 失敗時のフォールバック
- WordPress 反映失敗時のロールバック
- 月次バッチ未実行時の検知（applied_to_wp=1 AND ab_test_id IS NULL の経過日数監視）
- queue_session_link 「最低1件のリンク」アプリケーションレベル保証

## 論点3: Compliance Layer 詳細仕様
- 景品表示法ステマ規制の自動チェック（PR表記の存在検証）
- 貸金業法第15条/第16条の必須項目チェック（実質年率・限度額・返済方式・登録番号）
- ASPレギュレーション禁止表現リスト（A8.net / ValueCommerce / アクセストレード）
- master_regulation_event との接続
- LLM出力の事後検証フロー

## 論点4: サイト全体監査レイヤー設計
- 案E 旧軸4（構造的健全性）の移行先
- master_article_similarity の γ（entity_overlap）を使った Site Reputation Abuse 防衛
- topical 整合性スコアの計算
- 個別記事レベルとサイト全体レベルの責任境界

## 論点5: SearchPilot variant 割当ロジックの詳細
- Cloudflare Workers での variant injection 実装方針
- 1,000記事ずつ control / variant A / variant B 割付ロジック
- A/B 開始日・観測期間・統計検定タイミング
- Google Update 期間中の信頼度補正方式

# 進行順序
1. Phase 3: 詳細設計  ← 次に進む
2. Phase 4: 実装

# 設計原則（全案共通）
- 真=美フィルタの3軸（必然性・閉合性・最小性）を全判断に適用
- 遅延評価（lazy evaluation）型処理
- 抽象化レイヤー（API / LLM / Archive 全て差し替え可能）
- 3層学習ループ（記録 → 抽出 → 反映）
- 主指標 × Clarity gating の二段判定
- ポジトーク回避（Google一次情報ベース）
- 既存資産の最大流用（再発明禁止、ただし目的が一致する範囲のみ）
- 複雑性の局所化（複雑な要件は1箇所に集めて他を守る）

# 進行スタイル
- 設計判断ごとにステップを分解して、Daiki に判断を仰ぐ
- インプット・アウトプットを明確に定めてパーツごとに動くように設計する
- 出典の質を厳守（Google Search Central > 業界専門家複数支持 > 個別ベンダー単独支持）
- 真=美の最小性テストに反する設計は提示しない（過剰な機能追加を避ける）

# 文体
- 結論先行、構造的、端的
- 根拠のない励まし、美辞麗句、冗長な前置きは余剰として削る
- 構造を示すときは図・箇条書き・コードブロックを優先
- 反証プロトコル: 主張に対する逆方向検証を必ず付記

# 警戒すべきAI側のバイアス（蓄積版）

## 案E で判明
「既存資産への過剰適応バイアス」
  資産が高品質 → 流用したい → 流用できる前提で組み立てる
  正しくは「目的が一致するか?」を最初に問う必要がある

## 案D で判明
「自分の初期推奨に固着するバイアス」
  片側照射の傾向あり、初期推奨の構造的破綻を見落とすリスク
  Daiki の直感的懸念（「これでちゃんとリライトできるか」等）が
  片側照射を暴く重要なシグナルになる
  → 直感的懸念を「実装で確認する」と片付けず、構造的に再検証する

## 案B で判明
「強推奨ラベルへの追従バイアス」
  リサーチレポートで「強推奨」と評価されているからといって採用すべきとは限らない
  Phase 1 リサーチは情報源の質に幅があり、業界専門家支持と Google 一次情報支持を
  混同しないことが重要
  → 各手法を Google 一次情報の有無で再フィルタリング

「機能を盛りたくなるバイアス」
  設計が複雑になるほど「あれもこれも組み込みたい」という心理が働く
  真=美の最小性原則に反する
  → レベル0/レベル1の最小限版を必ず併記、Daikiが選択できる状態を保つ

「テーブル単位の最小性 vs システム全体の最小性 取り違えバイアス」
  単一テーブル単位で見ると過剰でも、他用途流用ができればシステム全体では最小性整合
  → 「他用途流用可能性」を必ず検討する（案B # 9 で発覚）

## Phase 3 で警戒すべき特有のバイアス
「UI仕様の過剰精緻化バイアス」
  詳細設計フェーズでは「全シナリオを網羅したい」誘惑が強くなる
  Phase 4 実装で実機検証してから精緻化すべきもの と
  詳細設計で確定すべきもの の区別が必要
  → MVP UI は最小限の操作フローで設計、機能追加は Phase 4 後の運用で判定

# 全体像（案D + 案B 完了時点）

## 全20テーブル
[Phase 1: 2] master_rewrite_target_score, master_rewrite_queue
[Phase 2: 12] master_post_target_query, master_query_fanout, master_competitor_corpus,
              master_fact_set, master_evidence, master_evidence_article_link,
              master_information_gain_score, master_rewrite_session, master_rewrite_diff,
              master_rewrite_queue_session_link, master_hcu_checklist (★案B),
              master_article_similarity (★案B)
[Phase 3: 6] master_regulation_event, master_partner_status_history,
             master_ab_test, master_ab_test_result, master_ab_test_pattern,
             master_clarity_signal

## 8工程の責務マッピング
工程1: 案E（軸1/2/3/4 独立キュー、案B # 1, # 12 で軸4 追加）
工程2-3: Step A-2（Query Fan-out 二段構造、案B # 3 で intent_dimension 拡張）
工程4-5: Step A-1（IG Score 駆動の差分生成）+ 案B # 5（HCU 22項目）
工程6: 人間（Daiki 真=美フィルタ）
工程6': 案C（Opus 4.7 分析 + Sonnet 4.6 生成 / 差分パッチ）+ 案B # 11（クエリレベル decay）
工程7: 実装（WordPress 反映）+ 案B # 9（Hub-and-spoke、master_article_similarity）
工程8: Step A-4（SearchPilot 方式 + 3層学習）

## MVP 3 Phase 戦略
Phase 1: 対象選定の自動化（実工数 9〜14日）
Phase 2: 自走システム本格稼働（実工数 16〜25日）
Phase 3: 学習ループ稼働、自走システム完成形（実工数 8.5〜13日）
合計: 33.5〜52日（カレンダー時間 3〜5ヶ月想定）

# 環境について

このセッションは Claude Code 環境で動作。
- ファイル直接読み込み可能（s-tools/design/ 配下）
- shell 実行可能
- リポジトリ全体把握可能
- Daiki が必要に応じて他ファイル（s-tools/node/ 既存実装等）を読ませることができる

# 最初のタスク（再掲）
1. CLAUDE.md と knowledge/05_rewrite_system_design.md を読み込み、現状を把握
2. 案D + 案B 完了時点の全体像をサマリ
3. Phase 3 詳細設計の論点1（Daikiの真=美判定UI）から開始
   推奨: 差分パッチ承認画面のワイヤーフレーム/データ構造から検討
   （案L 差分単位判定 + 案K 発動時の方針承認の操作フロー）

それでは Phase 3 詳細設計から進めてください。
```

---

## 補足: ハンドオフプロンプトの更新タイミング

このプロンプトは Phase を進めるごとに陳腐化する。以下のタイミングで Daiki が更新する:

- Phase 3 詳細設計が完了したら、「現在地」「進行順序」を更新
- Phase 4 実装着手時に、本ハンドオフを「実装フェーズ用」に書き直す
- 各セッション終了時に Claude が新しいハンドオフプロンプトを生成し、それで上書きする運用

---

## 補足: ナレッジファイルとセッション記録の役割の違い

| ファイル | 役割 | 更新頻度 |
|---|---|---|
| knowledge/05_rewrite_system_design.md | 設計確定事項の構造化保存 | Phase / 案 確定ごと |
| sessions/YYYY-MM-DD_*.md | 議論経緯の構造化保存 | セッションごと |
| handoff/handoff_prompt_for_next_session.md | 新規セッション継続用の起動プロンプト | Phase / 案 進行で変わるごと |
| CLAUDE.md | Claude Code 起動時の自動読込ファイル | Phase 進行で変わるごと |
| README.md | 設計ディレクトリの概要 | あまり変わらない |
| research/phase_1_research_report.md | 設計の起点リサーチ | 変わらない（Phase 1 完了済み） |

3者は補完関係:
- ナレッジファイルは「何が確定したか」の参照先
- セッション記録は「なぜその確定に至ったか」の参照先
- ハンドオフプロンプトは「次に何をするか」の起動装置
- CLAUDE.md は Claude Code 環境の入り口

---

## 補足: 案B 完了時点のシステム全体像

```
┌──────────────────────────────────────────┐
│ データ収集層（共有）                     │
│   monitor-collectors.js                  │
│   GA4 / GSC / WP REST API                │
└──────────────────┬───────────────────────┘
                   │
        ┌──────────┴──────────┐
        ↓                     ↓
┌─────────────────┐   ┌─────────────────────────────┐
│ monitor.db      │   │ rewrite.db (新規)           │
│ (既存)          │   │                             │
│                 │←──│ Read-Only参照               │
│ ・記事マスター  │   │ (ATTACH DATABASE)           │
│ ・日次指標      │   │                             │
│ ・KW履歴        │   │ [Phase 1: 2 テーブル]       │
│ ・要因分析      │   │ [Phase 2: 12 テーブル ★+2] │
│                 │   │ [Phase 3: 6 テーブル]       │
└────────┬────────┘   └────────┬────────────────────┘
         │                     │
         ↓                     ↓
┌─────────────────┐   ┌──────────────────────────┐
│ 既存システム    │   │ リライトシステム         │
│                 │   │                          │
│ ・CTA挿入       │   │ ・対象選定 案E (4軸)      │
│ ・順位観測      │   │ ・Query Fan-out + JTBD   │
│ ・要因分析 案C  │   │ ・IG Score + HCU 22      │
│   shared/ で    │   │ ・Article Similarity     │
│   共通化        │   │ ・案C LLM実行            │
│                 │   │ ・差分パッチ + Compliance│
│                 │   │ ・A/Bテスト学習           │
└─────────────────┘   └──────────────────────────┘
        既存                  新規
        独立で稼働、データ層・shared/ ヘルパーのみ共有

shared/ ディレクトリ構造:
  - article-context.js (共通コンテキスト集約)
  - wp-structured.js (82%削減実測)
  - llm-adapters/ (Anthropic + OpenAI + Gemini)
  - archive-adapters/ (Wayback + archive.today、案D 3.H)
  - schemas/intent_dimension.schema.json (案B # 3)
```
