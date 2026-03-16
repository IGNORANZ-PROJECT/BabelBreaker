# Babel Breaker

Babel Breaker は、Minecraft mod の `lang` を翻訳し、そのまま使えるリソースパック ZIP を作るツールです。

- ブラウザ GUI と CUI の両方に対応
- mod の `.jar` / `.zip` / 解凍済みフォルダを直接読める
- 元 `lang` の自動抽出に対応
- `clipboard` / `file` / `AI` の 3 モードを使える
- 複数 namespace / 複数 source lang をまとめて処理できる
- Mac / Windows を想定

重要なのは、Minecraft の言語ファイルではキーを変えてはいけないことです。

- キー: 内部 ID
- 値: ゲーム内に表示される文章

このツールは、値だけを翻訳し、キーは維持します。

## 最初に読む

迷ったら、まずは次のどちらかで使い始めるのが簡単です。

### API なしで使う

いちばん手軽な方法です。Babel Breaker で元 `lang` を抜き出し、外部 AI に貼って翻訳してもらい、戻ってきた JSON をリソースパック化します。複数 mod をまとめて扱いたい場合は `file` モードを使います。

手順:

1. GUI を開く
2. mod の `.jar` / `.zip` を入れる
3. `元 lang を取得` を押す
4. 抽出された JSON を ChatGPT などの外部 AI に貼って、値だけ翻訳してもらう
5. 戻ってきた JSON を `clipboard` モードか `file` モードで使う
6. `リソースパック生成` を押す

向いている使い方:

- API キーを設定したくない
- 翻訳文を自分で確認してから pack 化したい
- まずは 1 本だけ試したい
- 複数 mod をまとめて処理したいが、API は使いたくない

使い分け:

- `clipboard`: 1 件ずつ手早く戻したい時向け
- `file`: 複数 mod をまとめて戻したい時向け

### API ありで一気に使う

API キーを設定して、抽出から翻訳、pack 化までそのまま進める方法です。

手順:

1. `[api]` を設定する
2. GUI で mod を入れる
3. `AI` モードを選ぶ
4. 必要なら `translation.custom_prompt` を入れる
5. `リソースパック生成` を押す

向いている使い方:

- 複数 mod をまとめて処理したい
- 毎回コピペせずに進めたい
- 用語統一や custom prompt もまとめて使いたい

詳しい説明は下の `4. GUI の使い方`、`5. 翻訳モード`、`6. 詳しい使い方の例` 以降にあります。

## 1. 最短の使い方

### Mac

1. Python 3.10 以上を入れる
2. このフォルダを開く
3. `launch_gui.command` を実行する

開けない場合:

```bash
python3 -m babel_breaker_app --gui
```

### Windows

1. Python 3.10 以上を入れる
2. このフォルダを開く
3. `launch_gui.bat` を実行する

開けない場合:

```bash
py -m babel_breaker_app --gui
```

## 2. まず何ができるか

- mod から翻訳元 `lang` を自動検出する
- 元 `lang` JSON をクリップボードへコピーする
- 元 `lang` JSON を `.json` ファイルとして保存する
- 複数 namespace / 複数 lang をまとめて翻訳する
- 翻訳済み JSON を使ってリソースパック ZIP を作る
- AI を使って値だけ翻訳し、そのまま ZIP を作る
- GUI で `babel_breaker_app/config.toml` の全設定を編集する

## 3. フォルダ構成

```text
BabelBreaker/
├─ launch_gui.command
├─ launch_gui.bat
├─ README.md
├─ LICENSE
├─ babel_breaker_app/
│  ├─ __main__.py
│  ├─ config.toml
│  ├─ main.py
│  ├─ web_gui.py
│  ├─ gui_shared.py
│  └─ assets/
│     ├─ icon.png
│     └─ favicon.png
└─ _babel_breaker_output/   ← 自動作成
```

`babel_breaker_app/config.toml` が無い場合:

- `python3 -m babel_breaker_app` を 1 回実行すると、説明付き見本を自動生成します
- GUI の `設定を保存` でも作成できます

## 4. GUI の使い方

`--gui` はローカルのブラウザ GUI を起動します。通常は自動でブラウザが開きます。タブアイコンには `babel_breaker_app/assets/favicon.png` を使います。

