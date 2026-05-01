# 日本語YMYL（消費者金融・カードローンアフィリエイト）リライトAIシステム設計のためのリサーチレポート

このファイルは、本リライトAIシステム設計プロジェクトの起点となった Phase 1 リサーチレポートを保存する。

このレポートが Step A-1〜A-4（最優先5手法の確定）と 案B（強推奨手法の確定）の根拠となる。

---

**対象期間**：Helpful Content Update（2022年9月）以降〜2026年4月時点  
**主軸**：Google一次情報（Search Central、Search Quality Rater Guidelines、blog.google、searchliaison）＋海外信頼ソース（Search Engine Land、Search Engine Roundtable／Barry Schwartz、Glenn Gabe、Aleyda Solis、SearchPilot）  
**目的**：日本未採用×海外採用×Google一次情報で支持できる手法を、リライト工程別に抽出

---

## TL;DR（核心3点）

- **「日本未採用×海外採用×Google一次情報支持」の最有力手法は、(1) Information Gain（独自付加情報）駆動の差分生成、(2) Query Fan-out（AI Mode/AI Overviewが内部実行する派生クエリ）への構造的網羅、(3) SEO A/Bテスト（SearchPilot方式の統制実験）の3点**。日本のSEOコンサル界では「文字数・キーワード密度・体験談増量」といった非実証ヒューリスティックが主流だが、海外ではGoogle特許（US 2024/0289407A1、US12158907B1、Contextual Estimation of Link Information Gain）と公式blog（developers.google.com/search/blog/2025/05/succeeding-in-ai-search）に紐づく**仕組み駆動の手法**が標準になっている。

- **2024年3月以降のSpam Policies三本柱（Site Reputation Abuse／Scaled Content Abuse／Expired Domain Abuse）は、消費者金融アフィリ領域に直接適用される**。特にScaled Content Abuse（developers.google.com/search/blog/2024/03/core-update-spam-policies）は「AIか人間かを問わず、ランキング操作目的で大量生成された価値のないコンテンツ」を一律対象とする方法論非依存（method-agnostic）の定義で、LLMリライトを実行レイヤーに置く本件アーキテクチャでは、master data tableで一次情報源・監修者・独自データを必ず参照させ、LLMを「単独生成器」にしない設計が必須。

- **日本側の前提として、(a) 景品表示法ステマ規制（消費者庁告示、2023年10月1日施行）、(b) 貸金業法第15条／第16条と日本貸金業協会「貸金業者の広告に関する細則」（2024年5月17日／2025年4月2日改訂）に基づく実質年率・限度額・返済方式の表示義務と「無審査」「ブラックOK」等の禁止表現、(c) 各ASP（A8.net、afb、ValueCommerce）レギュレーション、を**チェックリストとしてmaster data tableに格納**し、LLM出力の事後検証で必ず通すことが、海外手法導入の前提条件となる。

---

## Key Findings（環境確認サマリー）

### 1. Search Quality Rater Guidelines（QRG）の改訂履歴と現在地

- 2022年12月：E-A-T → **E-E-A-T**（Experienceの追加）。Google公式blog `developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t` で「first-hand, life experience on the topic at hand」が定義された。
- 2023年11月／2024年3月／2025年1月／**2025年9月11日**改訂。最新版（181→182ページ、`guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf`）の主な変更：
  - **YMYL Society → 「YMYL Government, Civics & Society」**へ拡張（選挙・公的機関・社会的信頼に関する情報を明示的に追加）。
  - **AI Overviewの評価例**をFeatured Snippet・Knowledge Panelと並列で追加。
  - 2025年1月版で**Scaled Content Abuse（4.6.5）／Site Reputation Abuse（4.6.4）／Expired Domain Abuse（4.6.3）**がraterの判定対象として明文化。AI生成かどうかを直接の悪指標とはしないが、「人間レビュー無し・独自性無し・付加価値無しの大量生成」は**Lowest**判定対象（Search Engine Land「Google quality raters now assess whether content is AI-generated」454161 で確認）。
- **YMYL消費者金融**は「Money/Financial Stability」カテゴリーで**最高水準のE-E-A-T**が要求される領域に該当（ガイドライン2.3節）。

### 2. 2024〜2025年のCore/Spam Update

- **March 2024 Core Update + Spam Update**（公式 `developers.google.com/search/blog/2024/03/core-update-spam-policies`）。Helpful Content Systemをコアアルゴリズムに統合し、3つの新スパムポリシー（Site Reputation Abuse／Scaled Content Abuse／Expired Domain Abuse）を導入。Google自身が「unoriginal contentを45%削減」と公表。
- **May 5, 2024**：Site Reputation Abuse の手動措置（manual action）開始。**November 19, 2024**：「first-party involvement（編集関与）があっても第三者ホスティング目的なら違反」として再定義（developers.google.com/search/blog/2024/11/site-reputation-abuse）。Forbes Advisor、CNN Underscored、Time Stamped、APNews Buyline等の大手メディアの**金融アフィリ系サブディレクトリが軒並みdeindex**されたことがGlenn Gabe（gsqi.com）、Lily Ray、Barry Schwartz により報告（中程度の出典で交差確認済）。
- August 2024 / November 2024 / December 2024 / March 2025 / June 2025 Core Updates。**August 2024 Core Update**ではReddit等のコミュニティUGCの可視性が顕著に上昇（Stan Ventures分析、Search Engine Roundtable他で確認）。
- **Site Reputation Abuse のアルゴリズム化はDanny Sullivan が「まだ未公開」と複数回明言**（Aleyda Solis・Barry Schwartzインタビュー）。現時点（2026年4月）では**手動措置のみ**で運用されている点に留意。

