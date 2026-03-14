# Babel Breaker

Babel Breaker は、Minecraft の mod の言語ファイルを翻訳し、  
**そのまま使えるリソースパック ZIP** を自動生成するツールです。

- `.jar` ファイルをそのまま指定できます
- 解凍済みの mod フォルダでも使えます
- AI で自動翻訳もできます
- すでに翻訳済みの JSON を使うこともできます
- **Mac / Windows のどちらでも使えます**
- **GitHub やターミナルに詳しくなくても使えるように設計されています**

---

## これは何をするツール？

Minecraft の mod には、文字表示用の言語ファイルがあります。  
Babel Breaker は、その言語ファイルを使って、

- 日本語化したり
- 他の言語に翻訳したり
- リソースパックとしてまとめたり

できます。

作られた ZIP は、Minecraft の `resourcepacks` フォルダに入れるだけで使えます。

---

## できること

- mod の `.jar` をそのまま読み込む
- mod の中の言語ファイルを自動で探す
- AI を使って翻訳する
- すでに翻訳済みの JSON をクリップボードから読む
- リソースパック ZIP を自動で作る
- 必要なら展開フォルダも残せる

---

## 超重要な注意

Minecraft の言語ファイルは、

- **キー** = 内部ID
- **値** = 実際に表示される文章

です。

**キーを翻訳すると壊れます。**

Babel Breaker は、  
**キーはそのまま / 値だけ翻訳**  
するように作られています。

---

## 必要なもの

### 必須
- Python 3.10 以上
- `babel_breaker.py`
- `config.toml`

### あると便利
- `icon.png`
  - リソースパックの見た目アイコンになります
- `Pillow`
  - PNG 以外の画像を `pack.png` に変換したい時に便利
- `tomli`
  - Python 3.10 系で必要になることがあります

---

## まずはフォルダを作る

最初に、作業用フォルダを 1 つ作ってください。  
名前は何でも大丈夫です。ここでは例として `BabelBreaker` にします。

中身はこんな感じにしてください。

```text
BabelBreaker/
├─ babel_breaker.py
├─ config.toml
├─ README.md
├─ icon.png        ← あれば便利
├─ input/          ← 入力用（任意）
└─ _babel_breaker_output/  ← 出力先（自動作成）
```

---

## Python を入れる

### Windows
1. 公式の Python 配布ページを開く
2. Python 3.10 以上をインストールする
3. インストール時に **Add Python to PATH** にチェックを入れる
4. 完了後、**コマンドプロンプト** または **PowerShell** を開く
5. 次を入力

```bash
python --version
```

または

```bash
py --version
```

バージョンが表示されれば OK です。

### Mac
1. **ターミナル** を開く
2. 次を入力

```bash
python3 --version
```

Python 3.10 以上が出ればそのまま使えます。

もし入っていなければ、Python を公式サイトなどからインストールしてください。

---

## ターミナルって何？

このツールは、  
**黒い画面に文字を打って実行するタイプ**  
です。

でも、やることはほとんど決まっています。

### Windows なら
- コマンドプロンプト
- PowerShell

のどちらでも大丈夫です。

### Mac なら
- ターミナル

を使います。

---

## フォルダを開く方法

Babel Breaker のフォルダへ移動する必要があります。

### Windows
BabelBreaker フォルダを開いて、  
アドレスバーに `cmd` と入力して Enter を押すと、  
その場所でコマンドプロンプトを開けます。

または、PowerShell を開いてから次のように移動します。

```bash
cd "C:\Users\あなたの名前\Desktop\BabelBreaker"
```

### Mac
ターミナルを開いて、次のように移動します。

```bash
cd "/Users/あなたの名前/Desktop/BabelBreaker"
```

---

## 最初に入れておくと便利なもの

必要に応じて、以下を入れてください。

### Mac / Windows 共通
```bash
pip install pillow tomli
```

Mac で `pip` が動かない場合は、

```bash
python3 -m pip install pillow tomli
```

Windows で `pip` が動かない場合は、

```bash
py -m pip install pillow tomli
```

---

## `config.toml` とは？

`config.toml` は、  
**普段使う設定を保存しておくファイル** です。

これがあるおかげで、毎回長いコマンドを書かなくて済みます。

たとえば、

- どの API を使うか
- 翻訳先の言語
- ZIP だけ作るか
- 展開フォルダも残すか
- 入力ファイルの場所

などを、あらかじめ決めておけます。

---

## いちばん簡単な使い方

### 方法1: `config.toml` に入力先を書いて実行
`config.toml` の `input_path` に mod の `.jar` の場所を書きます。

例:

```toml
[general]
input_path = "C:/Users/you/Downloads/SomeMod.jar"
```

または Mac なら:

```toml
[general]
input_path = "/Users/you/Downloads/SomeMod.jar"
```

その後、実行します。

#### Windows
```bash
python babel_breaker.py
```

または

```bash
py babel_breaker.py
```

#### Mac
```bash
python3 babel_breaker.py
```

---

### 方法2: 実行時に `.jar` を1回だけ指定
`config.toml` に入力先を書きたくない場合は、実行時に渡せます。

#### Windows
```bash
python babel_breaker.py "C:\Users\you\Downloads\SomeMod.jar"
```

または

```bash
py babel_breaker.py "C:\Users\you\Downloads\SomeMod.jar"
```

#### Mac
```bash
python3 babel_breaker.py "/Users/you/Downloads/SomeMod.jar"
```

---

### 方法3: input フォルダに入れて実行
`config.toml` の `input_path` が空なら、  
`input/` フォルダの中も自動で探します。

1. `input` フォルダに mod の `.jar` を入れる
2. 実行する

