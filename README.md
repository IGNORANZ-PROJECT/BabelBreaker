# Babel Breaker

Babel Breaker は、Minecraft mod の lang ファイルを翻訳し、そのまま使えるリソースパック ZIP を作るツールです。

GUI と CUI の両方に対応しています。

- GUI で設定を編集できる
- mod の `.jar` / `.zip` / 解凍済みフォルダを直接読める
- 元 lang JSON を自動で取り出せる
- クリップボード翻訳でも AI 翻訳でも使える
- Mac / Windows の両方を想定している

## 1. まず何ができるのか

- mod の中から翻訳元 lang を自動検出する
- 元 lang JSON をクリップボードへコピーする
- 元 lang JSON を `.json` ファイルとして保存する
- 翻訳済み JSON を使ってリソースパック ZIP を作る
- AI を使って値だけ翻訳し、そのまま ZIP を作る
- GUI で `babel_breaker_app/config.toml` の全設定を編集する

重要なのは、Minecraft の言語ファイルではキーを変えてはいけないことです。

- キー: 内部 ID
- 値: ゲーム内に表示される文章

Babel Breaker は値だけを翻訳し、キーは維持します。

## 2. いちばん簡単な始め方

### Mac

1. Python 3.10 以上を入れる
2. このフォルダを開く
3. `launch_gui.command` を実行する

もし `launch_gui.command` が開けない場合は、ターミナルで次を実行してください。

```bash
python3 -m babel_breaker_app --gui
```

`--gui` は Tk に依存しないブラウザ GUI を開くので、Mac の `tkinter` が壊れている環境でも使えます。

### Windows

1. Python 3.10 以上を入れる
2. このフォルダを開く
3. `launch_gui.bat` を実行する

うまく開かない場合は、コマンドプロンプトまたは PowerShell で次を実行してください。

```bash
py -m babel_breaker_app --gui
```

## 3. フォルダ構成

ルートには起動用ファイルだけを残し、本体コード・画像・設定は `babel_breaker_app/` にまとめています。`babel_breaker_app/config.toml` は無ければ作れます。

```text
BabelBreaker/
├─ launch_gui.command
├─ launch_gui.bat
├─ README.md
├─ babel_breaker_app/
│  ├─ __main__.py
│  ├─ config.toml
│  ├─ main.py
│  ├─ web_gui.py
│  ├─ gui_shared.py
│  └─ assets/
│     ├─ icon.png         ← リソースパック用アイコン
│     └─ favicon.png      ← ブラウザ GUI のタブアイコン
└─ _babel_breaker_output/ ← 自動作成
```

ルートには、まず使う `launch_gui.command` / `launch_gui.bat` と `README.md` が見えるようにしています。

`babel_breaker_app/config.toml` が無い場合:

- CUI で `python3 -m babel_breaker_app` を実行すると、コメント付きの見本を自動生成します
- GUI で「設定を保存」しても、説明付きの `babel_breaker_app/config.toml` を作成します

## 4. GUI の使い方

`--gui` はローカルのブラウザ GUI を起動します。ローカル URL が表示され、通常は自動でブラウザが開きます。ブラウザのタブアイコンには `babel_breaker_app/assets/favicon.png` を使います。

新しい GUI は、まずシンプルな操作だけを見せる構成です。

1. mod の `.jar` / `.zip` を画面にドラッグ＆ドロップする
2. `clipboard` か `AI` を選ぶ
3. `リソースパック生成` か `元 lang を取得` を押す

普段使わない設定は、`詳細設定を開く` を押すまで出ません。

複数ファイルをまとめて落とすこともできます。処理中に追加したファイルはキューに積まれ、残りが順番に処理されます。

### GUI でできること

- mod JAR / ZIP のドラッグ＆ドロップ入力
- 複数 mod のキュー投入
- 処理中の追加キュー
- ボタンからのファイル選択 / フォルダ選択
- `リソースパック生成`
  今の設定で本番処理を実行します
- `元 lang を取得`
  mod の中から翻訳元 lang を自動抽出します
- `設定を保存`
  GUI の内容を `babel_breaker_app/config.toml` に保存します
- `設定フォルダを開く`
  設定ファイルの場所を開きます
- `出力先を開く`
  出力フォルダを開きます
- `README を開く`
  この説明を開きます

### 詳細設定に入っているもの

- 出力フォルダ
- locale
- AI 追加指示
- API 設定
- pack 設定
- clipboard 補助設定
- 抽出時の保存先や namespace 指定
- ログ表示

### GUI での基本運用

- 普段は `.jar` / `.zip` をドロップしてキューへ入れる
- キューに複数入れたまま `リソースパック生成` を押す
- 途中で別の mod を追加しても、残りへ順番に積まれる
- 不要な項目はキュー一覧から削除できる

## 5. 2 つの翻訳モード

### `clipboard` モード

自分で翻訳済み JSON を用意するモードです。

流れ:

1. `元 lang を取得` で元 JSON を抜き出す
2. JSON の値だけ翻訳する
3. 翻訳済み JSON をクリップボードへコピーする
4. `translation.mode = "clipboard"` にして生成する