基本の流れ:

1. mod の `.jar` / `.zip` をドラッグ＆ドロップする
2. `clipboard` / `file` / `AI` を選ぶ
3. `リソースパック生成` か `元 lang を取得` を押す

GUI の考え方:

- 普段使わない設定は `詳細設定を開く` まで出ません
- `file モード入力` だけは `file` モードを選んだ時だけ中央に出ます
- `AI` と `file` モードは複数 mod をキューで処理できます
- `clipboard` モードは 1 件ずつで、キューは使いません
- 実行中は画面上部のプログレスバーで進捗、完了数、失敗数を確認できます

GUI でできること:

- mod JAR / ZIP のドラッグ＆ドロップ入力
- `AI` / `file` モードでの複数 mod キュー投入
- 処理中の追加キュー
- ボタンからのファイル選択 / フォルダ選択
- `リソースパック生成`
- `元 lang を取得`
- `設定を保存`
- `設定フォルダを開く`
- `出力先を開く`
- `README を開く`
- 画面下部の `© IGNORANZ PROJECT` / `GitHub` リンク

ブラウザ GUI を更新した直後で挙動が古いままに見える場合は、タブを閉じて開き直すか、ハードリロードしてください。

## 5. 翻訳モード

### `clipboard` モード

自分で翻訳済み JSON を用意して、クリップボード経由で使うモードです。

流れ:

1. `元 lang を取得` で元 JSON を抜き出す
2. JSON の値だけ翻訳する
3. 翻訳済み JSON をクリップボードへコピーする
4. `translation.mode = "clipboard"` で生成する

特徴:

- 手動翻訳や別の翻訳サービスと組み合わせやすい
- キー照合を行うため、欠落キーや余計なキーはそのまま通りません
- GUI では 1 件ずつ処理します
- 複数 namespace の mod では、bundle JSON をそのまま使えます

補助動作:

- クリップボードに対応 JSON が無い
- JSON が壊れている
- キーが合わない

この場合、既定では mod に対応する元 `lang` JSON を自動取得してクリップボードへ入れ直します。

自動取得を切る方法:

- GUI の `詳細設定` でオフ
- CUI の `-a` / `--no-auto-fetch-source-lang`

### `file` モード

翻訳済みファイルや、直接貼り付けたテキストを使うモードです。

流れ:

1. `translation.mode = "file"` にする
2. `file モード入力` に翻訳ファイル一覧か直接入力テキストを入れる
3. `リソースパック生成` を実行する

特徴:

- `.json` や `.txt` を複数指定できます
- 1 ファイルに複数 mod 分の辞書が入っていても自動探索します
- 1 つの mod が複数 namespace / 複数 source lang を持っていても、bundle JSON をまとめて扱えます
- JSON を直接貼り付けても使えます
- `元 lang を取得` は既定で `.json` 保存のみで、クリップボードは使いません
- 保存先未指定なら `_babel_breaker_output/_extracted_lang/` に自動保存します

### `ai` モード

元 `lang` を自動検出して AI で値だけ翻訳するモードです。

特徴:

- 翻訳から pack 化まで一気に進められます
- 同じ原文には同じ訳語を優先します
- mod の世界観、口調、固有名詞を守る方向でプロンプトを作ります
- アニメやゲーム原作 mod では既存作品の用語を優先しやすくしています
- 複数 namespace / 複数 source lang を持つ mod でも、選ばれた source をまとめて翻訳します
- 既に `target_locale` がある場合でも、一部未翻訳なら既存訳を残したまま不足分だけ翻訳します
- `target_locale` が十分に埋まっている namespace は、既定で安全にスキップします

重要な設定:

- `translation.enforce_consistent_terms = true`
- `translation.custom_prompt`

例:

```toml
[translation]
custom_prompt = """
公式日本語訳がある固有名詞は必ずそれを使う。
アニメ本編の用語表記に合わせる。
技名と組織名は既存作品の日本語表記を優先する。
UI 文言は短く自然にする。
"""
```

## 6. 詳しい使い方の例

### API を使わず、外部 AI に貼って翻訳してもらう

この方法なら、Babel Breaker 側に API 設定は不要です。1 本だけなら `clipboard`、複数 mod をまとめるなら `file` が向いています。