### 3. AI Overview / AI Mode の公式ガイダンス

- 公式：`developers.google.com/search/docs/appearance/ai-features` および `developers.google.com/search/blog/2025/05/succeeding-in-ai-search`。
- Google自身が**「query fan-out」**という用語で、「AI Modeはユーザークエリをsubtopicsに分解し、複数の関連検索を並列実行してレスポンスを生成する」と明文化。
- 「**no additional technical requirements**」「**no separate AI index**」と明記。AI Overviewに表示されるためには伝統的SEOの基礎（クロール可能性・インデックス可能性・スニペット表示可能性）が前提。
- 関連特許：US 2024/0289407A1「Search with Stateful Chat」（2024年8月29日公開）、US 12158907B1「Thematic Search」（2024年12月）、US 11663201B2「Generating Query Variants Using A Trained Generative Model」（2018年出願／2023年付与）。

### 4. Information Gain 特許

- 「Contextual Estimation of Link Information Gain」（2018年出願、**2022年6月／2024年6月に再付与・関連特許追加**）。Search Engine Land／Search Engine Journal／InLinks／Clearscope／MarketMuseで広く議論。
- 内容要旨：「ユーザーが既に閲覧した文書群に**含まれていない追加情報**を文書が提供する度合いを機械学習モデルでスコアリングし、二次的検索結果のランキングに用いうる」。
- Googleは**特許＝実装の確証ではない**ため、業界では「Helpful Content Update／Core Updateの精神に整合する仮説」として扱うのが正確（Search Engine Land 429763で明示）。

### 5. Schema・Core Web Vitals の最新動向

- **HowTo rich result：2023年9月13日に完全廃止（deprecated）**（developers.google.com/search/blog/2023/08/howto-faq-changes）。
- **FAQ rich result：2023年8月から「well-known, authoritative government and health websites」のみに限定**。一般サイトでは表示されなくなった（SearchPilotのA/Bテストで「FAQ schema削除はトラフィックに統計的有意な影響なし」と確認）。
- **INPがCore Web Vitalsに昇格、FIDは廃止**（2024年3月12日、`web.dev/blog/inp-cwv-march-12`、`developers.google.com/search/blog/2023/05/introducing-inp`）。Good=200ms以下（75パーセンタイル）。
- 構造化データ（Article、Product、Review、Organization、Person、Breadcrumb）は引き続き有効。

### 6. AI生成コンテンツに関する公式スタンス

- `developers.google.com/search/docs/fundamentals/using-gen-ai-content`（2023年2月公開・以後更新）：「**自動化（AI含む）の使用そのものはspamではない**。プライマリ目的がランキング操作である場合のみspam」「**E-E-A-T観点で評価**」「**Who/How/Why** で説明することを推奨」。
- 2025年1月QRG改訂で「`As an AI language model`等のAI由来文言が残るページ」「人間レビュー無しのAI出力大量公開」は**Lowest**判定対象として明示化。

---

## Details：工程別深掘り

各工程について、(a) 日本標準、(b) **日本未採用×海外採用×Google支持（最優先）**、(c) 日本で見落とされやすいGoogle支持手法 を抽出する。

### 工程1：リライト対象選定

#### 1-a. 日本標準
- ランキング下落キーワードの目視抽出、「順位×検索ボリューム」の二次元マトリクス、ahrefs/Semrushのトップページ機能。

#### 1-b. **【最優先】Content decay検出 ＋ 統制された pruning（海外標準・日本低採用）**
- **概要（260字）**：Search Console APIで全URL×全クエリのインプレッション／クリック／平均順位を時系列保存し、**28日窓・90日窓のtraffic差分**で「衰退ページ」を検出。Aleyda Solis (`learningseo.io/seo_roadmap/deepen-knowledge/`) が体系化した content pruning フレームワーク、Search Engine Land（searchengineland.com/guide/content-decay）、Clearscope の手法。海外ではジェス・ショルツ（Jes Scholz）の事例（不動産サイトで60%のページを削除した結果、残存ページのクリックが大幅増）が交差引用で著名。
- 出典の質：**中**（Search Engine Land + Aleyda Solis + Clearscope による交差確認）。Google一次情報の直接支持は無いが、HCU の "Are you producing lots of content on many different topics in hopes that some of it might perform well" という減点要素（developers.google.com/search/docs/fundamentals/creating-helpful-content）と整合。
- 日本での採用度：**低**（一部大手のみ）／海外採用度：**高**（米英豪の独立系メディア標準）。
- 機械化可能性：**高**（Search Console API ＋ better-sqlite3 で時系列保存、閾値判定で自動flagging）。
- 既存ツール代替：Search Console + Looker Studio、Ahrefs Top Pages、Semrush Position Tracking、ContentKing。
- 採用推奨度：**強推奨**（master data tableに `content_health_status` カラムを設け、quarterly cadenceで自動算定）。

#### 1-c. **Cannibalization検出（SERP重複ベース）**
- **概要（240字）**：複数自社URLが同一クエリで上位30位以内に表示される状態を Search Console API で検出。海外（RankDots、Aleyda Solis）では「同一クエリで複数URLが上位表示」を即cannibalization判定とせず、**SERPでのURL重複率（intent overlap）**で2URL統合の妥当性を判断する。
- 出典の質：中（Aleyda Solis + Search Engine Land で交差確認）。
- 日本：**中採用**／海外：**高採用**。
- 機械化可能性：高。採用推奨度：**強推奨**。

