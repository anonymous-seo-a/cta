# 開発環境セットアップガイド

MacBook Pro 14" M5 24GB + VSCode + Claude Code + clasp

---

## 全体像

```
VSCode
├── Claude Code 拡張機能（左サイドバー）
│   → コードの実装・修正・commit・pushを指示
│
├── エディタ領域
│   → .gsファイルの確認・手動修正
│
└── ターミナル
    → clasp push / git操作 / 動作確認
```

作業フロー:
```
Claude Code にやりたいことを伝える
  ↓
Claude Code が .gs ファイルを編集 + git commit
  ↓
ターミナルで clasp push（GASに反映）
  ↓
GASコンソールで実行テスト
  ↓
結果を Claude Code に貼ってデバッグ
```

---

## STEP 0: 前提確認

### Node.js
ターミナルを開いて確認:
```bash
node -v
```
`v20.x.x` 以上が表示されればOK。

表示されない場合:
```bash
# Homebrewが入っていれば
brew install node

# 入っていなければ先にHomebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

### Git
```bash
git -v
```
表示されればOK。なければ `brew install git`。

### VSCode
https://code.visualstudio.com/ からダウンロード済みであること。

---

## STEP 1: Claude Code 拡張機能のインストール

1. VSCode を開く
2. `Cmd + Shift + X`（拡張機能パネルを開く）
3. 検索窓に「Claude Code」と入力
4. **Anthropic が発行元のもの**（公式）をインストール
   - 非公式の類似品があるので注意
5. インストール後、左サイドバーに ✦（スパークアイコン）が出現
6. クリックして Anthropic アカウントでログイン

### 確認方法
✦ アイコンをクリック → チャットパネルが開く → 「hello」と入力して応答が返ればOK。

### 補足: Claude Code CLI も同時にインストールされる
拡張機能がCLIを内包しているので、ターミナルから `claude` コマンドも使える。
ただし基本はVSCode内のパネルから使う。

---

## STEP 2: リポジトリのクローン

ターミナル（VSCode内でもMacのターミナルでもOK）で実行:

```bash
# 作業ディレクトリに移動（好きな場所でOK）
cd ~/Projects

# リポジトリをクローン
git clone https://<YOUR_PAT>@github.com/anonymous-seo-a/cta.git
# ↑ <YOUR_PAT> は自分のGitHub Personal Access Token に置き換える

# クローンしたディレクトリに移動
cd cta

# gitユーザー設定
git config user.name "daiki"
git config user.email "daiki@soico.jp"
```

### VSCodeでプロジェクトを開く
```bash
code .
```
または VSCode のメニュー → File → Open Folder → `~/Projects/cta` を選択。

---

## STEP 3: clasp のインストールとログイン

### 3-1. claspインストール
```bash
npm install -g @google/clasp
```

確認:
```bash
clasp --version
```
バージョン番号が表示されればOK。

### 3-2. Apps Script API を有効化

**これを忘れるとclasp loginが通ってもclone/pushが失敗する。**

1. ブラウザで https://script.google.com/home/usersettings を開く
2. 「Google Apps Script API」を **オン** にする

### 3-3. clasp login
```bash
clasp login
```
- ブラウザが自動で開く
- soicoのGASプロジェクトにアクセスできるGoogleアカウントでログイン
- 「許可」をクリック
- ターミナルに「Authorization successful.」と表示されれば完了

認証情報は `~/.clasprc.json` に保存される（次回以降は不要）。

---

## STEP 4: clasp clone（GASプロジェクトとの紐付け）

### 4-1. スクリプトIDの確認

提供されたID: `1GBkuL5a7OTOeem9xjYnQzmAmqDwRe6pN4Zou4lItocjQzwElk14VQ79M`

**確認方法（念のため）:**
1. GASエディタを開く（https://script.google.com/）
2. 対象プロジェクトを開く
3. 左メニューの ⚙「プロジェクトの設定」をクリック
4. 「スクリプト ID」の欄に表示されているIDが一致していることを確認

### 4-2. clone実行

**重要: claspはcloneしたディレクトリに全ファイルを展開する。**
既存の `gas/` ディレクトリ内で実行すると既存ファイルと衝突するので、
専用サブディレクトリ `clasp/` を作ってそこで管理する。

```bash
# プロジェクトルートにいることを確認
cd ~/Projects/cta

# clasp用ディレクトリ作成
mkdir clasp
cd clasp