#### Windows
```bash
python babel_breaker.py
```

#### Mac
```bash
python3 babel_breaker.py
```

---

## 2つのモード

### 1. AI 翻訳モード
AI で翻訳して、そのままリソースパックを作ります。

`config.toml` のここをこうします。

```toml
[translation]
mode = "ai"
```

このモードでは、

- mod 内の言語ファイルを探す
- 値だけ翻訳する
- ZIP を作る

ところまで自動でやります。

### 2. クリップボードモード
すでに翻訳済みの JSON がある場合に使います。

`config.toml` のここをこうします。

```toml
[translation]
mode = "clipboard"
```

この場合は、

1. 翻訳済み JSON をコピー
2. 実行

で ZIP を作れます。

---

## AI を使う時の設定

`config.toml` の `[api]` を設定します。

たとえば Gemini を使うなら、だいたいこんな感じです。

```toml
[api]
style = "gemini_generate_content"
model = "gemini-2.5-flash"
url = ""
api_key_env = "GEMINI_API_KEY"
api_key_direct = ""
timeout = 180
temperature = 0.2
max_output_tokens = 8192
```

---

## APIキーの入れ方

### Gemini の場合

#### Windows PowerShell
```powershell
$env:GEMINI_API_KEY="あなたのAPIキー"
```

#### Windows コマンドプロンプト
```cmd
set GEMINI_API_KEY=あなたのAPIキー
```

#### Mac
```bash
export GEMINI_API_KEY="あなたのAPIキー"
```

### OpenAI の場合

#### Windows PowerShell
```powershell
$env:OPENAI_API_KEY="あなたのAPIキー"
```

#### Mac
```bash
export OPENAI_API_KEY="あなたのAPIキー"
```

### Anthropic の場合

#### Windows PowerShell
```powershell
$env:ANTHROPIC_API_KEY="あなたのAPIキー"
```

#### Mac
```bash
export ANTHROPIC_API_KEY="あなたのAPIキー"
```

---

## 対応している API

`config.toml` の `[api]` の `style` で選べます。

### Gemini ネイティブ API
```toml
style = "gemini_generate_content"
```

### Gemini OpenAI互換
```toml
style = "gemini_openai_chat"
```

### OpenAI Responses
```toml
style = "openai_responses"
```

### OpenAI Chat Completions
```toml
style = "openai_chat_completions"
```

### Anthropic Messages
```toml
style = "anthropic_messages"
```

### 汎用 OpenAI互換 Chat
```toml
style = "openai_compatible_chat"
```

### 汎用 OpenAI互換 Responses
```toml
style = "openai_compatible_responses"
```

---

## 翻訳先言語を変える

`config.toml` の `[translation]` を変更します。

たとえば日本語なら:

```toml
[translation]
target_locale = "ja_jp"
target_language_name = "Japanese (日本語)"
```

フランス語なら:

```toml
[translation]
target_locale = "fr_fr"
target_language_name = "French (Français)"
```

ドイツ語なら:

```toml
[translation]
target_locale = "de_de"
target_language_name = "German (Deutsch)"
```

すると、出力されるファイル名も変わります。

- `ja_jp.json`
- `fr_fr.json`
- `de_de.json`

のようになります。

---

## 出力されるもの

通常は ZIP だけ作られます。

```text
_babel_breaker_output/
└─ Babel_Breaker_ModName_1.2.3_ja_jp.zip
```

`keep_folder = true` にすると、展開フォルダも残ります。

```text
_babel_breaker_output/
├─ Babel_Breaker_ModName_1.2.3_ja_jp/
└─ Babel_Breaker_ModName_1.2.3_ja_jp.zip
```

---

## Minecraft で使う方法

作られた ZIP を、Minecraft の `resourcepacks` フォルダに入れてください。

### 例
- Windows:
  `.minecraft\resourcepacks`
- Mac:
  `~/Library/Application Support/minecraft/resourcepacks`

その後、Minecraft のリソースパック設定画面で有効化します。

---

## うまくいかない時

### 1. `config.toml` がない
最初の実行で自動生成されます。  
生成されたら、その中身を確認してください。

### 2. APIキーが見つからない
環境変数が設定されていない可能性があります。  
もう一度 API キーを入れてから実行してください。

### 3. icon がない
無くても動くことが多いですが、pack.png は付きません。  
`icon.png` を `babel_breaker.py` と同じフォルダに置いてください。

### 4. Python が見つからない
Windows なら `py` を試してください。

```bash
py babel_breaker.py
```

Mac なら `python3` を使ってください。

```bash
python3 babel_breaker.py
```

### 5. 翻訳が変
モデルや API を変えると改善することがあります。  
また、専門用語の多い mod は、AI より手動調整の方が安定する場合があります。

---

## いちばんおすすめの使い方

初心者向けには、まずこれです。

1. `config.toml` の `translation.mode = "ai"` にする
2. `style = "gemini_generate_content"` にする
3. APIキーを設定する
4. `input` フォルダに mod の `.jar` を入れる
5. 実行する

### Windows
```bash
py babel_breaker.py
```

### Mac
```bash
python3 babel_breaker.py
```

これが一番ラクです。

---

## 免責事項

このツールの使用は **自己責任** です。  
翻訳結果、生成物、導入による不具合、データ損失、互換性問題、配布トラブルなどについて、開発元は責任を負いません。

mod の翻訳公開や再配布を行う場合は、**元 mod のライセンスや配布条件**を必ず確認してください。

---

## ライセンス

MIT License

Copyright (c) IGNORANZ PROJECT

詳細は `LICENSE` ファイルを用意して記載してください。

---

## 開発元

©IGNORANZ PROJECT