### 工程2：競合構造分析（SERP分析）

#### 2-a. 日本標準
- 上位10サイトの目次・見出しコピペ、共起語ツール、文字数平均算出。

#### 2-b. **【最優先】Query Fan-out 構造シミュレーション（海外で急速に標準化、日本ほぼ未採用）**
- **概要（350字）**：Google AI Mode／AI Overview が内部で行う「1クエリ→複数のsubtopic派生クエリ」を、ターゲットクエリに対して事前にシミュレートし、それら派生クエリすべてを1ページ内で extractable な形で網羅する手法。Google公式 `developers.google.com/search/docs/appearance/ai-features` で fan-out 技術を公認。Search Engine Land の解説（searchengineland.com/guide/query-fan-out）、iPullRank（Mike King）、WordLift、Search Engine Journal が特許 US 12158907B1（Thematic Search）と US 2024/0289407A1（Search with Stateful Chat）を分析。
- 出典の質：**強**（Google公式 + Google特許 + 複数信頼ソースで交差確認）。
- 引用（原文）：「AI Overviews and AI Mode may use a 'query fan-out' technique — issuing multiple related searches across subtopics and data sources — to develop a response.」（developers.google.com/search/docs/appearance/ai-features）／日本語訳：「AI Overviews と AI Mode はクエリ・ファンアウト技術 — サブトピックとデータソース全体に複数の関連検索を発行する技術 — を用いて応答を生成する場合がある」。
- 日本：**未採用〜極低**／海外：**高**（米欧、特に英語SEO先進企業）。
- 機械化可能性：**高**（LLMにseed query→subtopic分解を実行させ、各subtopicに対して上位10URL／PAA／関連検索を取得し、結果をmaster data tableにマッピング）。
- 既存ツール代替：iPullRank の Query Fan-out simulator、QueryBurst、WordLift Colab tool。
- 採用推奨度：**強推奨**（消費者金融では「即日融資 比較」→「審査時間／在籍確認なし／無利息期間／申込必要書類／50万借入の月返済額」等のサブトピック群を網羅）。

#### 2-c. **Entity-based Gap分析（Google Knowledge Graphとの照合）**
- **概要（240字）**：Aleyda Solis のフレームワーク（`speakerdeck.com/aleyda/seo-for-brand-visibility-and-recognition`）。Google Knowledge Graph Search APIで自社・競合・関連エンティティのsalience scoreを取得し、コンテンツに含めるべきエンティティ群（消費者金融なら「金融庁」「貸金業法」「総量規制」「指定信用情報機関」「JICC」「CIC」等）を構造化。
- 出典の質：中（Aleyda Solis単独支持。ただしGoogle Knowledge Graph Search APIは公式提供）。
- 日本：**低**／海外：**高**。
- 採用推奨度：**推奨**（Topical authorityの基盤）。

#### 2-c-2. **SERP intent shift 検出**
- **概要（180字）**：6か月窓でSERPの上位10URLの「タイプ構成」（ガイド／比較／公式／ニュース／UGC）の比率変化を追跡。比率反転を「intent shift」としてリライトトリガーにする。Search Engine Land（`searchengineland.com/audit-brand-serp-presence-459080`）で支持。
- 出典の質：中。
- 日本：**低**／海外：**中〜高**。採用推奨度：**推奨**。

### 工程3：検索意図分解

#### 3-a. 日本標準
- informational/navigational/transactional/commercial の4分類目視。

#### 3-b. **【最優先】Micro-intent × Job-to-be-done 分解（海外標準・日本部分採用）**
- **概要（300字）**：単一クエリを `(主目的, 障壁, 制約条件, 比較軸, 期待形式)` の5次元に分解し、消費者金融なら「お金を借りたい」を `(目的：医療費／引越／生活費, 障壁：審査落ち履歴／在籍確認NG, 制約：今日中／50万円以下, 比較軸：金利／融資速度／返済負担, 期待形式：比較表／実体験／Q&A)` のように展開。RankDots等で支持されているが、本質はGoogle公式の「satisfies search needs」（developers.google.com/search/docs/fundamentals/creating-helpful-content）と整合。
- 出典の質：中。
- 日本：**低〜中**（一部のみ）／海外：**高**。
- 機械化可能性：**高**（master data tableに `intent_dimension` をスキーマ化し、LLMで分解→人間レビュー）。
- 採用推奨度：**強推奨**。

#### 3-c. **Reverse engineering SERPによる意図推定**
- **概要（160字）**：上位10URLの実コンテンツ構造（H2/H3、含まれるエンティティ、主張のタイプ）を機械的に抽出し、共通要素を「Google が判定した支配的intent」として扱う。
- 出典の質：中。日本：中／海外：高。採用推奨度：推奨。

### 工程4：ギャップ抽出

#### 4-a. 日本標準
- 共起語不足チェック、見出し不足チェック。

