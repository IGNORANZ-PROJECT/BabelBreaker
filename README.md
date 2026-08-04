# Babel Breaker

[English](README.en.md)

Minecraft、Factorio、Stardew Valley、RimWorldのゲームファイルから翻訳対象と原文言語を自動判定し、11言語へ翻訳して導入用ファイルを作るブラウザアプリです。

JAR の解析、翻訳、ZIP 生成はすべてユーザーのブラウザ内で行われます。MOD や翻訳内容をサーバーへアップロードしません。

## 新しいブラウザ版

- 1件または複数の `.jar` / `.zip` / `.mrpack` / `.mcpack` / `.mcaddon` / `.mcworld` をドラッグ＆ドロップ
- 対応ゲームと形式を自動判定
  - Minecraft Java Edition: `.json` / `.lang`、Fabric / Forge / NeoForge / Quilt
  - Minecraft ModPack: Modrinth、CurseForge、インスタンスZIP。同梱されていないMODはローカルJARの同時選択で補完
  - Java配布ワールド: `resources.zip`と、Anvil region内にある既知形式の看板・本・表示名
  - Bedrock: Add-on、World、リソースパックの`.lang`、`languages.json`、manifest依存関係
  - データパック: advancementなど既知のJSON表示文と`.mcfunction`内のJSONテキスト
  - サーバープラグイン: 外部言語JSON / YAML / propertiesを、JARを書き換えない翻訳パッチとして出力
  - Patchouli: リソースパック型ガイドブックのcategories / entries / templates JSON
  - FTB Quests: 1.21系のロケールSNBTと、旧形式SNBT／バイナリNBT内のタイトル・説明
  - Better Questing: 旧形式のクエストJSON内にある名称・説明
  - Factorio: `locale/<language>/*.cfg`
  - Stardew Valley: Content Patcher `i18n/*.json`
  - RimWorld: `Languages` 内の Keyed / DefInjected XML
- 複数 namespace と `.json` / `.lang` に対応
- `en_us`、`fr_fr`、`de_de` などのMinecraft言語コードと本文から原文言語を自動判定
- ファイル名の宣言言語と本文の検出言語を分け、日本語・韓国語の高信頼な不一致を項目単位で表示
- 漢字だけの文章や、言語を特定できない文字体系の不一致は自動翻訳せず、手動確認へ回す
- Mozilla Bergamot と WebAssembly を使った端末内翻訳
- 英語以外の言語間は、ブラウザ内だけで原文→英語→翻訳先の順に翻訳
- 端末内翻訳の原文・翻訳先11言語: 英語、日本語、韓国語、中国語（簡体・繁体）、ドイツ語、スペイン語、フランス語、ポルトガル語、ロシア語、イタリア語
- 翻訳先11言語: 英語、日本語、韓国語、中国語（簡体・繁体）、ドイツ語、スペイン語、フランス語、ポルトガル語（ブラジル）、ロシア語、イタリア語
- UI 5言語: 日本語、英語、韓国語、簡体字中国語、スペイン語
- UI言語に合わせて翻訳先を初期選択
- 非対応環境・任意の外部ツール向けのコピー翻訳
- 外部翻訳用の原文JSON保存と、翻訳済みJSON / TXTの読込・ドロップ
- `%s`、`%1$d`、`%player%`、`{0}`、`{team}`、MiniMessageタグ、`§a`、Patchouliの`$(...)`、改行、URL の保護
- 選択言語の既存lang（`ja_jp`、`de_de` など）を再利用し、不足分だけ翻訳
- 翻訳内容をブラウザ上で確認・修正
- 機械翻訳した項目を「要確認」として初期表示
- 「要確認」には未翻訳も含め、未翻訳・エラー・判定保留・機械翻訳の順で表示
- 空の原文は翻訳対象外として扱い、未翻訳件数には含めない
- 項目単位または一括で無視し、未翻訳・無視・安全でない項目を除外していつでもZIPを作成
- 同じゲームの複数MODを一括処理し、1回のダウンロードにまとめて出力
- Minecraft 1.11–1.21.11 / 26.1 向けリソースパックを生成
- Patchouli翻訳は対象ロケールのガイドブックJSONとしてリソースパックへ収録
- FTB Quests / Better Questingを検出した場合は、リソースパックとインスタンス配置用ファイルを分けた翻訳バンドルを生成
- Factorio向けに、元MODと翻訳済みlocaleをまとめた入れ替え用MOD ZIPを生成
- Stardew Valley向けに、元MODと翻訳済みi18nをまとめた入れ替え用MOD ZIPを生成
- RimWorld向けに、元MODを変更しない独立した翻訳MOD ZIPを生成
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