# clone実行
clasp clone 1GBkuL5a7OTOeem9xjYnQzmAmqDwRe6pN4Zou4lItocjQzwElk14VQ79M
```

成功すると以下のファイルが生成される:
```
clasp/
├── .clasp.json          ← プロジェクト設定（スクリプトIDが記録される）
├── appsscript.json      ← GASのマニフェスト
├── main.gs
├── cta_insertion.gs
├── seo_rewrite.gs
├── seo_rewrite_markup.gs
├── annotation_master.gs
├── gsc_master.gs
└── (GASエディタにある他のファイル)
```

### 4-3. ディレクトリ構造の整理

clone後、GASから取得したファイルと既存の `gas/` ディレクトリの内容を比較する。
今後は `clasp/` ディレクトリが正（Single Source of Truth）になる。

```bash
# 差分確認（どちらが新しいか）
diff clasp/main.gs ../gas/main.gs
```

差分がなければ、今後の編集は全て `clasp/` 内で行う。
`gas/` ディレクトリは参照用として残してもいいし、後で削除してもいい。

---

## STEP 5: .claspignore の作成

`clasp push` 時にGASに送らないファイルを指定する。
`clasp/` ディレクトリ内に `.claspignore` を作成:

```bash
cd ~/Projects/cta/clasp
```

以下の内容で `.claspignore` を作成（VSCodeでファイル作成 or ターミナル）:

```
# Git関連
**/.git/**

# ドキュメント
**/docs/**
**/prompts/**

# プロジェクト管理
**/README.md
**/CLAUDE.md
**/node_modules/**
```

---

## STEP 6: clasp push のテスト

```bash
cd ~/Projects/cta/clasp

# まず現在の状態をpull（GASエディタ側の最新を取得）
clasp pull

# 何も変更せずpush（GASに反映）
clasp push
```

`clasp push` 実行後:
- 「Pushed N files.」と表示されれば成功
- GASエディタを開いてファイルが存在していることを確認

### pushで403エラーが出た場合
→ STEP 3-2 の Apps Script API 有効化を確認

### pushで「Files in conflict」が出た場合
→ `clasp pull` で最新を取得してから再度push

---

## STEP 7: CLAUDE.md の更新

`clasp/` ディレクトリを正とする運用に合わせて、
プロジェクトルートの `CLAUDE.md` を更新する必要がある。

Claude Code に以下のように指示する:

```
CLAUDE.md のファイル構成を更新してください。
今後のGASファイル編集は clasp/ ディレクトリ内で行います。
clasp push でGASに反映する運用です。
gas/ ディレクトリはアーカイブとして残します。
```

---

## STEP 8: Git管理の設定

clasp関連ファイルをgitに追加:

```bash
cd ~/Projects/cta

# .clasp.json はスクリプトIDを含むのでgit管理する
git add clasp/.clasp.json clasp/.claspignore

# .clasprc.json（認証情報）はgitに入れない
# → ホームディレクトリにあるので通常は問題ない

git commit -m "chore: clasp環境構築 + .claspignore追加"
git push origin main
```

### .gitignore に追加すべき項目
```
# clasp認証（通常 ~/ にあるが念のため）
.clasprc.json
```

---

## 日常の開発フロー

### パターンA: Claude Code で実装（メイン）

```
1. VSCode で cta プロジェクトを開く
2. ✦ アイコンをクリックして Claude Code パネルを開く
3. Claude Code に指示:
   「clasp/seo_rewrite_markup.gs の注釈処理で、
    目次ナビ内のテキストにも注釈が入るように修正して」
4. Claude Code がファイルを編集（差分がエディタに表示される）
5. 変更を確認して Accept
6. ターミナルで:
   cd clasp && clasp push
7. GASコンソールで実行テスト
8. ログを Claude Code に貼ってデバッグ
9. 完了したら:
   cd ~/Projects/cta
   git add -A && git commit -m "fix: 目次ナビの注釈処理を修正" && git push
```

### パターンB: デバッグ（GASログを貼る）

```
1. GASコンソールでスクリプト実行
2. 実行ログ（Logger.log の出力）をコピー
3. Claude Code に貼り付け:
   「以下のログで [D3] 全文ポスト処理 が0件修正になっている。
    期待値は10件以上。原因を調査して修正して」
4. Claude Code がコード調査 → 修正
5. clasp push → 再テスト
```

### パターンC: 設計相談（claude.ai 分身PJ）

```
1. claude.ai の分身プロジェクトを開く
2. 「SEOリライトのStep 3で注釈処理が重い。
    全文一括ではなくチャンク分割にすべきか？」
3. 構造的な議論 → 方針決定
4. 決まった方針を Claude Code に指示として渡す
```

---

## トラブルシューティング

### clasp push で「Script doesn't have a type.」
→ `appsscript.json` が `clasp/` 内にあるか確認

### clasp push 後にGASで関数が見つからない
→ GASエディタをリロード（ブラウザでF5）

### Claude Code がファイルの場所を間違える
→ 「clasp/ ディレクトリ内のファイルを編集して」と明示する
→ CLAUDE.md に正しいパスが書いてあれば自動で認識するはず

### GASエディタで直接編集してしまった
→ `clasp pull` でローカルに反映してから作業を続ける
→ **ルール: GASエディタでの直接編集は緊急時のみ。ローカルが正。**

---

## コマンド早見表

| やること | コマンド | 場所 |
|---|---|---|
| GASに反映 | `clasp push` | clasp/ |
| GASから取得 | `clasp pull` | clasp/ |
| GASエディタを開く | `clasp open` | clasp/ |
| git保存 | `git add -A && git commit -m "..."` | cta/ |
| git push | `git push origin main` | cta/ |
| Claude Code 起動 | ✦ アイコン or `Cmd+Shift+P` → "Claude Code" | VSCode |