#### 4-b. **【最優先】Information Gap分析（特許駆動、日本未採用）**
- **概要（350字）**：Information Gain特許（Contextual Estimation of Link Information Gain、2022/2024付与）に基づき、上位N URLの「事実集合」をエンティティ抽出し、自社記事の事実集合との**差集合**（既存記事に無く、ユーザーがまだ見ていない情報）を可視化。Search Engine Land（`searchengineland.com/what-is-information-gain-seo-why-it-matters-429763`、Sara Taher、Bill Slawski分析を継承）、Clearscope、MarketMuseで具体的方法論が公開されている。Googleは「特許の実装を確認していない」という立場（同記事）だが、Helpful Content System の "Does the content provide insightful analysis or interesting information that is beyond the obvious?" と直接整合。
- 出典の質：**強**（Google特許＋公式HCU質問項目＋複数業界専門家の交差確認）。
- 日本：**未採用**（「skyscraper技法・上位ページの再構成」が主流）／海外：**高**（特に米国・英国の独立メディア）。
- 機械化可能性：**中〜高**（LLMで事実集合抽出→集合演算→新規情報候補生成→人間検証）。
- 既存ツール代替：Frase、NeuronWriter、MarketMuse、Clearscope（部分的に対応）。
- 採用推奨度：**強推奨**（消費者金融：金利推移の独自データ／申込→借入までの実時間計測／実際のフォーム入力スクリーンショット等）。

#### 4-c. **Question gap分析（PAA + Reddit/Quora + サジェスト）**
- **概要（180字）**：People Also Ask（PAA）、Reddit、Quora、Yahoo知恵袋から、上位記事が答えていない質問を抽出。**August 2024 Core UpdateでReddit可視性が大幅上昇**したことから、海外ではReddit threads を意図抽出ソースとして必須化。
- 出典の質：中（複数業界ソースで交差確認）。
- 日本：低（Yahoo知恵袋・教えてgooの活用は一部あり）／海外：高。採用推奨度：**強推奨**。

### 工程5：差分生成（リライト本体ロジック）

#### 5-a. 日本標準
- 文字数増量、共起語追加、見出し再編成。**多くは「特定文字数神話」「キーワード密度神話」に依拠**しており、Google一次情報での支持は無い。

#### 5-b. **【最優先】Original research / 独自データ生成（海外で必須化、日本はYMYL以外で低採用）**
- **概要（350字）**：自社で原データ（アンケート、申込実測、利用者ヒアリング、フォーム所要時間計測、各社の融資完了までの実測時間）を生成し、必ず1記事に1つ以上の「他では入手不能な数値・図表」を組み込む。Google公式（developers.google.com/search/docs/fundamentals/creating-helpful-content）の質問 "Does the content provide original information, reporting, research, or analysis?" に直接対応。Animalz、SearchPilot、Aleyda Solis等が消費者金融類似のYMYL領域で実例多数。
- 出典の質：**強**（Google公式HCU質問項目）。
- 引用：「Does the content provide original information, reporting, research, or analysis?」「If the content draws on other sources, does it avoid simply copying or rewriting those sources, and instead provide substantial additional value and originality?」
- 日本：**中**（YMYLでは監修者依存・体験談依存が主流で、独自データ生成は弱い）／海外：**高**。
- 機械化可能性：**中**（データ収集自体は機械化可、LLM単独での「捏造」は厳禁）。
- 採用推奨度：**強推奨**。master data tableに `original_evidence_type`／`original_evidence_url` を必須カラムとして設計推奨。

#### 5-b-2. **First-hand experience markers（一次体験の証拠提示）**
- **概要（260字）**：実際に申込を行った日付、本人確認書類のマスキング画像、振込完了画面、コールセンター対応のスクリーンショット等を提示。QRG 2.5.2「Experience」評価で高評価対象（`guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf`）。E-E-A-Tの "Experience" は2022年12月追加（developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t）。
- 出典の質：**強**。
- 日本：低（YMYL消費者金融では実体験記事は薄く、監修者表記に偏重）／海外：高。
- 採用推奨度：**強推奨**（ステマ規制下では「PR」「広告」表記との両立が必須）。

#### 5-c. **Topical depth scoring（HCU質問チェックリスト準拠）**
- **概要（200字）**：HCUの公式質問項目（developers.google.com/search/docs/fundamentals/creating-helpful-content）22項目を二値判定するチェックリストをmaster data tableに格納し、リライト前後で全項目をスコアリング。
- 出典の質：**強**（Google公式直接）。
- 日本：低／海外：中。採用推奨度：**強推奨**。

### 工程6：原稿生成（LLM実行レイヤー）

※ 元仕様書には工程6の明示が無いが、システム設計上重要なため追記。

- **Master data table 駆動の Constrained Generation**：LLMに「自由生成」させず、`fact_db`（実質年率・限度額・融資時間・カードの種類等の構造化データ）と `evidence_db`（一次資料URL、監修者情報）を必ずプロンプト内で参照させる。Google一次情報の `using-gen-ai-content` ガイダンスと整合。
- **Hallucination抑止**：「事実主張1つにつき必ず evidence_db からURL／資料を引用」をシステムプロンプトの不変制約とする。

### 工程7：実装（Schema・Technical・Internal Linking）

#### 7-a. 日本標準
- FAQ schema乱用（**現在無効化済**）、HowTo schema（**現在無効化済**）。

