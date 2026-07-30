# Babel Breaker

[English](README.en.md)

Minecraft、Factorio、Stardew Valley、RimWorldのMODから言語ファイルと原文言語を自動判定し、10言語へ翻訳して導入用ZIPを作るブラウザアプリです。

JAR の解析、翻訳、ZIP 生成はすべてユーザーのブラウザ内で行われます。MOD や翻訳内容をサーバーへアップロードしません。

## 新しいブラウザ版

- 1件または複数の `.jar` / `.zip` をドラッグ＆ドロップ
- 対応ゲームと形式を自動判定
  - Minecraft Java Edition: `.json` / `.lang`、Fabric / Forge / NeoForge / Quilt
  - Factorio: `locale/<language>/*.cfg`
  - Stardew Valley: Content Patcher `i18n/*.json`
  - RimWorld: `Languages` 内の Keyed / DefInjected XML
- 複数 namespace と `.json` / `.lang` に対応
- `en_us`、`fr_fr`、`de_de` などのMinecraft言語コードと本文から原文言語を自動判定
- ファイル名の宣言言語と本文の検出言語を分け、日本語・韓国語の高信頼な不一致を項目単位で表示
- 漢字だけの文章や、言語を特定できない文字体系の不一致は自動翻訳せず、手動確認へ回す
- Mozilla Bergamot と WebAssembly を使った端末内翻訳
- 英語以外の言語間は、ブラウザ内だけで原文→英語→翻訳先の順に翻訳
- 端末内翻訳の原文・翻訳先10言語: 日本語、韓国語、中国語（簡体・繁体）、ドイツ語、スペイン語、フランス語、ポルトガル語、ロシア語、イタリア語（原文は英語にも対応）
- 翻訳先10言語: 日本語、韓国語、中国語（簡体・繁体）、ドイツ語、スペイン語、フランス語、ポルトガル語（ブラジル）、ロシア語、イタリア語
- UI 5言語: 日本語、英語、韓国語、簡体字中国語、スペイン語
- UI言語に合わせて翻訳先を初期選択（英語UIでは端末の対応言語を優先）
- 非対応環境・任意の外部ツール向けのコピー翻訳
- 外部翻訳用の原文JSON保存と、翻訳済みJSON / TXTの読込・ドロップ
- `%s`、`%1$d`、`{0}`、`§a`、改行、URL の保護
- 選択言語の既存lang（`ja_jp`、`de_de` など）を再利用し、不足分だけ翻訳
- 翻訳内容をブラウザ上で確認・修正
- 機械翻訳した項目を「要確認」として初期表示
- 「要確認」には未翻訳も含め、未翻訳・エラー・判定保留・機械翻訳の順で表示
- 空の原文は翻訳対象外として扱い、未翻訳件数には含めない
- 項目単位または一括で無視し、未翻訳・無視・安全でない項目を除外していつでもZIPを作成
- 同じゲームの複数MODを1つの翻訳ZIPへ統合
- Minecraft 1.11–1.21.11 / 26.1 向けリソースパックを生成
- Factorio・Stardew Valley・RimWorld向けに、元のMODへ統合できる翻訳ファイルだけのZIPを生成
- Firebase Hosting で静的配信

API キー、Ollama、LM Studio、ユーザー登録は不要です。

Web 版: https://babel-breaker.web.app/

ソースコードは MIT License で公開しています。

## ローカル開発

必要なもの:

- Node.js 20 以上
- npm

```bash
npm install
npm run dev
```

表示された `http://127.0.0.1:5173` をモダンブラウザで開きます。
開発・本番ビルド時に翻訳モデル本体はダウンロードしません。サイト利用者が取得するのは翻訳に必要な圧縮モデルだけです。英語原文では約24〜48MiB、英語以外から別言語では英語を経由する2モデルでおおむね約38〜94MiBです。取得後はブラウザ内で展開・SHA-256検証し、Cache Storageから再利用します。

## テストと本番ビルド

```bash
npm run check
```

個別に実行する場合:

```bash
npm test
npm run build
```

生成物は `dist/` に出力されます。

## Firebase Hosting とモデル配信

Firebase プロジェクトは `.firebaserc` の `babel-breaker` を使用します。
Firebaseには約6MBのWebアプリだけを配置します。約619MiBの圧縮モデル一式は、Mozilla Firefox Translationsモデルの公開ミラーを不変コミットに固定し、Hugging Faceからブラウザへ直接配信します。Firebase Storage、Functions、有料CDN、クレジットカード登録は不要です。

```bash
npm run verify:model-hosting
firebase deploy --only hosting
```