特徴:

- 自分で翻訳内容を厳密に調整しやすい
- 別の AI、翻訳サービス、手動翻訳と組み合わせやすい
- キー照合を行うので、足りないキーや余計なキーがある JSON はそのまま通りません

さらに、clipboard モードでは次の補助があります。

- クリップボードにこの mod 用の JSON が無い
- JSON が壊れている
- キーが合わない

この場合、既定では対応する元 lang JSON を自動取得してクリップボードへ入れ直します。

自動取得を切りたい場合:

- GUI の `詳細設定` 内でオフにする
- CUI なら `-a` または `--no-auto-fetch-source-lang`

### `ai` モード

元 lang を自動検出して AI で値だけ翻訳するモードです。

特徴:

- 翻訳から pack 化まで一気に進められる
- 同じ原文には同じ訳語を優先する
- mod の世界観、口調、固有名詞を守る方向でプロンプトを作る
- アニメやゲーム原作 mod では既存作品の用語を優先させやすい

AI モードでは、次の設定が重要です。

- `translation.enforce_consistent_terms = true`
  同じ原文に対して同じ訳語を使いやすくします
- `translation.custom_prompt`
  作品ごとの用語ルールを足せます

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

## 6. 元 lang JSON を取り出す

抽出は GUI から行うのがいちばん簡単です。

GUI では次を設定できます。

- 保存先ファイル
- locale 優先順
- namespace 指定
- クリップボードへも入れるか、ファイルだけにするか

### CUI で抽出する場合

```bash
python3 -m babel_breaker_app --extract-lang "/path/to/SomeMod.jar"
```

短縮形:

```bash
python3 -m babel_breaker_app -x "/path/to/SomeMod.jar"
```

よく使うオプション:

- `-o`, `--extract-output`
  抽出 JSON をファイル保存する
- `-c`, `--extract-no-clipboard`
  クリップボードへ入れず、ファイルだけ保存する
- `-l`, `--extract-locale`
  優先 locale を指定する
- `-n`, `--extract-namespace`
  優先 namespace を指定する

例:

```bash
python3 -m babel_breaker_app -x "/path/to/SomeMod.jar" -o "/path/to/source_lang.json"
```

## 7. CUI もそのまま使える

GUI を追加しても、従来の CUI は残しています。

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

`general.input_path` が空で、CLI 引数も無い場合は `input_scan` 設定が使われます。

```text
input/
└─ SomeMod.jar
```

その後:

```bash
python3 -m babel_breaker_app
```

## 8. 必要なもの

### 必須

- Python 3.10 以上

### 推奨

- Python 3.11 以上
  `tomllib` が標準で使えるため設定読込が楽です
- `Pillow`
  PNG 以外の画像を `pack.png` に変換したい場合に便利です
- `tomli`
  Python 3.10 系で必要になることがあります

インストール例:

### Mac

```bash
python3 -m pip install pillow tomli
```

### Windows

```bash
py -m pip install pillow tomli
```

### GUI の実装について

GUI はブラウザ版に統一しています。

- `python3 -m babel_breaker_app --gui`
  最も安定する GUI です

Mac / Windows のどちらでも `--gui` を使ってください。

## 9. 設定ファイルについて

`babel_breaker_app/config.toml` は普段使う設定を保存するファイルです。

GUI で全部編集できますが、手で編集しても構いません。

主に触る設定:

```toml
[general]
input_path = ""
output_dir = "_babel_breaker_output"

[translation]
mode = "clipboard"
target_locale = "ja_jp"
target_language_name = "Japanese (日本語)"
enforce_consistent_terms = true
custom_prompt = ""

[api]
style = "gemini_generate_content"
model = "gemini-2.5-flash"
api_key_env = "GEMINI_API_KEY"
```

設定ファイルが無い時に生成される内容は、説明コメント付きです。

## 10. AI 利用時の注意

API モードでは `[api]` の設定が必要です。

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

## 11. トラブル時

### `babel_breaker_app/config.toml` が無いと言われる

次のどちらかを行ってください。

- GUI を起動して `設定を保存` を押す
- CUI で `python3 -m babel_breaker_app` を 1 回実行する

### GUI が起動しない

- Python 3.10 以上か確認する
- まずはターミナルから `python3 -m babel_breaker_app --gui` を試す
- ブラウザが自動で開かない場合は、表示された `http://127.0.0.1:...` を手で開く
- それでも起動しない場合は、そのままのログを確認する

### AI モードで API エラーになる

- API キー環境変数名が正しいか確認する
- `api.style` と `api.model` の組み合わせを確認する
- OpenAI 互換 API の場合は `api.url` を確認する

### clipboard モードで失敗する

- クリップボードの JSON がその mod に対応しているか確認する
- 値だけ翻訳し、キーを変えていないか確認する
- 既定では元 lang JSON の自動取得が動くので、ログも確認する

## 12. 補足

- いま使うなら `python3 -m babel_breaker_app --extract-lang` を使えば十分です
- GUI と CUI は同じ本体処理を呼んでいます