#### 7-b. **【最優先】Article + Product + Review + Person + Organization の階層的schema設計（海外標準、日本では断片的）**
- **概要（300字）**：Article schema に `author`（PersonエンティティでsameAs にLinkedIn/J-FSA等の外部URL）、Organization schema（jurisdiction、貸金業登録番号は textProperty で）、Product schema（消費者金融商品ごとに interestRate、loanTerm、annualPercentageRate）、Review schema（自社の実体験レビュー）を相互リンクさせる。Schema App、Aleyda Solis、developers.google.com/search/docs（各schema docs）で詳細手順が公開されている。
- 出典の質：**強**（Google公式schema docs）。
- 日本：**低**（FAQ・HowTo偏重、Article+Person+Organizationの相互リンクは少ない）／海外：**高**。
- 機械化可能性：**高**（master data tableから JSON-LD を自動生成）。
- 採用推奨度：**強推奨**。

#### 7-b-2. **FAQ／HowTo schema は新規実装しない（手法の引き算）**
- 概要：2023年9月以降、HowTo は完全廃止、FAQ は政府・医療系のみ。SearchPilot のA/Bテストで「削除しても影響なし」が確認済み。**残存FAQ schemaの強制削除も不要**（既存ページではコスト>便益で多くの場合放置が合理）。日本のSEO業界では未だにFAQ schemaを「SEO効果あり」と推奨する記事が多いが、これは旧情報。
- 出典の質：**強**（Google公式 + SearchPilot 統制実験）。

#### 7-c. **Internal linking の contextual relevance（Hub-and-spoke）**
- **概要（240字）**：消費者金融トップ（Hub）→ 各社レビュー（Spoke）→ 関連法律解説（Spoke）→ 借入シミュレーション（Spoke）の topical cluster を構築し、anchor text に descriptive keyword を埋め込む。Aleyda Solis、WordStream、Bruce Clay 等で詳細手順。
- 出典の質：中（業界広範な交差確認）。日本：**部分採用**／海外：**高**。
- 採用推奨度：**強推奨**。

#### 7-c-2. **Core Web Vitals（INP最適化）**
- **概要（180字）**：INPがCWVに昇格（2024年3月12日）。LCP/CLSは継続。INP good=200ms以下（75パーセンタイル）。React/Vite構成では JavaScript 実行の main thread blocking が主因なので、heavy event handlerの遅延化、third-party tag governanceが必須。
- 出典の質：**強**（web.dev、developers.google.com/search 公式）。
- 日本：中採用／海外：高。採用推奨度：**強推奨**。

### 工程8：効果測定・学習ループ

#### 8-a. 日本標準
- 月次の順位レポート、「dwell time」「bounce rate」を改善KPIとする。**Google公式は dwell time/bounce rate を直接ランキング要因と否定**（John Mueller複数発言、Gary Illyes 2015年Tweet、Search Engine Journal "Is Bounce Rate A Google Ranking Factor?" で集約）。日本のSEO業界ではこの誤解が根強い。

#### 8-b. **【最優先】SEO A/B Testing（SearchPilot方式：統制実験／日本ほぼ未採用）**
- **概要（360字）**：URL群を control（変更なし） / variant（変更あり）にランダム割付し、CDN/edge layer で variant にだけタイトル・メタ・スキーマ・H2 等を変更、Search Console データを timeseries forecast と比較して統計的有意な差分を検出する手法。SearchPilot（searchpilot.com）が体系化。**SearchPilotの実証データで「FAQ schema追加：67%のテストでpositive、4-15%のtraffic uplift」「all-caps title tag は10%超のuplift」「動的価格を title tag に含めると10%増、静的価格を含めると7%減」等、日本では非実証で語られている命題の多くが部分否定または条件付き支持されている**。
- 出典の質：中（SearchPilot単独だがケース数が極めて多く、Search Engine Land/Wix SEO Hub 等で交差紹介）。
- 日本：**未採用**（「全ページ一律変更→翌月順位確認」が主流）／海外：**高**（米英の中〜大規模メディアで標準）。
- 機械化可能性：**高**（Node.js + Express でCDN edge logic を書ける）。Cloudflare Workers でほぼ同等の実装が可能。
- 採用推奨度：**強推奨**（消費者金融は variant 数十URLでも統計的に有意差を検出可能）。本件アーキテクチャ（Node.js+Express+SQLite）と相性が極めて良い。

#### 8-c. **Search Console API による粒度の高い decay 検出**
- **概要（200字）**：URL × クエリ × 日次の生データを better-sqlite3 に保存し、(a) 28日窓 vs 直前28日窓のCTR変化、(b) 平均順位の z-score 変化、(c) インプレッション減少率、を多変量で監視。decay発生時のクエリの**SERP intent shift**を併記して原因分類する。
- 出典の質：中（Search Engine Land、Aleyda Solis）。
- 日本：低／海外：高。採用推奨度：**強推奨**。

---

## Phase 3：日本YMYL消費者金融特殊事情（必須前提）

### 3-1. 景品表示法ステマ規制（2023年10月1日施行）

- 根拠：消費者庁告示「一般消費者が事業者の表示であることを判別することが困難である表示」（令和5年3月28日内閣府告示第19号）、`www.caa.go.jp/policies/policy/representation/fair_labeling/stealth_marketing`。
- 規制対象：**事業者（広告主）**。アフィリエイターは規制対象外だが、ASP・広告主は管理責任を負う。
- 運用基準：消費者庁「景品表示法とステルスマーケティング 〜事例で分かるステルスマーケティング告示ガイドブック」（2023年6月）。
- アフィリエイト広告の解釈：「事業者がアフィリエイトプログラムを用いた表示を行う際に、アフィリエイターに委託して表示させる場合は、事業者の表示となる」（消費者庁検討会回答）。**つまり原則ステマ規制の対象**。
- 必須対応：**「広告」「PR」「アフィリエイト」「プロモーション」表示**を、ページ閲覧前にユーザーが認識できる位置・大きさ・色で配置（消費者庁ガイドライン）。
- 措置事例：医療法人社団祐真会の Google マップ口コミインセンティブ事例（措置命令）。

