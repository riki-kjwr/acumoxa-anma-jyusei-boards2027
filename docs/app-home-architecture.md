# 学校・問題集ホームの構成と更新方法

## 3つのファイルと既存の同期
- index.html：共有URLのホーム画面。学校→問題集の順に選択する。
- app-catalog.json：学校と問題集の一覧（表示名、説明、開くURL）を管理する。
- oniki.html：移行前のindex.htmlとGit blobが同じ。既存4アプリの問題・表示・学習データ保存コードは一切変更しない。
- judo-preview.html：既存の柔整画面プレビュー。新ホームにはまだ接続しない。ユーザーから完成版が届くまで待つ。
- functions/、pilot-d1/：既存Cloudflare D1 APIとSpreadsheet同期。今回変更しない。

## 鬼木学園に問題集を追加する
1. Spreadsheetに問題を入れる。新しいSpreadsheetならApps Scriptの同期元とAPI側データソースを確認する。
2. 出題画面のルートを用意する。oniki.htmlの既存ルートは #app=grad、#app=term、#app=class、#app=national の4つ。
3. app-catalog.jsonのoniki.categoriesに新しい項目（id、title、description、href）を追加する。リンク先が未実装なら先に画面を実装する。
4. ホーム画面自体の修正は不要。ただし同期とアプリが新問題を実際に表示するかは別途検証する。

## 学校・コースを追加する
1. 新しい学校のHTMLが必要なら別ファイルとして用意する（既存のoniki.htmlを変更しない）。
2. app-catalog.jsonのschoolsへid、title、subtitle、description、categoriesを追加する。
3. categoriesのhrefに使用するHTMLのURLを指定する。学校ごとに1ページだけならentry_hrefも使用可能。
4. 必要ならその学校のSpreadsheetの同期元・Cloudflareの読み取りAPIとの連携を別途追加する。

## 学習データを守るための注意
- oniki.htmlは移行前のindex.htmlと同じ内容。Cloudflare Pagesの同一ドメインで開けばlocalStorageなどのオリジン単位の保存領域は通常共通。ただしiPhone・iPad・PCで実機確認する。
- Netlifyなど別ドメインとの自動データ移行は行わない。
- 古いindex.html#app=grad等の4リンクは新しいoniki.htmlへ自動的に転送する。
- 既存アプリはHTMLに問題を埋め込んだ方式。D1への自動同期の成功は、アプリの問題表示が自動更新される証明ではない。データ配信の接続は別工程。
- 国試の既存HTMLは0問である。

## mainに反映する前のチェック
1. PRの検証結果を確認する。
2. Cloudflare Pagesのプレビュー環境で学校選択→鬼木→4項目を確認する。
3. 古いURLの #app=grad / term / class / national から直接開けることを確認する。
4. 同一ブラウザ・同一ドメインで⭐、学習履歴、途中保存が維持されることを確認する。
5. iPhoneとiPadで表示と操作を確認する。
6. 確認後にのみmainへマージ。現在の公開アプリはそのまま運用する。