`firebase deploy` のpredeployは `npm run check:firebase` を実行し、全モデルのURL・容量・CORSを確認して `dist/models` を除外します。Content Security Policyは固定したHugging Face配信元だけを許可します。モデル一覧の更新は `npm run sync:models` で行い、取得した圧縮ファイルの容量とSHA-256をコードへ固定します。

Firebase SDK は使用していません。Hosting はアプリの静的ファイルだけを配信し、MOD の内容や翻訳履歴を保存しません。

## 基本フロー

1. 1件または複数の MOD JAR / ZIP をドロップ
2. 自動検出されたゲーム・MOD・原文言語を確認
3. 「この端末で翻訳」または「外部ツールで翻訳」を選択
   - 外部ツール方式では依頼文をコピーするか、原文JSONを保存
   - 翻訳結果は貼り付けるか、JSON / TXTファイルを読み込み
4. 「要確認」に表示された翻訳結果を確認・修正
5. 単体または複数MODをまとめた翻訳 ZIP をダウンロード
6. 画面に表示されるゲーム別手順に沿って導入
   - MinecraftはZIPを解凍せず `resourcepacks` へ追加
   - ほかのゲームはZIPを展開し、生成された言語フォルダーをバックアップ済みの元MODへ統合

端末内翻訳を初めて使う場合は、必要な Mozilla モデルをダウンロードします。英語以外から別言語へ翻訳するときは、原文→英語と英語→翻訳先の2モデルを端末内で連結します。モデルはブラウザの Cache Storage に保存され、同じモデルは再利用されます。WebAssembly / Web Worker に対応していない環境や、端末内モデルがない原文ロケールでは、外部ツール方式が自動で選択されます。外部ツール用の依頼文にも、検出した原文言語がnamespaceごとに記載されます。

## ディレクトリ

```text
BabelBreaker/
├─ index.html
├─ src/
│  ├─ app.js          # UI と操作フロー
│  ├─ core.js         # 対応ゲーム判定・翻訳保護・ZIP生成
│  ├─ i18n.js         # UIの5言語表示
│  ├─ languages.js    # 原文・翻訳先とMinecraft言語コード
│  ├─ local-translator.js # Bergamotモデル・Worker管理
│  └─ styles.css
├─ public/
├─ scripts/            # 法的表示とモデル資産の準備
├─ tests-web/
├─ firebase.json
├─ .firebaserc
└─ package.json
```

Firebase で公開されるのは、ビルドで生成される `dist/` のみです。

## プライバシー

- MOD ファイルをサーバーへ送信しない
- 翻訳テキストを保存しない
- API キーを要求しない
- Firebase Storage / Firestore / Authentication を使用しない
- アプリ独自の Cookie / Analytics / LocalStorage を使用しない
- Cache Storage には再利用可能な公開翻訳モデルだけを保存する

端末内翻訳モデルは、Mozilla Firefox Translationsモデルの公開Hugging Faceミラーにある不変コミットから配信します。圧縮ファイルは容量とSHA-256を検証してからブラウザ内で展開します。英語を経由する翻訳もすべてブラウザ内で行い、モデル取得リクエストに MOD の内容や翻訳文は含まれません。外部ツール方式では、ユーザー自身が選んだサービスへ貼り付けた場合に限り、そのテキストが端末外へ送られます。

Firebase Hosting は静的ファイルの配信時にアクセス元 IP アドレスを処理します。これは不正利用の検出と利用状況の分析に使用され、Firebase のプライバシー条件が適用されます。

## セキュリティ

- Content Security Policy で外部スクリプトと外部通信を禁止
- iframe への埋め込みを禁止
- JAR 内のパストラバーサルを拒否
- JAR は最大 512MB、最大 100,000 エントリ
- lang の展開後合計サイズを制限し、ZIP bomb によるメモリ消費を抑制
- Minecraft のプレースホルダー、色コード、改行、URL を生成前に検証
- 本番ソースマップを配信しない

脆弱性の詳細を公開 Issue に直接書かないでください。リポジトリの Private vulnerability reporting を有効にしたうえで、GitHub の「Report a vulnerability」から受け付ける運用を推奨します。

詳細:

- [Privacy](PRIVACY.md)
- [Security Policy](SECURITY.md)

## Links

- X: https://x.com/IGNORANZ_P
- GitHub: https://github.com/IGNORANZ-PROJECT/BabelBreaker

## License

MIT License

`© 2026 IGNORANZ PROJECT`

本番ビルドには、実行時依存パッケージのライセンス全文を収録した `THIRD_PARTY_NOTICES.txt` も含まれます。

Babel Breaker は各対応ゲームの開発元・販売元とは関係のない非公式コミュニティツールです。生成した翻訳を公開・再配布するときは、対象 MOD のライセンスと作者の方針を確認してください。