### 3-2. 貸金業法・日本貸金業協会レギュレーション

- **貸金業法第15条**（貸付条件の広告等）+ 施行規則第12条 第1項・第3項：以下の事項を**明瞭かつ正確に全て表示**しなければならない：
  1. 貸金業者の商号・名称・登録番号
  2. 貸付けの利率（**実質年率を百分率で小数点以下1位以上、上限率を表示**）
  3. 返済の方式
  4. 返済期間・返済回数
  5. 賠償額の予定（違約金等）
  6. 担保に関する事項
- **インターネット広告の特例**：バナー等から自社サイトに誘導する場合、「**一体性を確保するための措置**を講じ、誘導先で全条件が記載されている限りにおいて、誘導元の広告で一部のみ表示可」（日本貸金業協会「貸金業者の広告に関する細則」、2024年5月17日／**2025年4月2日改訂版**、`www.j-fsa.or.jp/doc/association/regulation/exam_std_review_250402.pdf`）。
- **アフィリエイトサイトへの適用**：アフィリエイターが制作したサイトにバナー（黄色）が表示されている場合、貸金業法第16条第1項・第2項抵触の誇大表現があれば**貸金業者が責任を負う**（細則の明示）。
- 禁止表現：「無審査」「無条件」「ブラックOK」「破産歴OK」「必ず貸します」「多重債務一本化」、安易な借入を強調する表現、過度な借入意欲喚起表現（細則 II.1〜6）。
- **Yahoo!広告掲載基準**：銀行カードローン含む「貸金業以外の個人向け貸付」も2017年以降同等の規制（貸金業法相当）。

### 3-3. ASPレギュレーション（主要ASP）

- **A8.net**「法律関係の注意事項」（`www.a8.net/a8compliance/law.html`）：「無条件・無審査」「多重債務一本化」等の禁止、旧サービス内容・旧会社情報の禁止。
- **ValueCommerce**「広告掲載時の注意点」（`www.valuecommerce.ne.jp/policy/as/ad.html`）：「広告」「PR」「プロモーション」表記必須、消費税総額表示必須、貸金業法・特定電子メール法・特定商取引法等の遵守義務。
- **株式会社日本保証アフィリエイトガイドライン**（`www.nihon-hoshou.co.jp/other/affil.html`）：「貸付条件・契約条件（融資額・貸付金利等）を記載する場合は、必ず弊社WEBサイトにて確認のうえ、最新かつ正確な記載」を明示要求。
- **アクセストレード**：金利・限度額の自動更新テンプレート「商品情報クリエイティブ」を提供（情報の常時最新化を半自動化）。

### 3-4. 監修者運用

- 標準的監修者：**FP（CFP/AFP）、税理士、公認会計士、ファイナンシャルプランナー、司法書士、弁護士**。
- 表記要件：氏名、資格、経歴、所属、外部での認証可能なURL（資格団体・所属事務所等）、監修日、監修範囲。
- 景品表示法上の留意点：監修者が金銭的便益を受けている場合、ステマ規制の観点から関係性開示が望ましい（消費者庁ガイドラインの精神）。
- E-E-A-T観点：QRG 2.5.2 で `Person` schema との連携、`sameAs` 属性による外部権威ソースへのリンクが推奨。

### 3-5. 金融サービス仲介業との境界

- **貸金業登録なし**のメディアは「貸付契約の媒介」を行えない。アフィリエイト＝広告（顧客誘引）に留め、契約締結プロセスへの実質的関与は禁止。
- 金融サービス仲介業（金融サービスの提供等に関する法律、2021年11月施行）に該当しないよう、フォーム転送・条件交渉等は行わないことが必須。

---

## Phase 4：除外候補（明示的非採用）

### 4-1. Spam Policies 違反となる手法（**厳禁**）

| 手法 | 出典 |
|---|---|
| Site Reputation Abuse（権威ドメインへの寄生） | developers.google.com/search/blog/2024/11/site-reputation-abuse |
| Scaled Content Abuse（AI/人間問わずランキング操作目的の大量生成） | developers.google.com/search/blog/2024/03/core-update-spam-policies |
| Expired Domain Abuse（旧ドメインの権威転用） | 同上 |
| Cloaking、Doorway pages、Hidden text、Sneaky redirects | developers.google.com/search/docs/essentials/spam-policies |
| 過度なkeyword stuffing | 同上 |
| 低品質バックリンクスキーム | 同上 |

### 4-2. HCU/Core Updateで明確に減点された手法

- 薄い affiliate（製品を実際に試していない・独自情報なし）：QRG 4.7.3 "Thin Affiliation"。
- 上位記事のキュレーション・言い換えのみ（"copycat content"）：QRG 4.6.5。
- AI出力をそのまま大量公開（人間レビューなし）：QRG 2025年1月版 4.6.5・4.6.6。
- 文字数水増し・体験談水増し（Information Gain無し）。

### 4-3. 一次情報で支持できない通説（**システムKPIから除外**）

