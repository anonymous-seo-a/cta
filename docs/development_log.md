# 開発ログ

## 2026-03-25: Session 2

### 完了
- Google Custom Search API 403問題の調査（請求先リンク反映待ち→方針変更）
- Yahoo検索スクレイプ実装（時間分散、15-30秒ランダム待機、User-Agentローテーション）
- gsc_master.gs新設（GSCデータ一元管理、日次バッチ）
- seo_rewrite.gs v5（Bot対策サイト除外、競合フォールバック、1記事/実行制限）
- Phase 1（競合URL取得）動作確認済み
- Phase 2（競合分析+リライト案生成）動作確認済み

### 解決した問題
- GSC API page×query全組み合わせ取得でタイムアウト → gsc_masterシート参照に変更
- bitflyer.comスクレイプでハング（6分間レスポンスなし）→ SKIP_DOMAINSで事前除外
- readGscMasterをループ内で毎回呼び出し → ループ外で1回だけ
- writeRewriteResultSheetが毎回シート作り直し → 追記モードに変更

### 次のタスク
- **Phase 2.5**: Gutenbergマークアップ生成 → Spreadsheet出力
  - Claude APIに現在の記事HTML + リライト分析結果 + デザインパターンを渡す
  - 比較表・ボックスデザイン・CTAブロック含む完成形マークアップを生成
- **Phase 3**: 承認済みマークアップの自動入稿（WordPress REST API）

### デザインパターン（記事内で使用）
- box-004: 注意ボックス
- box-006: 補足ボックス
- box-008: ポイントボックス
- H2装飾（ミニ目次）、記事要約ボックス、Q&Aアコーディオン、ステップ表示
- 比較表（インラインスタイルtable）
- CTAプラグインブロック（3カテゴリ×5ブロック）

## 2026-03-24: Session 1
- 初回実装: CVR診断、CTA挿入、SEOリライト基盤
- 詳細は /mnt/transcripts/2026-03-24-09-52-16-soico-cvr-seo-automation-system.txt