すでに mod 側に `target_locale` が一部入っている場合でも、既定では未翻訳の不足分だけを抽出して外部 AI に渡せます。

流れ:

1. GUI を開く
2. mod の `.jar` / `.zip` を入れる
3. `元 lang を取得` を押す
4. 抽出された JSON を外部 AI に渡して翻訳してもらう
5. 戻ってきた JSON を `clipboard` モードか `file` モードで使う
6. `リソースパック生成` を押す

外部 AI への依頼例:

```text
この JSON は Minecraft mod の lang です。
キーは絶対に変更しないでください。
値だけ自然な日本語に翻訳してください。
プレースホルダ、改行、色コードは維持してください。
JSON 以外は返さないでください。
```

`clipboard` モードで戻す場合:

1. 外部 AI の返答 JSON をそのままコピーする
2. GUI で `clipboard` を選ぶ
3. `リソースパック生成` を押す

`file` モードで戻す場合:

1. 外部 AI の返答を `.json` や `.txt` として保存する
2. GUI で `file` を選ぶ
3. `file モード入力` にそのファイルを追加する
4. `リソースパック生成` を押す

`file` モードで複数 mod をまとめて戻す場合:

1. 複数 mod から `元 lang を取得` していく
2. それぞれの JSON を外部 AI に渡して翻訳してもらう
3. 返ってきた JSON を 1 個以上の `.json` / `.txt` にまとめる
4. GUI で `file` を選ぶ
5. 翻訳対象の mod を複数キューへ入れる
6. `file モード入力` に翻訳ファイル群を追加する
7. `リソースパック生成` を押す

`file` モードは、1 ファイルに複数 mod 分の翻訳データが入っていても自動探索できます。

複数 namespace の mod では、抽出結果が bundle JSON になることがあります。その場合も同じで、JSON 全体の値だけを翻訳すればそのまま使えます。

また、既存の `target_locale` が部分的に入っている mod では、`cancel_if_target_locale_exists = true` のままなら未翻訳分だけが抽出されます。戻す時も既存訳を残したまま不足分だけ補完できます。

### AI モードを使って一気に翻訳する

この方法は API 設定が必要ですが、抽出から翻訳、pack 化まで一気に進められます。

1. `[api]` を設定する
2. `AI` モードを選ぶ
3. 必要なら `translation.custom_prompt` に作品用語ルールを書く
4. `リソースパック生成` を押す

## 7. 元 lang を取り出す

GUI から行うのが最も簡単です。

GUI で設定できる項目:

- 保存先ファイル
- locale 優先順
- namespace 指定
- クリップボードへも入れるか、ファイルだけにするか

`file` モードでは常にファイル保存のみになり、この項目は自動で固定されます。

複数 namespace がある mod では、抽出結果は bundle JSON になります。

- `file` モードではそのまま使えます
- `clipboard` モードでも、その bundle JSON の値だけ翻訳すれば mod 全体に対応できます

`translation.cancel_if_target_locale_exists = true` の場合:

- 既に十分に翻訳されている namespace は抽出対象から外れます
- 一部だけ未翻訳の namespace は、未翻訳分だけ JSON に出ます

### CUI で抽出

```bash
python3 -m babel_breaker_app --extract-lang "/path/to/SomeMod.jar"
```

短縮形:

```bash
python3 -m babel_breaker_app -x "/path/to/SomeMod.jar"
```

よく使うオプション:

- `-o`, `--extract-output`
- `-c`, `--extract-no-clipboard`
- `-l`, `--extract-locale`
- `-n`, `--extract-namespace`

例:

```bash
python3 -m babel_breaker_app -x "/path/to/SomeMod.jar" -o "/path/to/source_lang.json"
```

## 8. CUI の使い方

GUI を追加しても、CUI はそのまま使えます。

### GUI 起動

```bash
python3 -m babel_breaker_app --gui
```

### 通常実行

```bash
python3 -m babel_breaker_app "/path/to/SomeMod.jar"
```

### 設定ファイルだけで実行

```bash
python3 -m babel_breaker_app
```

### `input/` 自動探索を使う

`general.input_path` が空で、CLI 引数も無い場合は `input_scan` 設定を使います。