| 神話 | 反証 |
|---|---|
| 「2,500字以上が良い」「3,000字神話」 | Google公式：「No specific word count」（John Mueller複数発言、Search Engine Land集約）。 |
| 「キーワード密度2-5%が良い」 | Google公式：「Keyword density is not a meaningful concept」。 |
| 「bounce rate / dwell time が直接ランキング要因」 | John Mueller 2020/2022 office hours、Gary Illyes 2015 Tweet で**明確否定**。Search Engine Journal "Is Bounce Rate A Google Ranking Factor?" 集約。 |
| 「FAQ schema は SEO効果あり」 | 2023年8月以降、政府・医療系のみ表示。SearchPilot A/Bテストで効果なし確認。 |
| 「HowTo schema は SEO効果あり」 | 2023年9月13日完全廃止。 |
| 「Flesch-Kincaid readability score が ranking factor」 | John Mueller 「We don't explicitly check things like the reading level」。 |

### 4-4. 英語圏特有で日本語移植困難な手法

- 英語特有のentity recognition最適化（spaCy英語モデル前提のテキスト分析）。
- Passage Indexing 英語特有の文境界処理。
- Wikidata 英語版エンティティとの直接マッピング（日本語版Wikidataはカバレッジが部分的）。

---

## 採用候補ショートリスト（工程別）

### 「日本未採用×海外採用×Google一次情報支持」**最優先5項目**

| # | 工程 | 手法 | 一次情報根拠 |
|---|---|---|---|
| 1 | 工程5 | **Information Gain 駆動の差分生成** | Contextual Estimation of Link Information Gain 特許 + HCU "Does the content provide insightful analysis or interesting information that is beyond the obvious?"（developers.google.com/search/docs/fundamentals/creating-helpful-content） |
| 2 | 工程2 | **Query Fan-out 構造シミュレーション** | developers.google.com/search/docs/appearance/ai-features の "query fan-out" 記述 + 特許 US 12158907B1, US 2024/0289407A1 |
| 3 | 工程5 | **Original research / 独自データ生成** | HCU "Does the content provide original information, reporting, research, or analysis?" |
| 4 | 工程5 | **First-hand experience markers** | E-E-A-T の "Experience"（developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t） |
| 5 | 工程8 | **SearchPilot方式 SEO A/B Testing** | Google公式は直接言及無いが、John Mueller "test things" 推奨発言複数 + SearchPilot/Wix SEO Hub の交差ケース集 |

### 工程1：リライト対象選定（推奨3項目）
- (b) Content decay検出 + 統制された pruning【強推奨】
- (b/c) Cannibalization 検出（SERP重複ベース）【強推奨】
- (c) Click-depth × CTR matrix（GSC API、`country:JP` フィルタ）【推奨】

### 工程2：競合構造分析（推奨4項目）
- **(b) Query Fan-out シミュレーション【強推奨／最優先】**
- (b) Entity-based Gap分析（Knowledge Graph）【推奨】
- (c) SERP intent shift 検出【推奨】
- (a→改良) BM25/TF-IDF ベースの語彙分析（実装は容易だが、これ単独に依存しないこと）【参考】

### 工程3：検索意図分解（推奨3項目）
- (b) Micro-intent × Job-to-be-done 分解【強推奨】
- (c) Reverse engineering SERP【推奨】
- (b) Query fan-out によるサブインテント生成【強推奨】

### 工程4：ギャップ抽出（推奨4項目）
- **(b) Information Gap分析（特許駆動）【強推奨／最優先】**
- (b) Question gap分析（PAA + Reddit + Quora + サジェスト）【強推奨】
- (c) Schema gap分析（Article/Person/Organization の網羅性）【推奨】
- (c) Internal link gap（cluster 内未リンクページの自動検出）【推奨】

### 工程5：差分生成（推奨5項目）
- **(b) Information Gain駆動の差分生成【強推奨／最優先】**
- **(b) Original research / 独自データ生成【強推奨／最優先】**
- **(b) First-hand experience markers【強推奨／最優先】**
- (c) Topical depth scoring（HCU 22項目チェックリスト）【強推奨】
- (c) Author expertise schema（Person + sameAs）【強推奨】

### 工程7：実装（推奨5項目）
- (b) Article + Product + Review + Person + Organization 階層的schema【強推奨】
- (b) FAQ/HowTo schema 新規実装はしない【強推奨：手法の引き算】
- (c) Hub-and-spoke internal linking【強推奨】
- (a→必須化) Core Web Vitals（INP）監視【強推奨】
- (c) Breadcrumb + 構造化URL（/no1/cardloan/promise/ 形式）【推奨】

### 工程8：効果測定・学習ループ（推奨4項目）
- **(b) SearchPilot方式 SEO A/B Testing【強推奨／最優先】**
- (c) Search Console API による粒度の高い decay 検出【強推奨】
- (b) 28日窓×90日窓のtraffic差分自動検出【強推奨】
- (除外) dwell time / bounce rate を KPI 化しない【手法の引き算】

---

## 除外候補リスト

