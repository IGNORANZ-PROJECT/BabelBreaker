#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
extract_lang_json.py
============================================================

この補助ツールは、Minecraft mod の .jar / .zip / 解凍済みフォルダから
lang ファイルを取り出して、翻訳しやすい JSON として扱うためのものです。

------------------------------------------------------------
このツールがやること
------------------------------------------------------------

1. mod の中から lang ファイルを自動で探す
2. できれば en_us、次に en_gb のような優先順で 1 つ選ぶ
3. 旧 .lang 形式でも JSON オブジェクトに変換する
4. 結果をクリップボードにコピーする
5. 必要なら .json ファイルとして保存する

------------------------------------------------------------
よくある使い方
------------------------------------------------------------

1. 元の英語 lang を取り出してクリップボードへコピー
   python3 extract_lang_json.py "/path/to/mod.jar"

2. クリップボードの JSON を翻訳サービスや AI に貼る
   - キーは絶対に変えない
   - 値だけ翻訳する

3. 翻訳済み JSON をクリップボードへ戻す

4. Babel Breaker 本体を clipboard モードで実行
   python3 babel_breaker.py "/path/to/mod.jar"

------------------------------------------------------------
ファイルにも保存したい場合
------------------------------------------------------------

  python3 extract_lang_json.py "/path/to/mod.jar" --output extracted_en_us.json

この場合は、
- クリップボードにもコピーする
- 同じ内容をファイルにも保存する

に両対応します。

ファイルだけ欲しい場合は、

  python3 extract_lang_json.py "/path/to/mod.jar" --output extracted_en_us.json --no-clipboard

のようにしてください。

------------------------------------------------------------
補足
------------------------------------------------------------

- namespace を手動で指定したい時は --namespace を使えます
- locale の優先順を変えたい時は --locale を複数回指定できます
- config.toml は不要です
- このツールは翻訳しません。元 JSON を取り出すだけです
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from babel_breaker import (
    choose_best_lang_source,
    detect_mod_info,
    discover_lang_sources,
    load_lang_source_dict,
    unpack_if_needed,
)


DEFAULT_LOCALE_PRIORITY = ["en_us", "en_gb"]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def normalize_locale_priority(values: list[str]) -> list[str]:
    locales: list[str] = []
    for raw in values:
        for item in raw.split(","):
            locale = item.strip().lower()
            if locale and locale not in locales:
                locales.append(locale)
    return locales or DEFAULT_LOCALE_PRIORITY[:]


def choose_namespace(mod_root: Path, explicit_namespace: str | None) -> str | None:
    if explicit_namespace:
        return explicit_namespace.strip() or None

    # メタデータが壊れていても lang 抽出だけは続けられるように、ここでは警告止まりにします。
    try:
        return detect_mod_info(mod_root).mod_id
    except Exception as e:
        eprint(f"[WARN] mod メタデータを読めなかったため namespace 自動推定なしで続行します: {e}")
        return None


def choose_lang_source(mod_root: Path, namespace: str | None, locale_priority: list[str]):
    sources = discover_lang_sources(mod_root)
    if not sources:
        raise RuntimeError("lang ファイルが見つかりませんでした。assets/<namespace>/lang/ を確認してください。")

    # Babel Breaker 本体と同じ優先順位で、もっとも扱いやすい source を 1 つ選びます。
    source = choose_best_lang_source(
        sources=sources,
        preferred_modid=namespace,
        source_priority=locale_priority,
        target_locale="",
    )
    if source is None:
        raise RuntimeError("使える lang ファイルが見つかりませんでした。")
    return source


def build_json_text(data: dict[str, str]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def copy_text_to_clipboard(text: str) -> str:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return "pbcopy"

    if sys.platform.startswith("win"):
        subprocess.run(["cmd", "/c", "clip"], input=text, text=True, check=True)
        return "clip"

    try:
        import tkinter as tk
    except Exception as e:
        raise RuntimeError(
            "クリップボードへコピーできませんでした。--output を付けてファイル保存するか、tkinter が使える Python を使ってください。"
        ) from e

    root = tk.Tk()
    root.withdraw()
    try:
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
    finally:
        root.destroy()
    return "tkinter"


def write_output_file(path: Path, text: str) -> Path:
    output_path = path.expanduser()
    if output_path.exists() and output_path.is_dir():
        raise RuntimeError(f"--output にはファイルパスを指定してください。ディレクトリは指定できません: {output_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text, encoding="utf-8", newline="\n")
    return output_path.resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Minecraft mod の lang を抽出し、JSON をクリップボードやファイルへ出力します。"
    )
    parser.add_argument(
        "input_path",
        help="mod の .jar / .zip / 解凍済みフォルダを指定します。",
    )
    parser.add_argument(
        "--locale",
        action="append",
        default=[],
        help="優先したい locale を指定します。複数回指定可。例: --locale en_us --locale en_gb",
    )
    parser.add_argument(
        "--namespace",
        default="",
        help="優先したい namespace(mod_id) を指定します。未指定なら mod メタデータから自動推定します。",
    )
    parser.add_argument(
        "--output",
        default="",
        help="抽出した JSON を保存するファイルパスです。指定するとファイルにも保存します。",
    )
    parser.add_argument(
        "--no-clipboard",
        action="store_true",
        help="クリップボードへのコピーを行わず、画面表示と --output のみを使います。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    input_path = Path(args.input_path).expanduser()
    if not input_path.exists():
        eprint(f"[ERROR] 入力が見つかりません: {input_path}")
        return 1

    locale_priority = normalize_locale_priority(args.locale)
    namespace = args.namespace.strip() or None
    output_path = Path(args.output) if args.output.strip() else None

    if args.no_clipboard and output_path is None:
        eprint("[ERROR] --no-clipboard を使う場合は、あわせて --output を指定してください。")
        return 1

    try:
        mod_root, temp_dir = unpack_if_needed(input_path)
        try:
            preferred_namespace = choose_namespace(mod_root, namespace)
            source = choose_lang_source(mod_root, preferred_namespace, locale_priority)
            source_map = load_lang_source_dict(source)
            json_text = build_json_text(source_map)
        finally:
            if temp_dir is not None:
                temp_dir.cleanup()
    except Exception as e:
        eprint(f"[ERROR] {e}")
        return 1

    print(f"[OK] 抽出元: {source.path}")
    print(f"[OK] namespace: {source.namespace}")
    print(f"[OK] locale: {source.locale}")
    print(f"[OK] キー数: {len(source_map)}")

    if output_path is not None:
        saved_path = write_output_file(output_path, json_text)
        print(f"[OK] ファイル保存: {saved_path}")

    if not args.no_clipboard:
        try:
            method = copy_text_to_clipboard(json_text)
            print(f"[OK] クリップボードへコピーしました: {method}")
        except Exception as e:
            if output_path is None:
                eprint(f"[ERROR] クリップボードへのコピーに失敗しました: {e}")
                return 1
            eprint(f"[WARN] クリップボードへのコピーに失敗しましたが、ファイル保存は完了しています: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