```text
input/
└─ SomeMod.jar
```

```bash
python3 -m babel_breaker_app
```

## 9. 必要なもの

### 必須

- Python 3.10 以上

### 推奨

- Python 3.11 以上
- `Pillow`
- `tomli`

インストール例:

### Mac

```bash
python3 -m pip install pillow tomli
```

### Windows

```bash
py -m pip install pillow tomli
```

## 10. 設定ファイル

普段使う設定は `babel_breaker_app/config.toml` に保存されます。

GUI で全部編集できますが、手で編集しても構いません。

主に触る設定:

```toml
[general]
input_path = ""
output_dir = "_babel_breaker_output"

[translation]
mode = "clipboard"
target_locale = "ja_jp"
cancel_if_target_locale_exists = true
target_language_name = "Japanese (日本語)"
enforce_consistent_terms = true
custom_prompt = ""

[file_mode]
translation_files_text = ""
inline_translation_text = ""

[api]
style = "gemini_generate_content"
model = "gemini-2.5-flash"
api_key_env = "GEMINI_API_KEY"
```

`cancel_if_target_locale_exists = true` の意味:

- 既存の `target_locale` が十分に埋まっている namespace は上書きしません
- 既存の `target_locale` が一部だけ未翻訳なら、その不足分だけ補完します
- mod 全体で補完する必要が無い時だけ、中止します

設定ファイルが無い時に生成される内容は、説明コメント付きです。

## 11. AI 利用時の注意

AI モードでは `[api]` の設定が必要です。

例:

```toml
[api]
style = "openai_responses"
model = "gpt-5-mini"
url = ""
api_key_env = "OPENAI_API_KEY"
api_key_direct = ""
timeout = 180
temperature = 0.2
max_output_tokens = 8192
anthropic_version = "2023-06-01"
```

API キーは、できるだけ環境変数で渡すことを推奨します。

### Mac

```bash
export OPENAI_API_KEY="your_api_key"
```

### Windows PowerShell

```powershell
$env:OPENAI_API_KEY="your_api_key"
```

## 12. トラブルシュート

### `config.toml` が無いと言われる

- GUI を起動して `設定を保存` を押す
- CUI で `python3 -m babel_breaker_app` を 1 回実行する

### GUI が起動しない

- Python 3.10 以上か確認する
- `python3 -m babel_breaker_app --gui` を試す
- 自動で開かなければ、表示された `http://127.0.0.1:...` を手で開く
- それでもだめなら、ターミナルのログを確認する

### GUI のボタンやドラッグ＆ドロップが反応しない

- ブラウザタブを閉じて開き直す
- ハードリロードする
- 古い GUI タブを開いたままにしていないか確認する

### 一部しか翻訳されない

旧バージョンでは 1 つの `lang` しか見ないことがありました。現在は複数 namespace / 複数 source lang をまとめて処理します。

それでも一部が原文のままなら、主な原因は次です。

- AI モードでプレースホルダ不一致が起き、原文維持に戻された
- `clipboard` / `file` モードで bundle JSON の一部 namespace が欠けている
- mod 側の `target_locale` がすでに十分に埋まっていて、安全装置でその namespace が外れている

### `clipboard` モードで失敗する

- クリップボードの JSON がその mod に対応しているか確認する
- 値だけ翻訳し、キーを変えていないか確認する
- 複数 namespace mod では bundle JSON 全体を翻訳しているか確認する

### `file` モードで失敗する

- `file モード入力` に指定したファイルが実在するか確認する
- 1 ファイルに複数 mod 分の辞書を入れる場合は、各辞書が分かれているか確認する
- 値だけ翻訳し、キーを変えていないか確認する

## 13. プロジェクト情報

- GUI と CUI は同じ本体処理を呼んでいます
- GUI 下部の `© IGNORANZ PROJECT` は X へのリンクです
- GUI 下部の `GitHub` はこのリポジトリへのリンクです

### Links

- X: https://x.com/IGNORANZ_P
- GitHub: https://github.com/IGNORANZ-PROJECT/BabelBreaker

## 14. License

This project is licensed under the MIT License.

- License text: [LICENSE](./LICENSE)
- Copyright: `© 2026 IGNORANZ PROJECT`