| 除外対象 | 理由 |
|---|---|
| FAQ schema 大量実装 | Google公式が2023年8月以降政府・医療系限定。SearchPilot で効果なし確認 |
| HowTo schema 実装 | 2023年9月13日完全廃止 |
| 文字数神話・密度神話 | Google公式が複数回否定 |
| dwell time / bounce rate KPI | John Mueller・Gary Illyes が複数回否定 |
| 無審査・即日確実・ブラックOK等の表現 | 貸金業法第16条違反、ASPレギュ違反 |
| 上位ページの言い換えリライト（独自情報なし） | QRG 4.6.5 Scaled Content Abuse 該当 |
| 大量サブドメイン展開／パーティ寄生 | Site Reputation Abuse 該当 |
| LLM単独生成→無修正公開 | QRG 4.6.6 Lowest 該当 |
| 監修者表記なしのYMYL記事 | QRG 2.5.2 E-E-A-T要件未満 |
| 「広告」「PR」表記なしのアフィリエイト | 景品表示法ステマ規制違反 |
| 実質年率・限度額のみの省略表記（一体性なし） | 貸金業法第15条違反 |

---

## 設計上の留意点（環境変化を踏まえた）

### 1. アーキテクチャ提案：master data table の設計指針

提案する3層構造：

- **L1: Compliance Layer（必須前提）**：景品表示法表記（PR表記）、貸金業法表示項目（実質年率・限度額・返済方式・登録番号）、ASPレギュレーション、各社禁止表現リスト。**LLM出力は必ずこのレイヤーで事後検証**し、違反があれば自動拒否＋人間エスカレーション。
- **L2: Evidence Layer（一次資料DB）**：金融庁・消費者庁・日本貸金業協会の一次資料URL、各社公式サイトのfact（金利・限度額・所要時間・申込書類）、自社の Original research（実測データ）、監修者プロフィール（Person schema用）。LLMはこのレイヤーから引用ソースを必ず参照。
- **L3: Strategy Layer（差分価値DB）**：Query fan-out 結果、Information gap 候補、SERP intent shift 履歴、A/Bテスト結果。

### 2. LLMの位置づけ

- **LLMを「自由生成器」ではなく「制約付き構造変換器」として使う**。プロンプトは「与えられた `fact_db` の事実だけを使って、与えられた `intent_dimension` を満たす H2 構造で記述せよ」という constrained generation 形式に。
- 出力後の必須検証：(a) Compliance Layer 通過、(b) すべての数値主張に evidence URL が紐づいているか、(c) hallucinated entity（実在しない判例・統計）がないか、(d) Information gain がベースライン記事比でN以上あるか。

### 3. 「日本未採用×海外採用」を採用する際の注意点

- **海外手法の中にも「単独支持」「ベンダーマーケティング」が混じっている**。本報告では Google公式・特許・複数業界専門家交差確認を「強／中」、ベンダー単独支持を「弱」と区別。**強・中のみシステムロジックに組み込み、弱は補助的参考に留める**。
- 例：「Salience score を最大化せよ」「TF-IDF合計スコアを上位記事比1.2倍にせよ」等の単一ベンダー指標は、Google一次情報の支持が弱いためシステムKPIに採用しない。

### 4. 規制環境の継続監視

- 景品表示法：2024年10月1日施行の改正法（確約手続導入、課徴金返金方法追加）。最新の措置命令事例を四半期で監視。
- 貸金業法：日本貸金業協会細則の年次改訂（直近2025年4月2日）。
- Google：QRG年1〜2回更新、Core Update年4〜6回。Search Engine Roundtable・Search Engine Land のRSSをmaster data tableに自動取り込み。

### 5. 「Site Reputation Abuse」アルゴリズム化リスク

- 現時点（2026年4月）は手動措置のみだが、Danny Sullivan の発言で**いつでもアルゴリズム化されうる**。本件メディアが第三者コンテンツを受け入れる場合、編集監督・テーマ整合性を担保する設計が必要。soico.jp/no1/ 配下が消費者金融に topical に整合し、第三者寄稿でないことを明確化することが防御的に重要。

### 6. AI Overview 時代の現実的KPI設計

- 「順位×検索ボリューム×CTR」だけでは不足。**Search Console の「Web」検索タイプにAI Overview/AI Mode のクリックが集計される**（developers.google.com/search/docs/appearance/ai-features）が、AI Overview 表示時のCTRは伝統的検索より低下する傾向（Conductor、Ahrefs データで報告）。
- KPI候補：(a) 自社ページが AI Overview の citation 元として表示されるか（手動サンプリング＋ Semrush AI Visibility Tracker 等）、(b) impression 増加に対する click 増加比率（zero-click 影響度の代理指標）、(c) Information gain 多い記事と少ない記事のCTR差分。

### 7. 「ライターと協働する体制」での運用

- LLMが生成した一次稿を人間ライターが「**Information Gain 注入**」「**First-hand experience 注入**」「**監修者ファクトチェック**」する3段階レビューが現実的。SearchPilot のA/Bテスト前提で、人間ライター介入後の variant が control を上回るかを継続検証。

---

## まとめ

本リサーチで抽出した「日本未採用×海外採用×Google一次情報支持」の最優先5手法は、いずれも**LLMを核としたリライトAIシステムと相性が良く、Node.js + Express + better-sqlite3 + React/Vite の本件アーキテクチャで実装可能**。一方で、システムを「現在有効」に保つには、Google一次情報のモニタリング、QRG年次改訂の取り込み、Spam Policies の継続遵守、そして**日本側の景品表示法・貸金業法・ASPレギュレーションの完全遵守**を、同等以上の優先度でシステム設計に組み込む必要がある。日本のSEOコンサル界で広く語られる手法群の少なくない部分はGoogle一次情報の支持を欠いており、それらをシステムKPIに採用しないことが、長期的な競合優位の源泉となる。
