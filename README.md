# Babel Breaker

Babel Breaker は、Minecraft mod の `lang` を翻訳し、そのまま使えるリソースパック ZIP を作るツールです。

このツールで重要なのは、`lang` のキーを変えないことです。

- キー: 内部 ID
- 値: ゲーム内に表示される文章

Babel Breaker は、値だけを翻訳してキーは維持します。

## できること

- mod の `.jar` / `.zip` / 解凍済みフォルダをそのまま読める
- 元 `lang` を自動で取り出せる
- 翻訳済み JSON からリソースパック ZIP を作れる
- AI を使って翻訳から ZIP 作成まで一気に進められる
- 複数 namespace / 複数 source lang の mod に対応
- GUI と CUI の両方で使える

## 最初の使い方

### Mac

1. このフォルダを開く
2. `launch_gui.command` を実行する
3. 初回セットアップが終わるまで待つ

### Windows

1. このフォルダを開く
2. `launch_gui.bat` を実行する
3. 初回セットアップが終わるまで待つ

同梱ランチャーが自動で行うこと:

- `uv` のローカル配置
- Python 3.12 のローカル配置
- 必要パッケージのインストール
- GUI の起動

つまり、Python を手で入れる必要はありません。

初回起動時に必要なもの:

- インターネット接続
- 少しの待ち時間

## GUI の流れ

1. mod の `.jar` / `.zip` を入れる
2. 翻訳方法を選ぶ
3. 必要なら詳細設定を開く
4. `元 lang を取得` または `リソースパック生成` を押す

普段は GUI だけで足ります。

## 翻訳方法の違い

### `clipboard`

1 件ずつ手早く戻したい時向けです。

- `元 lang を取得` で元 JSON を取り出す
- 外部 AI や手作業で値だけ翻訳する
- 翻訳済み JSON をクリップボードへコピーする
- `リソースパック生成` を押す

### `file`

複数 mod をまとめて処理したい時向けです。

- 翻訳済み `.json` / `.txt` を使える
- 直接貼り付けたテキストも使える
- `AI` と同じくキュー処理に向いている

### `AI`

抽出から翻訳、ZIP 作成まで一気に進めたい時向けです。

- `[api]` の設定が必要
- API キーは環境変数で渡すのがおすすめ
- `translation.custom_prompt` で用語ルールを追加できる

## いちばん簡単な使い分け

### API を使わない

1. GUI を開く
2. mod を入れる
3. `元 lang を取得` を押す
4. 出てきた JSON を外部 AI に渡す
5. 戻ってきた JSON を `clipboard` か `file` で使う
6. `リソースパック生成` を押す

外部 AI への依頼文の例:

```text
この JSON は Minecraft mod の lang です。
キーは絶対に変更しないでください。
値だけ自然な日本語に翻訳してください。
プレースホルダ、改行、色コードは維持してください。
JSON 以外は返さないでください。
```

### API を使う

1. `babel_breaker_app/config.toml` の `[api]` を設定する
2. GUI で mod を入れる
3. `AI` を選ぶ
4. `リソースパック生成` を押す

## 設定ファイル

設定は `babel_breaker_app/config.toml` に保存されます。

主に触る項目:

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
```

`config.toml` が無い場合:

- `launch_gui.command` / `launch_gui.bat` を 1 回実行すると自動生成される
- GUI の `設定を保存` でも作成できる

## CUI で使う

GUI を使わずに実行したい場合の最小例です。

### GUI を CUI から起動

```bash
python3 -m babel_breaker_app --gui
```

### 通常実行

```bash
python3 -m babel_breaker_app "/path/to/SomeMod.jar"
```

### 元 `lang` を取り出す

```bash
python3 -m babel_breaker_app --extract-lang "/path/to/SomeMod.jar"
```

## フォルダ構成

```text
BabelBreaker/
├─ launch_gui.command
├─ launch_gui.bat
├─ launch_gui.ps1
├─ requirements-launcher.txt
├─ README.md
├─ LICENSE
├─ babel_breaker_app/
├─ .babel_breaker_runtime/  ← 初回起動で自動作成
├─ .venv/                   ← 初回起動で自動作成
└─ _babel_breaker_output/   ← 出力先
```

## よくある問題

### GUI が開かない

- まず `launch_gui.command` / `launch_gui.bat` をもう一度実行する
- 初回起動なら、ダウンロード完了まで待つ
- 自動でブラウザが開かない場合は、表示された `http://127.0.0.1:...` を手で開く

### `config.toml` が無い

- GUI で `設定を保存` を押す
- それでも無ければランチャーを 1 回実行する

### 一部しか翻訳されない

- キーを変更していないか確認する
- `clipboard` / `file` では、その mod に対応する JSON を使っているか確認する
- 既に `target_locale` が十分に入っている namespace は安全のためスキップされることがある

## Links

- X: https://x.com/IGNORANZ_P
- GitHub: https://github.com/IGNORANZ-PROJECT/BabelBreaker

## License

This project is licensed under the MIT License.

- License text: [LICENSE](./LICENSE)
- Copyright: `© 2026 IGNORANZ PROJECT`