1. 1件または複数の対応ファイルをドロップ
2. 自動検出されたゲーム・MOD・原文言語を確認
3. 「この端末で翻訳」または「外部ツールで翻訳」を選択
   - 外部ツール方式では依頼文をコピーするか、原文JSONを保存
   - 翻訳結果は貼り付けるか、JSON / TXTファイルを読み込み
4. 「要確認」に表示された翻訳結果を確認・修正
5. 単体または複数MODの導入用ZIPをダウンロード
6. 画面に表示されるゲーム別手順に沿って導入
   - 通常のMinecraft／Patchouli出力はZIPを解凍せず `resourcepacks` へ追加
   - FTB Quests／Better Questingを含む翻訳バンドルは展開し、同梱READMEに従って`instance`の中身をインスタンスへコピー
   - Factorioは元MODをバックアップし、翻訳済みMOD ZIPへ入れ替え
   - Stardew Valleyは元MODをバックアップし、翻訳済みMODを `Stardew Valley/Mods` へ展開
   - RimWorldは元MODを残し、翻訳MODを `RimWorld/Mods` へ展開して元MODより後に有効化

Factorio・Stardew Valley向けの出力には、選択した元MODのファイルが含まれます。個人利用の入れ替えを簡単にするための形式であり、元MODのライセンスまたは作者が許可していない限り再配布しないでください。RimWorld向けの翻訳MODには元MODを含めません。

端末内翻訳を初めて使う場合は、必要な Mozilla モデルをダウンロードします。英語以外から別言語へ翻訳するときは、原文→英語と英語→翻訳先の2モデルを端末内で連結します。モデルはブラウザの Cache Storage に保存され、同じモデルは再利用されます。WebAssembly / Web Worker に対応していない環境や、端末内モデルがない原文ロケールでは、外部ツール方式が自動で選択されます。外部ツール用の依頼文にも、検出した原文言語がnamespaceごとに記載されます。

## ディレクトリ

```text
BabelBreaker/
├─ index.html
├─ src/
│  ├─ app.js          # UI と操作フロー
│  ├─ core.js         # 対応ゲーム判定・翻訳保護・ZIP生成
│  ├─ artifact-formats.js # ModPack・World・Add-on・各種パックの解析と出力
│  ├─ java-world.js        # Anvil region内の既知NBT文章と安全な再構築
│  ├─ minecraft-content.js # Patchouli・クエスト形式の解析と安全な再構築
│  ├─ nbt.js               # Java Edition NBTの型保持・圧縮・展開
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

### Minecraft拡張形式の範囲

- ModPackでは同梱JARを解析し、不足している索引参照ファイルはユーザーが同時選択したローカルJARで補います。元のMOD JARは変更せず、翻訳リソースパックを追加します。
- Java配布ワールドでは通常のregionファイル内にある既知形式の看板・本・表示名を対象にします。外部チャンクは変更せず、翻訳後はチャンク位置テーブルを再計算します。
- Bedrock Add-on／リソースパックではUUIDを維持して変更対象manifestのパッチバージョンと依存バージョンを更新します。Bedrock WorldのLevelDB内部は変更せず、埋め込みリソースの言語ファイルだけを対象にします。
- データパックとサーバープラグインは既知の表示文字列だけを対象にし、コマンド識別子やプラグインJAR本体は変更しません。
- Patchouliは`assets/<namespace>/patchouli_books/<book>/<locale>/`にある、リソースパックから上書き可能な書籍本文を対象にします。
- FTB Quests 1.21系は`config/ftbquests/quests/lang/<locale>.snbt`を対象にし、既存の翻訳があれば再利用します。旧形式ではクエストSNBTまたはバイナリNBT内の`title`、`subtitle`、`description`などを対象にします。
- Better Questingは`config/betterquesting`内のクエストJSONから`name`、`desc`、`description`などを抽出します。
- バイナリ`.nbt`は全12タグ型、Java Modified UTF-8、raw／GZIP／zlib圧縮を型付きで往復し、表示文字列だけを書き換えます。壊れたNBTや制限を超えるデータは、変更せず警告付きで読み飛ばします。

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

- 公式サイト: https://ignoranz-project.web.app/
- X: https://x.com/IGNORANZ_P
- GitHub: https://github.com/IGNORANZ-PROJECT/BabelBreaker

## License

MIT License

`© 2026 IGNORANZ PROJECT`

本番ビルドには、実行時依存パッケージのライセンス全文を収録した `THIRD_PARTY_NOTICES.txt` も含まれます。

Babel Breaker は各対応ゲームの開発元・販売元とは関係のない非公式コミュニティツールです。生成した翻訳を公開・再配布するときは、対象 MOD のライセンスと作者の方針を確認してください。
