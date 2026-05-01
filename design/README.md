# s-tools/design/

このディレクトリは、Daiki の **自走リライトシステム** の設計資産を保管する。

最終更新: 2026年4月30日

---

## 目的

消費者金融アフィリエイト（soico.jp/no1/）向け YMYL 自走リライトシステムの設計を、Phase ごとに構造化して保存する。

設計プロセスで生成された：
- 確定事項のサマリ（knowledge/）
- 議論経緯の記録（sessions/）
- 起点となったリサーチ（research/）
- 次セッション継続用の起動プロンプト（handoff/）

を統合管理する。

---

## ディレクトリ構成

```
s-tools/design/
├── CLAUDE.md                              ← Claude Code 起動時の自動読込ファイル
├── README.md                              ← このファイル
├── knowledge/                             ← 構造化された確定事項
│   ├── 01_cognitive_profile.md            ← Daiki 認知プロファイル
│   ├── 02_truth_beauty_framework.md       ← 真=美フレームワーク
│   ├── 03_interpersonal_modes.md          ← 対人モード
│   ├── 04_seo_domain.md                   ← SEOドメインコンテキスト
│   └── 05_rewrite_system_design.md        ← 設計確定事項（最重要、全20テーブルSQL含む）
├── sessions/                              ← 議論経緯の保存
│   ├── 2026-04-30_step_a1_to_a4.md        ← 最優先5手法の確定
│   ├── 2026-04-30_case_e.md               ← リライト対象選定の新規設計
│   ├── 2026-04-30_case_c.md               ← LLM実行レイヤー
│   ├── 2026-04-30_case_d.md               ← 統合確認
│   └── 2026-04-30_case_b.md               ← 強推奨手法の確定
├── research/
│   └── phase_1_research_report.md         ← 全設計の起点リサーチ
└── handoff/
    └── handoff_prompt_for_next_session.md ← 次セッション用起動プロンプト
```

---

## ファイルの役割

| ファイル | 役割 | 更新頻度 |
|---|---|---|
| **CLAUDE.md** | Claude Code 起動時の自動読込ファイル。設計原則、ディレクトリ構成、進行スタイル、警戒バイアスを含む。 | Phase 進行で変わるごと |
| **README.md** | この設計サブディレクトリの概要。 | あまり変わらない |
| **knowledge/01_cognitive_profile.md** | Daiki の WAIS-IV 推定プロファイルと認知特性。 | 滅多に変わらない |
| **knowledge/02_truth_beauty_framework.md** | 真=美フレームワーク（必然性・閉合性・最小性）。 | 滅多に変わらない |
| **knowledge/03_interpersonal_modes.md** | 対人モード（閉じたモード / 覚醒モード / 本体起動モード）。 | 滅多に変わらない |
| **knowledge/04_seo_domain.md** | SEO 記事制作のドメインコンテキスト。 | 必要に応じて更新 |
| **knowledge/05_rewrite_system_design.md** | リライトAIシステムの設計確定事項（全20テーブル SQL、4軸構成、8工程責務マッピング、3 Phase 戦略含む）。 | Phase / 案 確定ごと |
| **sessions/YYYY-MM-DD_*.md** | 各設計セッションの議論経緯。「なぜその確定に至ったか」を保存。 | セッションごと |
| **research/phase_1_research_report.md** | 全設計の起点となった Phase 1 リサーチレポート。Step A 〜 案B の手法選定根拠。 | 変わらない（Phase 1 完了済み） |
| **handoff/handoff_prompt_for_next_session.md** | 次セッション用の起動プロンプト。最新の進行状況を含む。 | Phase / 案 進行で変わるごと |

---

## 3者の補完関係

```
ナレッジファイル（knowledge/）   → 「何が確定したか」の参照先
セッション記録（sessions/）       → 「なぜその確定に至ったか」の参照先
ハンドオフプロンプト（handoff/）  → 「次に何をするか」の起動装置
CLAUDE.md                         → Claude Code 環境の入り口
```

---

## 設計フェーズの進捗

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

詳細は `knowledge/05_rewrite_system_design.md` を参照。

---

## 新規セッション開始時の手順

1. Claude Code を `s-tools/design/` ディレクトリで起動
2. CLAUDE.md が自動読込される
3. `handoff/handoff_prompt_for_next_session.md` の本文ブロックを最初のメッセージとしてコピペで送る
4. Claude が現状把握 → サマリ提示 → 次論点提示
5. Daiki が判断、設計を進める

---

## セッション終了時の更新運用

各セッション終了時に、Claude が以下を生成:

1. `knowledge/05_rewrite_system_design.md` の更新版（変更があれば）
2. `sessions/YYYY-MM-DD_<セッション名>.md`（議論経緯）
3. `handoff/handoff_prompt_for_next_session.md` の更新版（次セッション用）

Daiki が:
- 既存ファイルを上書き
- 新規セッション記録を追加
- Git にコミット

---

## 関連リポジトリ

s-tools リポジトリ全体: anonymous-seo-a/s-tools

```
s-tools/
├── design/                    ← このディレクトリ
├── node/                      ← バックエンド実装
│   ├── shared/                ← 共通ヘルパー（案C 5-c で確立）
│   ├── monitor/               ← 既存システム
│   └── rewrite/               ← リライトシステム本体（案C 5-c-2 で確立、Phase 4 で実装）
└── data/
    ├── monitor.db             ← 既存
    └── rewrite.db             ← 新規（案E で確立、Phase 1 で実装開始）
```

---

## ライセンス

社内利用 / 個人利用前提。外部公開は想定していない。
