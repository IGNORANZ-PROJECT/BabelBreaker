#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Babel Breaker
============================================================

これは Minecraft mod の lang ファイルを翻訳し、
そのまま使えるリソースパック ZIP を作るツールです。

------------------------------------------------------------
使い方
------------------------------------------------------------

1. 最初の準備
   - `babel_breaker_app/config.toml` を調整する
   - 必要なら babel_breaker_app/assets/ 内の画像を差し替える
   - 必要なら API キーを環境変数に入れる

2. いちばん簡単な実行
   launch_gui.command / launch_gui.bat

3. Python を手で使う場合
   python3 -m babel_breaker_app

4. jar を直接指定
   python3 -m babel_breaker_app "/path/to/mod.jar"

5. 解凍済みフォルダを指定
   python3 -m babel_breaker_app "/path/to/unpacked_mod"

------------------------------------------------------------
モード
------------------------------------------------------------

A. clipboard モード
   - config.toml の translation.mode = "clipboard"
   - すでに翻訳済みの JSON をクリップボードから読む
   - それを <target_locale>.json として pack 化する

B. file モード
   - config.toml の translation.mode = "file"
   - 翻訳済み JSON / TXT ファイルや直接入力テキストを使う
   - 1 ファイルに複数 mod 分の辞書があっても自動で照合する

C. ai モード
   - config.toml の translation.mode = "ai"
   - 元の lang ファイルを自動で探す
   - AI API で「値だけ翻訳」する
   - リソースパックにする

------------------------------------------------------------
超重要
------------------------------------------------------------

Minecraft の lang JSON は
  キー = 内部 ID
  値   = 表示文
です。

つまり、キーを翻訳すると壊れます。
このツールは必ず「値だけ翻訳」します。
キーは絶対に変更しません。

------------------------------------------------------------
必要なもの
------------------------------------------------------------

- Mac / Windows なら同梱ランチャーで Python 不要
- babel_breaker_app/config.toml
- 入力 mod（jar のままでも、解凍済みでも可）

AI モードで追加:
- API キー

Python を手で使う場合にあると便利:
- Pillow
- tomli（Python 3.10系で tomllib が無い場合）

例:
  pip install pillow
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # type: ignore
    except ImportError:
        tomllib = None


def detect_project_root() -> Path:
    current = Path(__file__).resolve().parent
    for candidate in (current, *current.parents):
        if (candidate / "launch_gui.command").exists() and (candidate / "README.md").exists():
            return candidate
    return current


def get_assets_dir(script_dir: Path) -> Path:
    return script_dir / "babel_breaker_app" / "assets"


def get_config_path(script_dir: Path) -> Path:
    return script_dir / "babel_breaker_app" / "config.toml"


CONFIG_TEMPLATE = r'''# ============================================================
# Babel Breaker 設定ファイル
# ============================================================
#
# これは Minecraft mod の lang ファイルを翻訳し、
# resourcepacks に入れられる ZIP を自動生成するための設定です。
#
# このファイルは TOML 形式です。
# 行頭の # はコメントなので、自由に読んで大丈夫です。
#
# ------------------------------------------------------------
# まず最初にやること
# ------------------------------------------------------------
# 1. このファイルを保存する
# 2. 必要なら API キーを環境変数に入れる
# 3. 必要なら babel_breaker_app/assets/icon.png を差し替える
#    （無くても動きますが、pack.png は付きません）
# 4. `launch_gui.command` / `launch_gui.bat` を実行する
#    （Python を手で使うなら `python3 -m babel_breaker_app` でも可）
#
# ------------------------------------------------------------
# 実行方法
# ------------------------------------------------------------
#
# いちばん簡単:
#   launch_gui.command / launch_gui.bat
#
# Python を手で使う場合:
#   python3 -m babel_breaker_app
#
# jar を直接指定:
#   python3 -m babel_breaker_app "/path/to/mod.jar"
#
# 解凍済みフォルダを指定:
#   python3 -m babel_breaker_app "/path/to/unpacked_mod"
#
# 元 lang JSON を取り出したい時:
#   python3 -m babel_breaker_app --extract-lang "/path/to/mod.jar"
#
# この `babel_breaker_app/config.toml` で普段の設定を固定しておけば、
# 実行時に毎回たくさん指定する必要はありません。
#
# ============================================================


[general]
# 入力元のパスです。
# ここに .jar のパス、または解凍済み mod フォルダのパスを書けます。
#
# 例:
# input_path = "/Users/you/Downloads/SomeMod-1.20.1.jar"
# input_path = "/Users/you/work/SomeMod_unpacked"
#
# 空文字の場合:
# 1. 実行時の引数が優先されます
# 2. それも無い場合、project ルートの input/ を自動探索します
input_path = ""

# 出力先フォルダです。
# ZIP や、必要なら展開フォルダがここに出ます。
output_dir = "_babel_breaker_output"

# 一時フォルダなどの途中経過を詳しく表示したい場合は true
verbose = false


[translation]
# 翻訳モード:
# "clipboard" = すでに翻訳済み JSON をクリップボードから読む
# "file"      = 翻訳済み JSON / TXT ファイルや直接入力テキストを使う
# "ai"        = 元の lang ファイルを見つけて AI で自動翻訳する
mode = "clipboard"

# 出力先 locale です。
# これが最終的なファイル名にも使われます。
#
# 例:
# target_locale = "ja_jp" -> ja_jp.json
# target_locale = "fr_fr" -> fr_fr.json
# target_locale = "de_de" -> de_de.json
target_locale = "ja_jp"

# mod 側に target_locale の lang が既に入っていた場合の安全装置です。
# true のとき:
# - すでに十分に翻訳されている namespace は抽出や生成の対象から外します
# - 一部だけ未翻訳なら、既存訳を残しつつ不足分だけ補完します
# - mod 全体で補完する必要が無ければ、抽出や生成を中止します
# - ただし target_locale しか無い namespace は、その既存 lang を source fallback として使えます
cancel_if_target_locale_exists = true

# AI に説明するための人間向けの言語名です。
# 分かりやすく書いておくと翻訳の安定性が少し上がります。
#
# 例:
# "Japanese (日本語)"
# "French (Français)"
# "German (Deutsch)"
target_language_name = "Japanese (日本語)"

# AI が元の lang を探すとき、どの locale を優先するかです。
# 通常は英語が元なのでこのままで大丈夫です。
source_locale_priority = ["en_us", "en_gb"]

# 1回の API 呼び出しで翻訳するキー数です。
# 大きすぎると失敗しやすく、小さすぎると遅くなります。
# まずは 80〜150 くらいが無難です。
chunk_size = 120

# プレースホルダが壊れた行を原文に戻す安全装置
# true 推奨
repair_broken_placeholders = true

# 同じ原文に対して同じ訳語を使うためのメモリ機能です。
# true のとき、前のチャンクで確定した同一原文の訳語を次のチャンクでも優先します。
enforce_consistent_terms = true

# AI へ追加で渡すカスタム指示です。
# mod ごとの世界観、口調、固有名詞ルールなどを書けます。
# 空文字なら無効です。
#
# 例:
# custom_prompt = "魔法名はカタカナに統一。敬語は使わない。"
#
# 複数行にしたい場合:
# custom_prompt = """
# 公式日本語訳がある用語はそれを優先。
# 主人公陣営の技名は必ずカタカナ表記。
# UI は短く、会話文は自然な日本語にする。
# """
custom_prompt = ""


[file_mode]
# translation.mode = "file" の時に使う入力です。
#
# translation_files_text:
# 複数ファイルを指定する場合は 1 行 1 ファイルで並べます。
# .json / .txt 以外でも、テキストとして読めれば解析を試みます。
#
# 例:
# translation_files_text = """
# /Users/you/Desktop/mod_a_ja.json
# /Users/you/Desktop/mod_pack_notes.txt
# """
translation_files_text = ""

# GUI から直接貼り付ける翻訳データです。
# JSON 1 個でも、複数の JSON ブロックでも、mod ごとの辞書でも構いません。
#
# 例:
# inline_translation_text = """
# {
#   "mod_a": {
#     "item.example.name": "例のアイテム"
#   },
#   "mod_b": {
#     "block.example.machine": "例の機械"
#   }
# }
# """
inline_translation_text = ""


[pack]
# ZIP は常に作ります
create_zip = true

# 展開フォルダも残したい場合は true
# false なら ZIP のみ残します
keep_folder = false

# pack.png に使うアイコンのパスです。
# 空なら次の順で探します:
# 1. babel_breaker_app/assets/icon.png
# 2. project ルートの icon.png
# 3. icon.webp / icon.jpg / icon.jpeg / icon.bmp / icon.tif / icon.tiff
#
# 無くても pack は動きますが、見た目アイコンが付きません。
icon_path = ""

# パック名テンプレート
# 使える変数:
# {app_name}
# {mod_name}
# {mod_version}
# {mod_id}
# {target_locale}
pack_name_template = "{app_name}_{mod_name}_{mod_version}_{target_locale}"

# pack.mcmeta の description
# 使える変数:
# {app_name}
# {mod_name}
# {mod_version}
# {mod_id}
# {target_locale}
# {mc_version_expr}
description_template = "{app_name} | {mod_name} {mod_version} -> {target_locale} | MC {mc_version_expr}"


[minecraft]
# 空なら mod 側の情報から自動推定します
# 手動で固定したい場合だけ使ってください
#
# 例:
# mc_version = "1.20.1"
# mc_version = "1.20.x"
# mc_version = "1.21"
mc_version = ""


[api]
# 使う API スタイルです。
# 使える値:
#
# "gemini_generate_content"
#   Google Gemini ネイティブ API
#
# "gemini_openai_chat"
#   Gemini の OpenAI 互換 Chat Completions
#
# "openai_responses"
#   OpenAI Responses API
#
# "openai_chat_completions"
#   OpenAI Chat Completions API
#
# "anthropic_messages"
#   Anthropic Messages API
#
# "openai_compatible_chat"
#   OpenAI 互換の Chat Completions 形式 API
#
# "openai_compatible_responses"
#   OpenAI 互換の Responses 形式 API
style = "gemini_generate_content"

# モデル名
# Gemini 例:
# model = "gemini-2.5-flash"
#
# OpenAI 例:
# model = "gpt-5.4"
#
# Anthropic 例:
# model = "claude-sonnet-4-5"
model = "gemini-2.5-flash"

# API URL
# 空にすると、style に応じた安全な既定値を自動で使います。
#
# 例:
# Gemini native:
#   https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
#
# Gemini OpenAI compat:
#   https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
#
# OpenAI Responses:
#   https://api.openai.com/v1/responses
#
# OpenAI Chat:
#   https://api.openai.com/v1/chat/completions
#
# Anthropic:
#   https://api.anthropic.com/v1/messages
url = ""

# API キーを読む環境変数名
#
# 例:
# Gemini   -> GEMINI_API_KEY
# OpenAI   -> OPENAI_API_KEY
# Anthropic-> ANTHROPIC_API_KEY
api_key_env = "GEMINI_API_KEY"

# どうしても直書きしたい場合だけ使ってください。
# 通常は空のままで、環境変数を使う方が安全です。
api_key_direct = ""

# タイムアウト秒
timeout = 180

# 温度
# 翻訳用途では低めが無難です
temperature = 0.2

# 最大出力トークン
max_output_tokens = 8192

# Anthropic 用バージョンヘッダ
anthropic_version = "2023-06-01"


[clipboard]
# translation.mode = "clipboard" の時だけ使います。
# ここは説明用セクションです。
#
# 使い方:
# 0. 必要なら `python3 -m babel_breaker_app --extract-lang ...` で元 lang JSON を取り出す
# 1. 翻訳済み JSON 本文をコピー
# 2. `launch_gui.command` / `launch_gui.bat` を実行
#    （Python を手で使うなら `python3 -m babel_breaker_app`）
#
# JSON の形式はこうです:
# {
#   "item.example.name": "例のアイテム",
#   "block.example.machine": "例の機械"
# }
#
# 注意:
# - キーは変えない
# - 値だけ翻訳する
# - クリップボードにこの mod 用の JSON が無い時は、元 lang JSON を自動で取得できます
enabled = true

# クリップボードが空、JSON でない、またはキーが合わない時に
# mod に対応する元 lang JSON を自動でクリップボードへ入れます。
# 値だけ翻訳して再実行してください。
auto_fetch_source_when_missing = true


[input_scan]
# general.input_path が空で、実行時引数も無い時だけ使います。
# このフォルダを自動で探します。
folder = "input"

# このフォルダ内で、mod として扱えそうな .jar / .zip / フォルダを探します。
# 空フォルダや無関係なフォルダは無視します。
# false にすると自動探索しません。
enabled = true
'''


APP_NAME = "Babel Breaker"
DEFAULT_OUTPUT_ROOT = "_babel_breaker_output"
DEFAULT_ICON_BASENAME = "icon"
ICON_EXT_PRIORITY = [".png", ".webp", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]
ARCHIVE_EXTENSIONS = (".jar", ".zip")
LANG_FILE_EXTENSIONS = (".json", ".lang")
DEFAULT_SOURCE_LOCALE_PRIORITY = ["en_us", "en_gb"]
MOD_METADATA_PATHS = [
    "fabric.mod.json",
    "quilt.mod.json",
    "META-INF/mods.toml",
    "META-INF/neoforge.mods.toml",
    "META-INF/MANIFEST.MF",
]

CONFIG_SECTION_ORDER = [
    "general",
    "translation",
    "file_mode",
    "pack",
    "minecraft",
    "api",
    "clipboard",
    "input_scan",
]

CONFIG_KEY_ORDER = {
    "general": ["input_path", "output_dir", "verbose"],
    "translation": [
        "mode",
        "target_locale",
        "cancel_if_target_locale_exists",
        "target_language_name",
        "source_locale_priority",
        "chunk_size",
        "repair_broken_placeholders",
        "enforce_consistent_terms",
        "custom_prompt",
    ],
    "file_mode": [
        "translation_files_text",
        "inline_translation_text",
    ],
    "pack": [
        "create_zip",
        "keep_folder",
        "icon_path",
        "pack_name_template",
        "description_template",
    ],
    "minecraft": ["mc_version"],
    "api": [
        "style",
        "model",
        "url",
        "api_key_env",
        "api_key_direct",
        "timeout",
        "temperature",
        "max_output_tokens",
        "anthropic_version",
    ],
    "clipboard": ["enabled", "auto_fetch_source_when_missing"],
    "input_scan": ["folder", "enabled"],
}

PACK_FORMAT_RULES = [
    ((1, 20, 0), (1, 20, 1), 15),
    ((1, 20, 2), (1, 20, 2), 18),
    ((1, 20, 3), (1, 20, 4), 22),
    ((1, 20, 5), (1, 20, 6), 32),
    ((1, 21, 0), (1, 21, 3), 34),
    ((1, 21, 4), (1, 21, 4), 46),
    ((1, 21, 5), (1, 21, 8), 55),
]


@dataclass
class ModInfo:
    loader: str
    mod_id: str
    mod_name: str
    mod_version: str
    mc_version_expr: str | None
    source_file: Path | None


@dataclass
class LangSource:
    namespace: str
    locale: str
    path: Path
    ext: str  # ".json" or ".lang"


@dataclass
class RuntimeContext:
    script_dir: Path
    config_path: Path
    config: dict[str, Any]
    verbose: bool


@dataclass
class ExtractLangResult:
    entries: list["ExtractLangEntry"]
    json_text: str

    @property
    def source(self) -> LangSource:
        return self.entries[0].source

    @property
    def data(self) -> dict[str, str]:
        return self.entries[0].data


@dataclass
class ExtractLangEntry:
    source: LangSource
    data: dict[str, str]


@dataclass
class TranslationCandidate:
    label: str
    data: dict[str, str]
    namespace_hint: str | None = None


@dataclass
class TranslatedLangEntry:
    source: LangSource
    data: dict[str, str]


@dataclass
class TranslationSourcePlan:
    source: LangSource
    source_data: dict[str, str]
    pending_source_data: dict[str, str]
    existing_target_source: LangSource | None = None
    preserved_target_data: dict[str, str] = field(default_factory=dict)
    reused_source_key_count: int = 0
    source_is_target_locale_fallback: bool = False


class ClipboardSourceAutoFetched(Exception):
    def __init__(self, reason: str, result: ExtractLangResult, clipboard_method: str):
        super().__init__(reason)
        self.reason = reason
        self.result = result
        self.clipboard_method = clipboard_method


class TargetLocaleAlreadyExists(Exception):
    def __init__(self, target_locale: str, source: LangSource, action_label: str):
        self.target_locale = target_locale
        self.source = source
        self.action_label = action_label
        super().__init__(
            f"mod には既に {target_locale}.json があり、未翻訳の不足分も見つからないため、{action_label} をキャンセルしました: {source.path}"
        )


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def vprint(ctx: RuntimeContext, *args: object) -> None:
    if ctx.verbose:
        print(*args)


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def safe_fs_name(text: str) -> str:
    text = normalize_whitespace(text)
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = text.replace(" ", "_")
    return text[:180].strip("._") or "resource_pack"


def ensure_config_file(config_path: Path) -> None:
    if config_path.exists():
        return
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(CONFIG_TEMPLATE, encoding="utf-8", newline="\n")


def migrate_legacy_root_config(script_dir: Path, config_path: Path) -> Path:
    legacy_path = script_dir / "config.toml"
    if config_path.exists() or not legacy_path.exists():
        return config_path
    config_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(legacy_path), str(config_path))
    print(f"[INFO] 既存の config.toml を新しい場所へ移動しました: {config_path}")
    return config_path


def strip_toml_inline_comment(text: str) -> str:
    in_string = False
    escape = False
    bracket_depth = 0

    for idx, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue
        if ch == "[":
            bracket_depth += 1
            continue
        if ch == "]" and bracket_depth > 0:
            bracket_depth -= 1
            continue
        if ch == "#" and bracket_depth == 0:
            return text[:idx].rstrip()

    return text.rstrip()


def split_toml_array_items(text: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    in_string = False
    escape = False
    depth = 0

    for ch in text:
        if in_string:
            current.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            current.append(ch)
            continue
        if ch == "[":
            depth += 1
            current.append(ch)
            continue
        if ch == "]" and depth > 0:
            depth -= 1
            current.append(ch)
            continue
        if ch == "," and depth == 0:
            item = "".join(current).strip()
            if item:
                items.append(item)
            current = []
            continue
        current.append(ch)

    tail = "".join(current).strip()
    if tail:
        items.append(tail)
    return items


def parse_basic_toml_value(text: str) -> Any:
    value = strip_toml_inline_comment(text).strip()
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if re.fullmatch(r"[+-]?\d+", value):
        return int(value)
    if re.fullmatch(r"[+-]?\d+\.\d+", value):
        return float(value)
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [parse_basic_toml_value(item) for item in split_toml_array_items(inner)]
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    raise RuntimeError(f"未対応の TOML 値です: {text}")


def simple_toml_loads(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    current_section: dict[str, Any] | None = None
    lines = text.splitlines()
    idx = 0

    while idx < len(lines):
        raw_line = lines[idx]
        stripped = raw_line.strip()
        idx += 1

        if not stripped or stripped.startswith("#"):
            continue

        section_match = re.fullmatch(r"\[([A-Za-z0-9_]+)\]", stripped)
        if section_match:
            section_name = section_match.group(1)
            current_section = result.setdefault(section_name, {})
            continue

        key_match = re.fullmatch(r"([A-Za-z0-9_]+)\s*=\s*(.*)", stripped)
        if not key_match:
            raise RuntimeError(f"TOML の行を解釈できませんでした: {raw_line}")
        if current_section is None:
            raise RuntimeError(f"セクション外の TOML 行です: {raw_line}")

        key = key_match.group(1)
        value_text = key_match.group(2).rstrip()

        if value_text.startswith('"""'):
            multiline_head = value_text[3:]
            collected: list[str] = []
            if multiline_head.endswith('"""'):
                current_section[key] = multiline_head[:-3]
                continue

            if multiline_head:
                collected.append(multiline_head)

            while idx < len(lines):
                next_line = lines[idx]
                idx += 1
                if next_line.endswith('"""'):
                    collected.append(next_line[:-3])
                    break
                collected.append(next_line)
            else:
                raise RuntimeError(f"複数行文字列の終端が見つかりませんでした: {key}")

            current_section[key] = "\n".join(collected)
            continue

        current_section[key] = parse_basic_toml_value(value_text)

    return result


def load_toml(path: Path) -> dict[str, Any]:
    if tomllib is None:
        return simple_toml_loads(path.read_text(encoding="utf-8"))
    with path.open("rb") as f:
        return tomllib.load(f)


def load_toml_text(text: str) -> dict[str, Any]:
    if tomllib is None:
        return simple_toml_loads(text)
    return tomllib.loads(text)


def get_section(config: dict[str, Any], key: str) -> dict[str, Any]:
    value = config.get(key, {})
    return value if isinstance(value, dict) else {}


def cfg_str(section: dict[str, Any], key: str, default: str = "") -> str:
    value = section.get(key, default)
    return str(value).strip() if value is not None else default


def cfg_bool(section: dict[str, Any], key: str, default: bool = False) -> bool:
    value = section.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def cfg_int(section: dict[str, Any], key: str, default: int = 0) -> int:
    value = section.get(key, default)
    return int(value)


def cfg_float(section: dict[str, Any], key: str, default: float = 0.0) -> float:
    value = section.get(key, default)
    return float(value)


def cfg_str_list(section: dict[str, Any], key: str, default: list[str] | None = None) -> list[str]:
    if default is None:
        default = []
    value = section.get(key, default)
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return default


def get_default_config_dict() -> dict[str, Any]:
    return load_toml_text(CONFIG_TEMPLATE)


def merge_config_with_defaults(config: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(get_default_config_dict())
    for section, values in config.items():
        if not isinstance(values, dict):
            merged[section] = values
            continue
        target = merged.setdefault(section, {})
        if not isinstance(target, dict):
            merged[section] = copy.deepcopy(values)
            continue
        for key, value in values.items():
            target[key] = value
    return merged


def toml_format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        text = repr(value)
        return text
    if isinstance(value, list):
        return "[" + ", ".join(toml_format_value(v) for v in value) + "]"
    if value is None:
        return "\"\""
    return json.dumps(str(value), ensure_ascii=False)


def dump_config_toml(config: dict[str, Any]) -> str:
    defaults = get_default_config_dict()
    lines: list[str] = []
    for section in CONFIG_SECTION_ORDER:
        section_data = config.get(section, {})
        if not isinstance(section_data, dict):
            section_data = {}
        default_section = defaults.get(section, {})
        if not isinstance(default_section, dict):
            default_section = {}
        lines.append(f"[{section}]")
        handled: set[str] = set()
        for key in CONFIG_KEY_ORDER.get(section, []):
            handled.add(key)
            lines.append(f"{key} = {toml_format_value(section_data.get(key, default_section.get(key, '')))}")
        for key in sorted(k for k in section_data.keys() if k not in handled):
            lines.append(f"{key} = {toml_format_value(section_data[key])}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def dump_config_template_with_values(config: dict[str, Any]) -> str:
    merged = merge_config_with_defaults(config)
    known_sections = set(CONFIG_SECTION_ORDER)
    known_keys = {section: set(keys) for section, keys in CONFIG_KEY_ORDER.items()}
    lines: list[str] = []
    current_section: str | None = None
    rendered_keys: dict[str, set[str]] = {section: set() for section in CONFIG_SECTION_ORDER}

    for raw_line in CONFIG_TEMPLATE.splitlines():
        stripped = raw_line.strip()
        section_match = re.fullmatch(r"\[(.+)\]", stripped)
        if section_match:
            current_section = section_match.group(1)
            lines.append(raw_line)
            continue

        if current_section in known_sections:
            key_match = re.fullmatch(r"([A-Za-z0-9_]+)\s*=\s*.*", stripped)
            if key_match:
                key = key_match.group(1)
                if key in known_keys.get(current_section, set()):
                    value = merged.get(current_section, {}).get(key, "")
                    lines.append(f"{key} = {toml_format_value(value)}")
                    rendered_keys[current_section].add(key)
                    continue

        lines.append(raw_line)

    extras: list[str] = []
    for section in CONFIG_SECTION_ORDER:
        section_data = merged.get(section, {})
        if not isinstance(section_data, dict):
            continue
        missing_keys = [key for key in CONFIG_KEY_ORDER.get(section, []) if key not in rendered_keys[section] and key in section_data]
        extra_keys = sorted(key for key in section_data.keys() if key not in known_keys.get(section, set()))
        if not missing_keys and not extra_keys:
            continue
        if extras and extras[-1] != "":
            extras.append("")
        extras.append(f"[{section}]")
        for key in missing_keys + extra_keys:
            extras.append(f"{key} = {toml_format_value(section_data[key])}")

    for section, value in merged.items():
        if section in known_sections or not isinstance(value, dict):
            continue
        if extras and extras[-1] != "":
            extras.append("")
        extras.append(f"[{section}]")
        for key in sorted(value.keys()):
            extras.append(f"{key} = {toml_format_value(value[key])}")

    rendered = "\n".join(lines).rstrip()
    if extras:
        rendered += "\n\n" + "\n".join(extras).rstrip()
    return rendered.rstrip() + "\n"


def parse_version_tuple(text: str) -> tuple[int, int, int] | None:
    m = re.fullmatch(r"\s*(\d+)\.(\d+)(?:\.(\d+))?\s*", text)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def get_known_versions() -> list[tuple[int, int, int]]:
    versions: set[tuple[int, int, int]] = set()
    for start, end, _ in PACK_FORMAT_RULES:
        versions.add(start)
        versions.add(end)
    return sorted(versions)


KNOWN_VERSIONS = get_known_versions()


def parse_version_spec(spec: str) -> tuple[tuple[int, int, int] | None, tuple[int, int, int] | None]:
    s = spec.strip().lower()
    exact = parse_version_tuple(s)
    if exact:
        return exact, exact

    m = re.fullmatch(r"(\d+)\.(\d+)\.(x|\*)", s)
    if m:
        major = int(m.group(1))
        minor = int(m.group(2))
        min_ver = (major, minor, 0)
        candidates = [v for v in KNOWN_VERSIONS if v[0] == major and v[1] == minor]
        max_ver = max(candidates) if candidates else (major, minor, 99)
        return min_ver, max_ver

    m2 = re.fullmatch(r"(\d+)\.(\d+)", s)
    if m2:
        major = int(m2.group(1))
        minor = int(m2.group(2))
        min_ver = (major, minor, 0)
        candidates = [v for v in KNOWN_VERSIONS if v[0] == major and v[1] == minor]
        max_ver = max(candidates) if candidates else (major, minor, 99)
        return min_ver, max_ver

    raise ValueError(f"対応していない Minecraft バージョン指定です: {spec}")


def nearest_known_at_or_below(ver: tuple[int, int, int]) -> tuple[int, int, int] | None:
    candidates = [v for v in KNOWN_VERSIONS if v <= ver]
    return max(candidates) if candidates else None


def nearest_known_below(ver: tuple[int, int, int]) -> tuple[int, int, int] | None:
    candidates = [v for v in KNOWN_VERSIONS if v < ver]
    return max(candidates) if candidates else None


def nearest_known_at_or_above(ver: tuple[int, int, int]) -> tuple[int, int, int] | None:
    candidates = [v for v in KNOWN_VERSIONS if v >= ver]
    return min(candidates) if candidates else None


def version_in_range(ver: tuple[int, int, int], start: tuple[int, int, int], end: tuple[int, int, int]) -> bool:
    return start <= ver <= end


def get_pack_format_for_version(ver: tuple[int, int, int]) -> int | None:
    for start, end, pf in PACK_FORMAT_RULES:
        if version_in_range(ver, start, end):
            return pf
    return None


def resolve_pack_formats_from_versions(
    min_ver: tuple[int, int, int] | None,
    max_ver: tuple[int, int, int] | None,
) -> tuple[int, dict[str, int] | None]:
    if min_ver is None and max_ver is None:
        latest_pf = PACK_FORMAT_RULES[-1][2]
        return latest_pf, None

    if min_ver is None:
        min_ver = max_ver
    if max_ver is None:
        max_ver = min_ver

    min_known = nearest_known_at_or_above(min_ver) or nearest_known_at_or_below(min_ver) or KNOWN_VERSIONS[0]
    max_known = nearest_known_at_or_below(max_ver) or nearest_known_at_or_above(max_ver) or KNOWN_VERSIONS[-1]

    min_pf = get_pack_format_for_version(min_known)
    max_pf = get_pack_format_for_version(max_known)

    if min_pf is None and max_pf is None:
        latest_pf = PACK_FORMAT_RULES[-1][2]
        return latest_pf, None
    if min_pf is None:
        min_pf = max_pf
    if max_pf is None:
        max_pf = min_pf

    if min_pf == max_pf:
        return max_pf, None

    return max_pf, {
        "min_inclusive": min_pf,
        "max_inclusive": max_pf,
    }


def infer_versions_from_expr(expr: str | None) -> tuple[tuple[int, int, int] | None, tuple[int, int, int] | None]:
    if not expr:
        return None, None

    s = expr.strip()

    range_match = re.search(r"([\[\(])\s*([^,\s]+)?\s*,\s*([^,\s]+)?\s*([\)\]])", s)
    if range_match:
        lower_inclusive = range_match.group(1) == "["
        upper_inclusive = range_match.group(4) == "]"
        lower_raw = range_match.group(2)
        upper_raw = range_match.group(3)

        min_ver = parse_version_tuple(lower_raw) if lower_raw else None
        raw_upper = parse_version_tuple(upper_raw) if upper_raw else None
        max_ver = raw_upper

        if raw_upper and not upper_inclusive:
            below = nearest_known_below(raw_upper)
            if below:
                max_ver = below

        if min_ver and not lower_inclusive:
            above = nearest_known_at_or_above(min_ver)
            if above:
                min_ver = above

        return min_ver, max_ver

    lower_cmp = re.search(r">=\s*(\d+\.\d+(?:\.\d+)?)", s)
    upper_cmp = re.search(r"<\s*(\d+\.\d+(?:\.\d+)?)", s)
    if lower_cmp or upper_cmp:
        min_ver = parse_version_tuple(lower_cmp.group(1)) if lower_cmp else None
        max_ver = parse_version_tuple(upper_cmp.group(1)) if upper_cmp else None
        if max_ver:
            below = nearest_known_below(max_ver)
            if below:
                max_ver = below
        return min_ver, max_ver

    wildcard = re.search(r"(\d+)\.(\d+)\.(x|\*)", s, re.IGNORECASE)
    if wildcard:
        major = int(wildcard.group(1))
        minor = int(wildcard.group(2))
        min_ver = (major, minor, 0)
        max_candidates = [v for v in KNOWN_VERSIONS if v[0] == major and v[1] == minor]
        max_ver = max(max_candidates) if max_candidates else (major, minor, 99)
        return min_ver, max_ver

    try:
        return parse_version_spec(s)
    except ValueError:
        pass

    versions = [parse_version_tuple(m.group(0)) for m in re.finditer(r"\d+\.\d+(?:\.\d+)?", s)]
    versions = [v for v in versions if v is not None]
    if versions:
        return min(versions), max(versions)

    return None, None


def get_clipboard_text() -> str:
    if sys.platform == "darwin":
        try:
            out = subprocess.check_output(["pbpaste"])
            text = out.decode("utf-8")
            if text.strip():
                return text
        except Exception:
            pass

    if sys.platform.startswith("win"):
        try:
            text = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
                ],
                encoding="utf-8",
                errors="ignore",
            )
            if text.strip():
                return text
        except Exception:
            pass

    try:
        import tkinter as tk
    except Exception as e:
        raise RuntimeError("クリップボードを読むには macOS の pbpaste / Windows の Get-Clipboard / tkinter のいずれかが必要です。") from e

    root = tk.Tk()
    root.withdraw()
    try:
        text = root.clipboard_get()
    except Exception as e:
        raise RuntimeError("クリップボードにテキストがありません。") from e
    finally:
        root.destroy()

    if not text.strip():
        raise RuntimeError("クリップボードが空です。")
    return text


def set_clipboard_text(text: str) -> str:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return "pbcopy"

    if sys.platform.startswith("win"):
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; "
                "$text = [Console]::In.ReadToEnd(); "
                "Set-Clipboard -Value $text",
            ],
            input=text.encode("utf-8"),
            check=True,
        )
        return "Set-Clipboard"

    try:
        import tkinter as tk
    except Exception as e:
        raise RuntimeError(
            "クリップボードへコピーできません。macOS / Windows の標準機能か tkinter が使える Python を用意してください。"
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


def validate_lang_dict(data: Any) -> dict[str, str]:
    if not isinstance(data, dict):
        raise ValueError("lang データは JSON オブジェクトである必要があります。")
    out: dict[str, str] = {}
    for k, v in data.items():
        if not isinstance(k, str):
            raise ValueError("lang のキーは文字列である必要があります。")
        if not isinstance(v, str):
            raise ValueError(f"キー '{k}' の値が文字列ではありません。")
        out[k] = v
    return out


def parse_lang_json_text(text: str, label: str) -> dict[str, str]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"{label} の JSON 解析に失敗しました: {e}") from e
    return validate_lang_dict(data)


def parse_multiline_entries(text: str) -> list[str]:
    entries: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "," in line and not any(sep in line for sep in ("/", "\\", ":")):
            parts = [part.strip() for part in line.split(",")]
        else:
            parts = [line]
        for part in parts:
            if part and part not in entries:
                entries.append(part)
    return entries


def parse_legacy_lang_text(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        key = key.strip()
        if key:
            result[key] = value
    return result


def try_validate_lang_dict(data: Any) -> dict[str, str] | None:
    try:
        return validate_lang_dict(data)
    except Exception:
        return None


def parse_json_values_from_text(text: str) -> list[Any]:
    decoder = json.JSONDecoder()
    values: list[Any] = []
    idx = 0
    length = len(text)
    while idx < length:
        match = re.search(r"[\[{]", text[idx:])
        if not match:
            break
        start = idx + match.start()
        try:
            value, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            idx = start + 1
            continue
        values.append(value)
        idx = end
    return values


def extract_translation_candidates_from_object(
    obj: Any,
    label: str,
    namespace_hint: str | None = None,
) -> list[TranslationCandidate]:
    candidates: list[TranslationCandidate] = []
    direct = try_validate_lang_dict(obj)
    if direct is not None:
        candidates.append(TranslationCandidate(label=label, data=direct, namespace_hint=namespace_hint))
        return candidates

    if isinstance(obj, dict):
        nested_hint = str(
            obj.get("mod_id")
            or obj.get("modId")
            or obj.get("namespace")
            or obj.get("id")
            or namespace_hint
            or ""
        ).strip() or namespace_hint

        for wrapper_key in ("translations", "data", "lang", "values"):
            if wrapper_key in obj:
                candidates.extend(
                    extract_translation_candidates_from_object(
                        obj[wrapper_key],
                        f"{label}.{wrapper_key}",
                        nested_hint,
                    )
                )

        for key, value in obj.items():
            if key in ("mod_id", "modId", "namespace", "id", "translations", "data", "lang", "values"):
                continue
            if not isinstance(value, (dict, list)):
                continue
            child_hint = nested_hint
            key_text = str(key).strip()
            if not child_hint and re.fullmatch(r"[A-Za-z0-9_.-]+", key_text):
                child_hint = key_text
            candidates.extend(
                extract_translation_candidates_from_object(
                    value,
                    f"{label}.{key_text}",
                    child_hint,
                )
            )
        return candidates

    if isinstance(obj, list):
        for index, item in enumerate(obj, start=1):
            candidates.extend(
                extract_translation_candidates_from_object(
                    item,
                    f"{label}[{index}]",
                    namespace_hint,
                )
            )
    return candidates


def load_translation_candidates_from_text(text: str, label: str) -> list[TranslationCandidate]:
    candidates: list[TranslationCandidate] = []
    stripped = text.strip()
    if not stripped:
        return candidates

    try:
        root = json.loads(stripped)
    except json.JSONDecodeError:
        root = None
    if root is not None:
        candidates.extend(extract_translation_candidates_from_object(root, label))
    else:
        for index, value in enumerate(parse_json_values_from_text(text), start=1):
            candidates.extend(extract_translation_candidates_from_object(value, f"{label}#{index}"))

    legacy = parse_legacy_lang_text(text)
    if legacy:
        candidates.append(TranslationCandidate(label=f"{label}:legacy", data=legacy))

    deduped: list[TranslationCandidate] = []
    seen: set[tuple[str, tuple[tuple[str, str], ...]]] = set()
    for candidate in candidates:
        signature = (candidate.namespace_hint or "", tuple(sorted(candidate.data.items())))
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(candidate)
    return deduped


def load_translation_candidates_or_raise(text: str, label: str) -> list[TranslationCandidate]:
    candidates = load_translation_candidates_from_text(text, label)
    if candidates:
        return candidates

    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            json.loads(stripped)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"{label} の JSON 解析に失敗しました: {e}") from e
    raise RuntimeError(f"{label} から翻訳データを読めませんでした。")


def load_translation_candidates_from_sources(config: dict[str, Any]) -> list[TranslationCandidate]:
    file_mode = get_section(config, "file_mode")
    candidates: list[TranslationCandidate] = []

    for path_text in parse_multiline_entries(cfg_str(file_mode, "translation_files_text", "")):
        path = Path(path_text).expanduser()
        if not path.exists() or not path.is_file():
            raise RuntimeError(f"file モードの翻訳ファイルが見つかりません: {path}")
        text = path.read_text(encoding="utf-8", errors="ignore")
        loaded = load_translation_candidates_or_raise(text, str(path))
        candidates.extend(loaded)

    inline_text = cfg_str(file_mode, "inline_translation_text", "")
    if inline_text.strip():
        loaded = load_translation_candidates_or_raise(inline_text, "file_mode.inline_translation_text")
        candidates.extend(loaded)

    return candidates


def build_lang_json_text(data: dict[str, str]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def build_lang_bundle_json_text(entries: list[ExtractLangEntry]) -> str:
    if len(entries) == 1:
        return build_lang_json_text(entries[0].data)
    bundled = {entry.source.namespace: entry.data for entry in entries}
    return json.dumps(bundled, ensure_ascii=False, indent=2) + "\n"


def write_output_text_file(path: Path, text: str) -> Path:
    output_path = path.expanduser()
    if output_path.exists() and output_path.is_dir():
        raise RuntimeError(f"出力先にはファイルパスを指定してください。ディレクトリは指定できません: {output_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text, encoding="utf-8", newline="\n")
    return output_path.resolve()


def ensure_json_output_path(path: Path) -> Path:
    expanded = path.expanduser()
    if expanded.suffix.lower() == ".json":
        return expanded
    if expanded.suffix:
        return expanded.with_suffix(".json")
    return expanded.with_name(f"{expanded.name}.json")


def normalize_locale_priority(values: list[str]) -> list[str]:
    locales: list[str] = []
    for raw in values:
        for item in raw.split(","):
            locale = item.strip().lower()
            if locale and locale not in locales:
                locales.append(locale)
    return locales or DEFAULT_SOURCE_LOCALE_PRIORITY[:]


def find_first_existing(root: Path, patterns: list[str]) -> Path | None:
    candidates: list[Path] = []
    for pattern in patterns:
        candidates.extend(root.rglob(pattern))
    if not candidates:
        return None
    candidates = sorted(set(candidates), key=lambda p: (len(p.parts), str(p)))
    return candidates[0]


def read_manifest_version(mod_root: Path) -> str | None:
    manifest = find_first_existing(mod_root, ["MANIFEST.MF"])
    if not manifest or not manifest.is_file():
        return None

    try:
        text = manifest.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None

    for key in ["Implementation-Version", "Specification-Version", "Bundle-Version"]:
        m = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, re.MULTILINE)
        if m:
            return normalize_whitespace(m.group(1))
    return None


def guess_from_folder_name(mod_root: Path) -> tuple[str | None, str | None, str | None]:
    name = mod_root.name
    versions = re.findall(r"\d+\.\d+(?:\.\d+)?", name)
    mc_expr = versions[0] if versions else None
    mod_version = versions[-1] if len(versions) >= 2 else (versions[0] if versions else None)

    cleaned = re.sub(r"[-_ ]?\d+\.\d+(?:\.\d+)?", "", name).strip("-_ ")
    mod_name = cleaned if cleaned else None
    return mod_name, mod_version, mc_expr


def parse_mods_toml(mod_root: Path) -> ModInfo | None:
    mods_toml = find_first_existing(mod_root, ["mods.toml", "neoforge.mods.toml"])
    if not mods_toml:
        return None

    try:
        data = load_toml(mods_toml)
    except Exception as e:
        raise RuntimeError(f"mod メタデータの読み込みに失敗しました: {mods_toml}\n{e}") from e

    mods = data.get("mods", [])
    if not isinstance(mods, list) or not mods:
        return None

    first_mod = None
    for item in mods:
        if isinstance(item, dict) and item.get("modId"):
            first_mod = item
            break
    if not first_mod:
        return None

    mod_id = str(first_mod.get("modId", "")).strip()
    mod_name = str(first_mod.get("displayName") or mod_id).strip()
    mod_version = str(first_mod.get("version") or "").strip()
    if not mod_version or mod_version == "${file.jarVersion}":
        mod_version = read_manifest_version(mod_root) or "unknown"

    mc_expr = None
    deps = data.get("dependencies", {})
    if isinstance(deps, dict):
        dep_list = deps.get(mod_id)
        if isinstance(dep_list, list):
            for dep in dep_list:
                if isinstance(dep, dict) and str(dep.get("modId", "")).strip() == "minecraft":
                    mc_expr = str(dep.get("versionRange") or "").strip() or None
                    break

    return ModInfo(
        loader="forge/neoforge",
        mod_id=mod_id,
        mod_name=mod_name,
        mod_version=mod_version,
        mc_version_expr=mc_expr,
        source_file=mods_toml,
    )


def parse_fabric_mod_json(mod_root: Path) -> ModInfo | None:
    fabric_json = find_first_existing(mod_root, ["fabric.mod.json"])
    if not fabric_json:
        return None

    try:
        data = json.loads(fabric_json.read_text(encoding="utf-8"))
    except Exception as e:
        raise RuntimeError(f"mod メタデータの読み込みに失敗しました: {fabric_json}\n{e}") from e

    mod_id = str(data.get("id", "")).strip()
    if not mod_id:
        return None

    mod_name = str(data.get("name") or mod_id).strip()
    mod_version = str(data.get("version") or "unknown").strip()

    mc_expr = None
    depends = data.get("depends")
    if isinstance(depends, dict):
        mc_dep = depends.get("minecraft")
        if isinstance(mc_dep, str):
            mc_expr = mc_dep.strip()
        elif isinstance(mc_dep, list):
            mc_expr = " ".join(str(x) for x in mc_dep).strip() or None

    return ModInfo(
        loader="fabric",
        mod_id=mod_id,
        mod_name=mod_name,
        mod_version=mod_version,
        mc_version_expr=mc_expr,
        source_file=fabric_json,
    )


def parse_quilt_mod_json(mod_root: Path) -> ModInfo | None:
    quilt_json = find_first_existing(mod_root, ["quilt.mod.json"])
    if not quilt_json:
        return None

    try:
        data = json.loads(quilt_json.read_text(encoding="utf-8"))
    except Exception as e:
        raise RuntimeError(f"mod メタデータの読み込みに失敗しました: {quilt_json}\n{e}") from e

    ql = data.get("quilt_loader", {})
    if not isinstance(ql, dict):
        return None

    mod_id = str(ql.get("id", "")).strip()
    if not mod_id:
        return None

    metadata = ql.get("metadata", {}) if isinstance(ql.get("metadata"), dict) else {}
    mod_name = str(metadata.get("name") or mod_id).strip()
    mod_version = str(ql.get("version") or "unknown").strip()

    mc_expr = None
    depends = ql.get("depends")
    if isinstance(depends, list):
        for dep in depends:
            if isinstance(dep, dict) and dep.get("id") == "minecraft":
                versions = dep.get("versions")
                if isinstance(versions, str):
                    mc_expr = versions.strip()
                elif isinstance(versions, list):
                    mc_expr = " ".join(str(v) for v in versions).strip()
                break

    return ModInfo(
        loader="quilt",
        mod_id=mod_id,
        mod_name=mod_name,
        mod_version=mod_version,
        mc_version_expr=mc_expr,
        source_file=quilt_json,
    )


def fallback_from_assets(mod_root: Path) -> ModInfo:
    assets_dir = mod_root / "assets"
    mod_id = None

    if assets_dir.is_dir():
        namespaces = []
        for child in assets_dir.iterdir():
            if child.is_dir() and (child / "lang").is_dir():
                namespaces.append(child.name)
        if namespaces:
            mod_id = sorted(namespaces)[0]

    guessed_name, guessed_version, guessed_mc = guess_from_folder_name(mod_root)

    return ModInfo(
        loader="fallback",
        mod_id=mod_id or "unknownmod",
        mod_name=guessed_name or mod_id or mod_root.name,
        mod_version=guessed_version or "unknown",
        mc_version_expr=guessed_mc,
        source_file=None,
    )


def detect_mod_info(mod_root: Path) -> ModInfo:
    for parser in (parse_mods_toml, parse_fabric_mod_json, parse_quilt_mod_json):
        info = parser(mod_root)
        if info:
            if info.mod_version in ("", "${file.jarVersion}"):
                info.mod_version = read_manifest_version(mod_root) or info.mod_version or "unknown"
            return info
    return fallback_from_assets(mod_root)


def parse_lang_json_file(path: Path) -> dict[str, str]:
    return parse_lang_json_text(path.read_text(encoding="utf-8"), str(path))


def parse_legacy_lang_file(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    text = path.read_text(encoding="utf-8", errors="ignore")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        key = key.strip()
        if key:
            result[key] = value
    return result


def load_lang_source_dict(source: LangSource) -> dict[str, str]:
    if source.ext == ".json":
        return parse_lang_json_file(source.path)
    if source.ext == ".lang":
        return parse_legacy_lang_file(source.path)
    raise ValueError(f"未対応の lang 形式です: {source.path}")


def discover_lang_sources(mod_root: Path) -> list[LangSource]:
    found: list[LangSource] = []
    assets_dir = mod_root / "assets"
    if not assets_dir.is_dir():
        return found

    for namespace_dir in sorted([p for p in assets_dir.iterdir() if p.is_dir()]):
        lang_dir = namespace_dir / "lang"
        if not lang_dir.is_dir():
            continue

        for file in sorted(lang_dir.iterdir()):
            if not file.is_file():
                continue
            ext = file.suffix.lower()
            if ext not in LANG_FILE_EXTENSIONS:
                continue
            found.append(
                LangSource(
                    namespace=namespace_dir.name,
                    locale=file.stem.lower(),
                    path=file,
                    ext=ext,
                )
            )
    return found


def group_lang_sources_by_namespace(sources: list[LangSource]) -> dict[str, list[LangSource]]:
    grouped: dict[str, list[LangSource]] = {}
    for source in sources:
        grouped.setdefault(source.namespace, []).append(source)
    return grouped


def choose_best_lang_source(sources: list[LangSource], preferred_modid: str | None, source_priority: list[str], target_locale: str) -> LangSource | None:
    if not sources:
        return None

    def source_rank(src: LangSource) -> tuple[int, int, int, str]:
        namespace_score = 0 if preferred_modid and src.namespace == preferred_modid else 1
        if src.locale in source_priority:
            locale_score = source_priority.index(src.locale)
        elif src.locale == target_locale:
            locale_score = 9999
        else:
            locale_score = 100 + len(src.locale)
        ext_score = 0 if src.ext == ".json" else 1
        return (namespace_score, locale_score, ext_score, str(src.path))

    ranked = sorted(sources, key=source_rank)
    for src in ranked:
        if src.locale != target_locale:
            return src
    return ranked[0]


def choose_namespace_for_extraction(mod_root: Path, explicit_namespace: str | None) -> str | None:
    if explicit_namespace:
        return explicit_namespace.strip() or None
    return None


def choose_extract_lang_sources(mod_root: Path, preferred_namespace: str | None, locale_priority: list[str]) -> list[LangSource]:
    sources = discover_lang_sources(mod_root)
    if not sources:
        raise RuntimeError("lang ファイルが見つかりませんでした。assets/<namespace>/lang/ を確認してください。")

    relevant = [src for src in sources if not preferred_namespace or src.namespace == preferred_namespace]
    if not relevant:
        raise RuntimeError(f"指定 namespace の lang ファイルが見つかりませんでした: {preferred_namespace}")

    selected: list[LangSource] = []
    for namespace, namespace_sources in sorted(group_lang_sources_by_namespace(relevant).items()):
        best = choose_best_lang_source(namespace_sources, namespace, locale_priority, "")
        if best is not None:
            selected.append(best)

    if not selected:
        raise RuntimeError("使える lang ファイルが見つかりませんでした。")
    return selected


def find_lang_source_for_locale(
    sources: list[LangSource],
    target_locale: str,
    preferred_namespace: str | None = None,
) -> LangSource | None:
    wanted_locale = target_locale.strip().lower()
    if not wanted_locale:
        return None

    candidates = [src for src in sources if src.locale == wanted_locale]
    if preferred_namespace:
        candidates = [src for src in candidates if src.namespace == preferred_namespace]
    if not candidates:
        return None
    return sorted(candidates, key=lambda src: (0 if src.ext == ".json" else 1, str(src.path)))[0]


def find_lang_sources_for_locale(
    sources: list[LangSource],
    target_locale: str,
    preferred_namespace: str | None = None,
) -> list[LangSource]:
    wanted_locale = target_locale.strip().lower()
    if not wanted_locale:
        return []
    candidates = [src for src in sources if src.locale == wanted_locale]
    if preferred_namespace:
        candidates = [src for src in candidates if src.namespace == preferred_namespace]
    return sorted(candidates, key=lambda src: (src.namespace, 0 if src.ext == ".json" else 1, str(src.path)))


def maybe_cancel_if_target_locale_exists(
    mod_root: Path,
    preferred_namespace: str | None,
    config: dict[str, Any],
    action_label: str,
) -> None:
    translation = get_section(config, "translation")
    if not cfg_bool(translation, "cancel_if_target_locale_exists", True):
        return

    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    repair = cfg_bool(translation, "repair_broken_placeholders", True)
    source_priority = cfg_str_list(translation, "source_locale_priority", DEFAULT_SOURCE_LOCALE_PRIORITY)
    all_sources = discover_lang_sources(mod_root)
    if not all_sources:
        return

    relevant_sources = [src for src in all_sources if not preferred_namespace or src.namespace == preferred_namespace]
    if not relevant_sources:
        return

    first_existing_target: LangSource | None = None
    for namespace, namespace_sources in sorted(group_lang_sources_by_namespace(relevant_sources).items()):
        existing_target = find_lang_source_for_locale(namespace_sources, target_locale, namespace)
        if existing_target is None:
            return
        if first_existing_target is None:
            first_existing_target = existing_target

        best = choose_best_lang_source(namespace_sources, namespace, source_priority, target_locale)
        if best is None:
            return
        if best.locale == target_locale:
            return

        plan = build_translation_source_plan(best, existing_target, repair)
        if plan.pending_source_data:
            return

    if first_existing_target is not None:
        raise TargetLocaleAlreadyExists(target_locale.lower(), first_existing_target, action_label)


PLACEHOLDER_PATTERN = re.compile(
    r"%\d*\$?[sdiffoxXeEgGaAcbhnt%]"
    r"|\{[0-9]+\}"
    r"|§."
)


def extract_placeholder_tokens(text: str) -> list[str]:
    tokens = PLACEHOLDER_PATTERN.findall(text)
    tokens.extend(["<NEWLINE>"] * text.count("\n"))
    tokens.extend(["<TAB>"] * text.count("\t"))
    tokens.extend(["<CR>"] * text.count("\r"))
    return sorted(tokens)


def existing_target_value_needs_translation(source_text: str, target_text: str | None, repair: bool) -> bool:
    if target_text is None:
        return True
    if not target_text.strip():
        return True
    if repair and extract_placeholder_tokens(source_text) != extract_placeholder_tokens(target_text):
        return True
    return normalize_whitespace(source_text) == normalize_whitespace(target_text)


def build_translation_source_plan(
    source: LangSource,
    existing_target_source: LangSource | None,
    repair: bool,
) -> TranslationSourcePlan:
    source_data = load_lang_source_dict(source)
    if existing_target_source is None:
        return TranslationSourcePlan(
            source=source,
            source_data=source_data,
            pending_source_data=dict(source_data),
        )

    existing_target_data = load_lang_source_dict(existing_target_source)
    pending_source_data: dict[str, str] = {}
    reused_source_key_count = 0
    for key, source_text in source_data.items():
        if existing_target_value_needs_translation(source_text, existing_target_data.get(key), repair):
            pending_source_data[key] = source_text
        else:
            reused_source_key_count += 1

    return TranslationSourcePlan(
        source=source,
        source_data=source_data,
        pending_source_data=pending_source_data,
        existing_target_source=existing_target_source,
        preserved_target_data=dict(existing_target_data),
        reused_source_key_count=reused_source_key_count,
    )


def build_extract_lang_entries(
    mod_root: Path,
    preferred_namespace: str | None,
    locale_priority: list[str],
    config: dict[str, Any],
) -> list[ExtractLangEntry]:
    translation = get_section(config, "translation")
    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    repair = cfg_bool(translation, "repair_broken_placeholders", True)
    skip_completed_target = cfg_bool(translation, "cancel_if_target_locale_exists", True)

    selected_sources = choose_extract_lang_sources(mod_root, preferred_namespace, locale_priority)
    all_sources = discover_lang_sources(mod_root)
    grouped_all_sources = group_lang_sources_by_namespace(all_sources)

    entries: list[ExtractLangEntry] = []
    for source in selected_sources:
        existing_target = find_lang_source_for_locale(
            grouped_all_sources.get(source.namespace, []),
            target_locale,
            source.namespace,
        )
        if not skip_completed_target or existing_target is None or source.locale == target_locale:
            entries.append(ExtractLangEntry(source=source, data=load_lang_source_dict(source)))
            continue

        plan = build_translation_source_plan(source, existing_target, repair)
        if not plan.pending_source_data:
            print(
                f"[INFO] {source.namespace} は既存の {target_locale}.json で十分に埋まっているため、元 lang 抽出から外します: {existing_target.path}"
            )
            continue
        if plan.reused_source_key_count:
            print(
                f"[INFO] {source.namespace} は既存の {target_locale}.json を再利用し、未翻訳 {len(plan.pending_source_data)} 件だけ抽出します。"
            )
        entries.append(ExtractLangEntry(source=source, data=plan.pending_source_data))

    if not entries:
        raise RuntimeError("抽出する必要のある未翻訳 lang が見つかりませんでした。")
    return entries


def extract_lang_json_result(
    mod_root: Path,
    preferred_namespace: str | None,
    locale_priority: list[str],
    config: dict[str, Any],
) -> ExtractLangResult:
    entries = build_extract_lang_entries(mod_root, preferred_namespace, locale_priority, config)
    return ExtractLangResult(
        entries=entries,
        json_text=build_lang_bundle_json_text(entries),
    )


def sanitize_translated_map(
    source_chunk: dict[str, str],
    translated_chunk: dict[str, str],
    repair: bool,
    label: str = "翻訳結果",
) -> tuple[dict[str, str], list[str]]:
    warnings: list[str] = []

    source_keys = list(source_chunk.keys())
    translated_keys = list(translated_chunk.keys())
    if set(source_keys) != set(translated_keys):
        missing = [k for k in source_keys if k not in translated_chunk]
        extra = [k for k in translated_keys if k not in source_chunk]
        raise RuntimeError(f"{label} のキーが元 lang と一致しません。missing={missing[:10]} extra={extra[:10]}")

    fixed: dict[str, str] = {}
    for key in source_keys:
        src_val = source_chunk[key]
        dst_val = translated_chunk[key]
        if repair:
            if extract_placeholder_tokens(src_val) != extract_placeholder_tokens(dst_val):
                warnings.append(f"[WARN] プレースホルダ不一致のため原文維持: {key}")
                fixed[key] = src_val
                continue
        fixed[key] = dst_val

    return fixed, warnings


def build_translation_memory_glossary(memory: dict[str, str], limit: int = 40) -> str:
    if not memory:
        return ""

    items = list(memory.items())[-limit:]
    glossary = {src: dst for src, dst in items}
    return json.dumps(glossary, ensure_ascii=False, indent=2)


def apply_translation_memory(
    source_chunk: dict[str, str],
    translated_chunk: dict[str, str],
    translation_memory: dict[str, str],
    enabled: bool,
) -> list[str]:
    if not enabled:
        return []

    warnings: list[str] = []
    for key, source_text in source_chunk.items():
        locked = translation_memory.get(source_text)
        if locked is None:
            continue
        if translated_chunk.get(key) != locked:
            warnings.append(f"[WARN] 用語統一のため既訳を再利用: {key}")
            translated_chunk[key] = locked
    return warnings


def update_translation_memory(
    source_chunk: dict[str, str],
    translated_chunk: dict[str, str],
    translation_memory: dict[str, str],
    enabled: bool,
) -> None:
    if not enabled:
        return

    for key, source_text in source_chunk.items():
        if source_text not in translation_memory:
            translation_memory[source_text] = translated_chunk[key]


def build_translation_memory_seed(
    source_map: dict[str, str],
    pending_source_map: dict[str, str],
    preserved_target_data: dict[str, str],
) -> dict[str, str]:
    seed: dict[str, str] = {}
    pending_keys = set(pending_source_map.keys())
    for key, source_text in source_map.items():
        if key in pending_keys:
            continue
        translated_text = preserved_target_data.get(key)
        if isinstance(translated_text, str) and translated_text.strip():
            seed.setdefault(source_text, translated_text)
    return seed


def select_translation_candidate_for_source(
    candidates: list[TranslationCandidate],
    source_map: dict[str, str],
    source: LangSource,
    repair: bool,
    pending_source_map: dict[str, str] | None = None,
    preserved_target_data: dict[str, str] | None = None,
) -> tuple[dict[str, str], list[str], TranslationCandidate]:
    matches: list[tuple[tuple[int, int, int, str], dict[str, str], list[str], TranslationCandidate]] = []
    allow_partial_merge = (
        pending_source_map is not None
        and preserved_target_data is not None
        and pending_source_map
        and pending_source_map != source_map
    )

    for candidate in candidates:
        namespace_score = 0 if candidate.namespace_hint and candidate.namespace_hint == source.namespace else 1
        label_score = 0 if source.namespace and source.namespace in candidate.label else 1
        try:
            cleaned_map, warnings = sanitize_translated_map(
                source_map,
                candidate.data,
                repair,
                label=f"file モード候補 ({candidate.label})",
            )
            score = (0, namespace_score, label_score, candidate.label)
            matches.append((score, cleaned_map, warnings, candidate))
        except Exception:
            pass

        if not allow_partial_merge:
            continue

        try:
            cleaned_partial_map, warnings = sanitize_translated_map(
                pending_source_map,
                candidate.data,
                repair,
                label=f"file モード候補 ({candidate.label}) の未翻訳差分",
            )
        except Exception:
            continue

        merged_map = dict(preserved_target_data)
        merged_map.update(cleaned_partial_map)
        score = (1, namespace_score, label_score, candidate.label)
        matches.append((score, merged_map, warnings, candidate))

    if not matches:
        raise RuntimeError(
            f"翻訳データから namespace={source.namespace} locale={source.locale} に一致する JSON を見つけられませんでした。"
            " キー集合が元 lang と一致する候補を用意してください。"
        )

    return sorted(matches, key=lambda item: item[0])[0][1:]


def choose_translation_sources_for_pack(
    mod_root: Path,
    config: dict[str, Any],
) -> tuple[list[TranslationSourcePlan], list[LangSource], list[LangSource]]:
    translation = get_section(config, "translation")
    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    source_priority = cfg_str_list(translation, "source_locale_priority", DEFAULT_SOURCE_LOCALE_PRIORITY)
    repair = cfg_bool(translation, "repair_broken_placeholders", True)
    skip_completed_target = cfg_bool(translation, "cancel_if_target_locale_exists", True)

    sources = discover_lang_sources(mod_root)
    if not sources:
        raise RuntimeError("翻訳元に使える lang ファイルが見つかりませんでした。")

    selected: list[TranslationSourcePlan] = []
    skipped_target_only: list[LangSource] = []
    skipped_completed_target: list[LangSource] = []
    for namespace, namespace_sources in sorted(group_lang_sources_by_namespace(sources).items()):
        best = choose_best_lang_source(namespace_sources, namespace, source_priority, target_locale)
        if best is None:
            continue
        if best.locale == target_locale:
            source_data = load_lang_source_dict(best)
            selected.append(
                TranslationSourcePlan(
                    source=best,
                    source_data=source_data,
                    pending_source_data=dict(source_data),
                    source_is_target_locale_fallback=True,
                )
            )
            continue
        existing_target = find_lang_source_for_locale(namespace_sources, target_locale, namespace)
        plan = build_translation_source_plan(best, existing_target if skip_completed_target else None, repair)
        if skip_completed_target and plan.existing_target_source and not plan.pending_source_data:
            skipped_completed_target.append(plan.existing_target_source)
            continue
        selected.append(plan)

    if selected:
        return selected, skipped_target_only, skipped_completed_target

    if skipped_completed_target:
        raise RuntimeError(
            f"翻訳する必要のあるキーが見つかりませんでした。{target_locale}.json は既に十分に埋まっています。"
        )
    raise RuntimeError("翻訳元に使える lang ファイルが見つかりませんでした。")


def build_translated_entries_from_candidates(
    plans: list[TranslationSourcePlan],
    candidates: list[TranslationCandidate],
    config: dict[str, Any],
) -> list[TranslatedLangEntry]:
    translation = get_section(config, "translation")
    repair = cfg_bool(translation, "repair_broken_placeholders", True)
    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    translated_entries: list[TranslatedLangEntry] = []
    for plan in plans:
        source = plan.source
        print(f"[SOURCE] 照合元 lang ファイル: {source.path}")
        if plan.source_is_target_locale_fallback:
            print(
                f"[SOURCE] {source.namespace} は {source.locale}.json しか無いため、この既存 lang を source として使います。"
            )
        if plan.existing_target_source and plan.reused_source_key_count:
            print(
                f"[SOURCE] 既存の {target_locale}.json を再利用: namespace={source.namespace} keep={plan.reused_source_key_count} translate={len(plan.pending_source_data)}"
            )
        try:
            translated_map, warnings, candidate = select_translation_candidate_for_source(
                candidates,
                plan.source_data,
                source,
                repair,
                pending_source_map=plan.pending_source_data if plan.existing_target_source else None,
                preserved_target_data=plan.preserved_target_data if plan.existing_target_source else None,
            )
        except RuntimeError as e:
            if len(plans) > 1:
                raise RuntimeError(
                    f"{e} 複数 namespace の mod なので、抽出結果の bundle JSON か、namespace ごとの辞書を含む翻訳データを用意してください。"
                ) from e
            raise
        print(f"[SOURCE] 使用する翻訳データ: {candidate.label} -> {source.namespace}:{source.locale}")
        for warning in warnings:
            eprint(warning)
        translated_entries.append(TranslatedLangEntry(source=source, data=translated_map))
    return translated_entries


def validate_clipboard_translation_entries(mod_root: Path, config: dict[str, Any], clipboard_text: str) -> list[TranslatedLangEntry]:
    candidates = load_translation_candidates_or_raise(clipboard_text, "クリップボード")
    sources, skipped_target_only, skipped_completed = choose_translation_sources_for_pack(mod_root, config)
    if skipped_completed:
        target_locale = cfg_str(get_section(config, "translation"), "target_locale", "ja_jp")
        for source in skipped_completed:
            print(f"[INFO] {source.namespace} は既存の {target_locale}.json が十分に埋まっているため翻訳対象から外します: {source.path}")
    skipped = skipped_target_only
    if skipped:
        for source in skipped:
            print(f"[INFO] {source.namespace} は既に {source.locale}.json しか無いため翻訳対象から外します: {source.path}")
    return build_translated_entries_from_candidates(sources, candidates, config)


def load_file_mode_translation_entries(mod_root: Path, config: dict[str, Any]) -> list[TranslatedLangEntry]:
    candidates = load_translation_candidates_from_sources(config)
    if not candidates:
        raise RuntimeError("file モードの翻訳データが指定されていません。翻訳ファイルか直接入力テキストを設定してください。")
    sources, skipped_target_only, skipped_completed = choose_translation_sources_for_pack(mod_root, config)
    if skipped_completed:
        target_locale = cfg_str(get_section(config, "translation"), "target_locale", "ja_jp")
        for source in skipped_completed:
            print(f"[INFO] {source.namespace} は既存の {target_locale}.json が十分に埋まっているため翻訳対象から外します: {source.path}")
    skipped = skipped_target_only
    if skipped:
        for source in skipped:
            print(f"[INFO] {source.namespace} は既に {source.locale}.json しか無いため翻訳対象から外します: {source.path}")
    return build_translated_entries_from_candidates(sources, candidates, config)


def maybe_auto_fetch_source_lang_for_clipboard(
    mod_root: Path,
    mod_info: ModInfo,
    config: dict[str, Any],
    reason: Exception,
) -> None:
    clipboard = get_section(config, "clipboard")
    if not cfg_bool(clipboard, "auto_fetch_source_when_missing", True):
        raise reason

    translation = get_section(config, "translation")
    locale_priority = cfg_str_list(translation, "source_locale_priority", DEFAULT_SOURCE_LOCALE_PRIORITY)
    result = extract_lang_json_result(mod_root, None, locale_priority, config)
    method = set_clipboard_text(result.json_text)
    raise ClipboardSourceAutoFetched(str(reason), result, method)


def is_supported_input_scan_path(path: Path) -> bool:
    if path.is_file():
        return path.suffix.lower() in ARCHIVE_EXTENSIONS

    if not path.is_dir():
        return False

    for rel_path in MOD_METADATA_PATHS:
        if (path / rel_path).is_file():
            return True

    assets_dir = path / "assets"
    if not assets_dir.is_dir():
        return False

    for namespace_dir in sorted([p for p in assets_dir.iterdir() if p.is_dir()]):
        lang_dir = namespace_dir / "lang"
        if not lang_dir.is_dir():
            continue
        for file in lang_dir.iterdir():
            if file.is_file() and file.suffix.lower() in LANG_FILE_EXTENSIONS:
                return True

    return False


def chunk_dict(data: dict[str, str], chunk_size: int) -> list[dict[str, str]]:
    items = list(data.items())
    chunks: list[dict[str, str]] = []
    for i in range(0, len(items), chunk_size):
        chunks.append(dict(items[i:i + chunk_size]))
    return chunks


def get_default_api_url(style: str, model: str) -> str:
    if style == "gemini_generate_content":
        return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    if style == "gemini_openai_chat":
        return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    if style == "openai_responses":
        return "https://api.openai.com/v1/responses"
    if style == "openai_chat_completions":
        return "https://api.openai.com/v1/chat/completions"
    if style == "anthropic_messages":
        return "https://api.anthropic.com/v1/messages"
    return ""


def get_api_key(api_section: dict[str, Any]) -> str:
    direct = cfg_str(api_section, "api_key_direct", "")
    if direct:
        return direct
    env_name = cfg_str(api_section, "api_key_env", "")
    if not env_name:
        raise RuntimeError("API キー用の環境変数名が空です。babel_breaker_app/config.toml の [api].api_key_env を設定してください。")
    key = os.getenv(env_name, "").strip()
    if not key:
        raise RuntimeError(f"API キーが見つかりません。環境変数 {env_name} を設定してください。")
    return key


def http_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"AI API HTTP エラー: {e.code} {e.reason}\n{detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"AI API 接続エラー: {e}") from e


def extract_text_from_openai_responses(data: dict[str, Any]) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    texts: list[str] = []
    output = data.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if isinstance(c, dict) and c.get("type") in ("output_text", "text"):
                    text = c.get("text")
                    if isinstance(text, str):
                        texts.append(text)

    merged = "\n".join(t for t in texts if t.strip()).strip()
    if merged:
        return merged
    raise RuntimeError("Responses API の応答からテキストを抽出できませんでした。")


def extract_text_from_chat_completions(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("Chat Completions の応答に choices がありません。")

    first = choices[0]
    if not isinstance(first, dict):
        raise RuntimeError("Chat Completions の応答形式が不正です。")

    message = first.get("message")
    if not isinstance(message, dict):
        raise RuntimeError("Chat Completions の応答に message がありません。")

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content

    if isinstance(content, list):
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    texts.append(text)
        merged = "\n".join(t for t in texts if t.strip()).strip()
        if merged:
            return merged

    raise RuntimeError("Chat Completions の応答からテキストを抽出できませんでした。")


def extract_text_from_gemini_generate_content(data: dict[str, Any]) -> str:
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise RuntimeError(f"Gemini の応答に candidates がありません。promptFeedback={data.get('promptFeedback')}")

    first = candidates[0]
    if not isinstance(first, dict):
        raise RuntimeError("Gemini の応答形式が不正です。")

    content = first.get("content")
    if not isinstance(content, dict):
        raise RuntimeError("Gemini の応答に content がありません。")

    parts = content.get("parts")
    if not isinstance(parts, list):
        raise RuntimeError("Gemini の応答に parts がありません。")

    texts: list[str] = []
    for part in parts:
        if isinstance(part, dict):
            text = part.get("text")
            if isinstance(text, str):
                texts.append(text)

    merged = "\n".join(t for t in texts if t.strip()).strip()
    if merged:
        return merged

    raise RuntimeError("Gemini の応答からテキストを抽出できませんでした。")


def extract_text_from_anthropic_messages(data: dict[str, Any]) -> str:
    content = data.get("content")
    if not isinstance(content, list) or not content:
        raise RuntimeError("Anthropic Messages の応答に content がありません。")

    texts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str):
                texts.append(text)

    merged = "\n".join(t for t in texts if t.strip()).strip()
    if merged:
        return merged

    raise RuntimeError("Anthropic Messages の応答からテキストを抽出できませんでした。")


def build_translation_prompt(
    chunk: dict[str, str],
    source_locale: str,
    target_language_name: str,
    mod_info: ModInfo,
    consistency_glossary: str,
    custom_prompt: str,
) -> str:
    sample_json = json.dumps(chunk, ensure_ascii=False, indent=2)
    extra_sections: list[str] = []

    if consistency_glossary:
        extra_sections.append(
            "Consistency glossary from earlier chunks. "
            "If the same source wording appears again, use the same translation unless it would break placeholders:\n"
            f"{consistency_glossary}"
        )

    if custom_prompt:
        extra_sections.append(
            "Additional project-specific instructions from config.toml. "
            "Follow them as long as they do not conflict with the JSON preservation rules:\n"
            f"{custom_prompt}"
        )

    extra_text = "\n\n".join(extra_sections)
    return f"""
You are a senior localization editor for Minecraft mod language files.

Context:
- Mod name: {mod_info.mod_name}
- Mod id: {mod_info.mod_id}
- Minecraft version: {mod_info.mc_version_expr or "unknown"}
- Preserve the mod's worldbuilding, tone, character, and terminology.
- If the mod is based on an existing anime, manga, game, or other franchise, use the established terminology and names of that work.
- If an official term is uncertain, keep the original proper noun instead of inventing an inaccurate translation.
- Keep recurring names, factions, items, skills, places, UI labels, and repeated wording consistent across the whole file.
- Prefer natural, polished in-game wording over literal machine translation.

Translate ONLY the JSON values from {source_locale} to {target_language_name}.

Hard rules:
- NEVER change JSON keys
- NEVER add keys
- NEVER remove keys
- NEVER rename keys
- Keys are internal IDs and must remain EXACTLY the same
- Return ONLY one valid JSON object
- Keep placeholders exactly intact:
  - printf tokens like %s, %1$s, %d
  - brace tokens like {{0}}, {{1}}
  - escaped newlines/tabs like \\n, \\t
  - Minecraft formatting codes like §a, §6, §r
- If a line is better left unchanged, keep it unchanged
- No markdown
- No code fences
- No explanations

{extra_text}

JSON:
{sample_json}
""".strip()


def call_ai_translate_chunk(
    chunk: dict[str, str],
    config: dict[str, Any],
    mod_info: ModInfo,
    consistency_glossary: str,
) -> dict[str, str]:
    translation = get_section(config, "translation")
    api = get_section(config, "api")

    target_language_name = cfg_str(translation, "target_language_name", "Japanese (日本語)")
    custom_prompt = cfg_str(translation, "custom_prompt", "")
    style = cfg_str(api, "style", "gemini_generate_content")
    model = cfg_str(api, "model", "gemini-2.5-flash")
    url = cfg_str(api, "url", "") or get_default_api_url(style, model)
    timeout = cfg_int(api, "timeout", 180)
    temperature = cfg_float(api, "temperature", 0.2)
    max_output_tokens = cfg_int(api, "max_output_tokens", 8192)
    anthropic_version = cfg_str(api, "anthropic_version", "2023-06-01")

    source_locale = "__source__"
    if "__meta_source_locale__" in chunk:
        source_locale = chunk["__meta_source_locale__"]
        chunk = {k: v for k, v in chunk.items() if k != "__meta_source_locale__"}

    prompt = build_translation_prompt(
        chunk,
        source_locale,
        target_language_name,
        mod_info,
        consistency_glossary,
        custom_prompt,
    )
    api_key = get_api_key(api)

    if style == "gemini_generate_content":
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
                "responseMimeType": "application/json",
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        }
        data = http_post_json(url, payload, headers, timeout)
        text = extract_text_from_gemini_generate_content(data)

    elif style in ("gemini_openai_chat", "openai_chat_completions", "openai_compatible_chat"):
        payload = {
            "model": model,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Minecraft mod localization editor. "
                        "Preserve lore, tone, established franchise terminology, and JSON keys. Return JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        data = http_post_json(url, payload, headers, timeout)
        text = extract_text_from_chat_completions(data)

    elif style in ("openai_responses", "openai_compatible_responses"):
        payload = {
            "model": model,
            "input": prompt,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        data = http_post_json(url, payload, headers, timeout)
        text = extract_text_from_openai_responses(data)

    elif style == "anthropic_messages":
        payload = {
            "model": model,
            "max_tokens": max_output_tokens,
            "system": (
                "You are an expert Minecraft mod localization editor. "
                "Preserve lore, tone, established franchise terminology, and JSON keys. Return JSON only."
            ),
            "messages": [
                {"role": "user", "content": prompt}
            ],
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": anthropic_version,
        }
        data = http_post_json(url, payload, headers, timeout)
        text = extract_text_from_anthropic_messages(data)

    else:
        raise RuntimeError(f"未対応の API スタイルです: {style}")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI の応答が有効な JSON ではありません: {e}\n{text}") from e

    return validate_lang_dict(parsed)


def translate_lang_dict_with_ai(
    source_map: dict[str, str],
    source_locale: str,
    config: dict[str, Any],
    mod_info: ModInfo,
    translation_memory_seed: dict[str, str] | None = None,
) -> dict[str, str]:
    translation = get_section(config, "translation")
    chunk_size = cfg_int(translation, "chunk_size", 120)
    repair = cfg_bool(translation, "repair_broken_placeholders", True)
    enforce_consistent_terms = cfg_bool(translation, "enforce_consistent_terms", True)

    items = list(source_map.items())
    chunks: list[dict[str, str]] = []
    for i in range(0, len(items), chunk_size):
        part = dict(items[i:i + chunk_size])
        part["__meta_source_locale__"] = source_locale
        chunks.append(part)

    merged: dict[str, str] = {}
    translation_memory: dict[str, str] = dict(translation_memory_seed or {})
    total = len(chunks)
    for idx, chunk in enumerate(chunks, start=1):
        print(f"[AI] 翻訳中 {idx}/{total} ...")
        consistency_glossary = build_translation_memory_glossary(translation_memory)
        translated_chunk = call_ai_translate_chunk(chunk, config, mod_info, consistency_glossary)
        original_chunk = {k: v for k, v in chunk.items() if k != "__meta_source_locale__"}
        cleaned_chunk, warnings = sanitize_translated_map(
            original_chunk,
            translated_chunk,
            repair,
            label="AI の応答",
        )
        warnings.extend(
            apply_translation_memory(
                original_chunk,
                cleaned_chunk,
                translation_memory,
                enforce_consistent_terms,
            )
        )
        for w in warnings:
            eprint(w)
        update_translation_memory(original_chunk, cleaned_chunk, translation_memory, enforce_consistent_terms)
        merged.update(cleaned_chunk)

    return merged


def find_icon_file(script_dir: Path, configured_icon_path: str) -> Path | None:
    assets_dir = get_assets_dir(script_dir)

    if configured_icon_path.strip():
        p = Path(configured_icon_path).expanduser()
        if not p.is_absolute():
            p = script_dir / p
        if p.is_file():
            return p

    for ext in ICON_EXT_PRIORITY:
        p = assets_dir / f"{DEFAULT_ICON_BASENAME}{ext}"
        if p.is_file():
            return p

    for ext in ICON_EXT_PRIORITY:
        p = script_dir / f"{DEFAULT_ICON_BASENAME}{ext}"
        if p.is_file():
            return p

    for p in sorted(assets_dir.glob(f"{DEFAULT_ICON_BASENAME}.*")):
        if p.is_file():
            return p

    for p in sorted(script_dir.glob(f"{DEFAULT_ICON_BASENAME}.*")):
        if p.is_file():
            return p

    return None


def maybe_convert_icon_to_png(icon_src: Path | None, pack_png_dest: Path) -> None:
    if icon_src is None:
        return

    if icon_src.suffix.lower() == ".png":
        shutil.copy2(icon_src, pack_png_dest)
        return

    try:
        from PIL import Image  # type: ignore
        with Image.open(icon_src) as im:
            im.save(pack_png_dest, format="PNG")
        return
    except Exception:
        pass

    if sys.platform == "darwin":
        try:
            subprocess.run(
                ["sips", "-s", "format", "png", str(icon_src), "--out", str(pack_png_dest)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            return
        except Exception:
            pass

    eprint(f"[WARN] アイコンを PNG 化できなかったため pack.png を省略します: {icon_src}")


def build_pack_mcmeta(description: str, pack_format: int, supported_formats: dict[str, int] | None) -> dict[str, Any]:
    pack: dict[str, Any] = {
        "pack": {
            "pack_format": pack_format,
            "description": description,
        }
    }
    if supported_formats:
        pack["pack"]["supported_formats"] = supported_formats
    return pack


def zip_pack_dir(pack_dir: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(pack_dir.rglob("*")):
            if path.is_file():
                zf.write(path, arcname=path.relative_to(pack_dir))


def format_template(template: str, values: dict[str, str]) -> str:
    class SafeDict(dict):
        def __missing__(self, key: str) -> str:
            return "unknown"
    return template.format_map(SafeDict(values))


def resolve_input_path(ctx: RuntimeContext, cli_input_path: str | None) -> Path:
    general = get_section(ctx.config, "general")
    input_scan = get_section(ctx.config, "input_scan")

    candidates: list[Path] = []

    if cli_input_path:
        candidates.append(Path(cli_input_path).expanduser())

    config_input = cfg_str(general, "input_path", "")
    if config_input:
        candidates.append(Path(config_input).expanduser())

    if cfg_bool(input_scan, "enabled", True):
        folder_name = cfg_str(input_scan, "folder", "input")
        scan_dir = ctx.script_dir / folder_name
        if scan_dir.is_dir():
            for p in sorted(scan_dir.iterdir()):
                if is_supported_input_scan_path(p):
                    candidates.append(p)

    for p in candidates:
        if p.exists():
            return p.resolve()

    raise RuntimeError(
        "入力ファイルが見つかりません。\n"
        "次のどれかを行ってください:\n"
        "1. 実行時に jar / フォルダを渡す\n"
        "2. babel_breaker_app/config.toml の [general].input_path を設定する\n"
        "3. input/ フォルダに jar を入れる"
    )


def unpack_if_needed(input_path: Path) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if input_path.is_dir():
        return input_path, None

    if input_path.is_file() and input_path.suffix.lower() in ARCHIVE_EXTENSIONS:
        temp_dir = tempfile.TemporaryDirectory(prefix="babel_breaker_unpacked_")
        unpack_root = Path(temp_dir.name)
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(unpack_root)
        return unpack_root, temp_dir

    raise RuntimeError(f"入力が jar / zip / フォルダ のいずれでもありません: {input_path}")


def build_translated_entries(mod_root: Path, mod_info: ModInfo, config: dict[str, Any]) -> list[TranslatedLangEntry]:
    translation = get_section(config, "translation")
    mode = cfg_str(translation, "mode", "ai").lower()

    if mode == "clipboard":
        try:
            text = get_clipboard_text()
            return validate_clipboard_translation_entries(mod_root, config, text)
        except Exception as e:
            maybe_auto_fetch_source_lang_for_clipboard(mod_root, mod_info, config, e)
            raise

    if mode == "file":
        return load_file_mode_translation_entries(mod_root, config)

    if mode == "ai":
        sources, skipped_target_only, skipped_completed = choose_translation_sources_for_pack(mod_root, config)
        translation = get_section(config, "translation")
        target_locale = cfg_str(translation, "target_locale", "ja_jp")
        if skipped_completed:
            for source in skipped_completed:
                print(f"[INFO] {source.namespace} は既存の {target_locale}.json が十分に埋まっているため翻訳対象から外します: {source.path}")
        translated_entries: list[TranslatedLangEntry] = []
        total = len(sources)
        for index, plan in enumerate(sources, start=1):
            source = plan.source
            prefix = f"[AI {index}/{total}]" if total > 1 else "[AI]"
            print(f"{prefix} 元 lang ファイル: {source.path}")
            if plan.source_is_target_locale_fallback:
                print(
                    f"{prefix} {source.namespace} は {source.locale}.json しか無いため、この既存 lang を source として補完翻訳します。"
                )
            if plan.existing_target_source and plan.reused_source_key_count:
                print(
                    f"{prefix} 既存の {target_locale}.json を再利用: namespace={source.namespace} keep={plan.reused_source_key_count} translate={len(plan.pending_source_data)}"
                )
            pending_source_map = plan.pending_source_data
            translation_memory_seed = build_translation_memory_seed(
                plan.source_data,
                pending_source_map,
                plan.preserved_target_data,
            )
            translated = translate_lang_dict_with_ai(
                pending_source_map,
                (
                    f"{source.locale} (existing target-locale file; keep already natural target-language lines unchanged and translate only unfinished or foreign-language lines)"
                    if plan.source_is_target_locale_fallback
                    else source.locale
                ),
                config,
                mod_info,
                translation_memory_seed=translation_memory_seed,
            )
            merged = dict(plan.preserved_target_data)
            merged.update(translated)
            translated_entries.append(TranslatedLangEntry(source=source, data=merged))
        return translated_entries

    raise RuntimeError(f"未対応の translation.mode です: {mode}")


def create_pack_name(mod_info: ModInfo, config: dict[str, Any], target_locale: str) -> str:
    pack = get_section(config, "pack")
    template = cfg_str(pack, "pack_name_template", "{app_name}_{mod_name}_{mod_version}_{target_locale}")
    values = {
        "app_name": APP_NAME,
        "mod_name": mod_info.mod_name,
        "mod_version": mod_info.mod_version,
        "mod_id": mod_info.mod_id,
        "target_locale": target_locale,
        "mc_version_expr": mod_info.mc_version_expr or "unknown",
    }
    return safe_fs_name(format_template(template, values))


def create_description(mod_info: ModInfo, config: dict[str, Any], target_locale: str) -> str:
    pack = get_section(config, "pack")
    template = cfg_str(pack, "description_template", "{app_name} | {mod_name} {mod_version} -> {target_locale} | MC {mc_version_expr}")
    values = {
        "app_name": APP_NAME,
        "mod_name": mod_info.mod_name,
        "mod_version": mod_info.mod_version,
        "mod_id": mod_info.mod_id,
        "target_locale": target_locale,
        "mc_version_expr": mod_info.mc_version_expr or "unknown",
    }
    return format_template(template, values)


def create_output_paths(ctx: RuntimeContext, pack_name: str) -> tuple[Path, Path, bool]:
    general = get_section(ctx.config, "general")
    pack = get_section(ctx.config, "pack")

    output_dir_name = cfg_str(general, "output_dir", DEFAULT_OUTPUT_ROOT)
    output_root = ctx.script_dir / output_dir_name
    output_root.mkdir(parents=True, exist_ok=True)

    keep_folder = cfg_bool(pack, "keep_folder", False)
    pack_dir = output_root / pack_name
    zip_path = output_root / f"{pack_name}.zip"

    if zip_path.exists():
        zip_path.unlink()

    return pack_dir, zip_path, keep_folder


def create_extract_output_path(ctx: RuntimeContext, input_path: Path) -> Path:
    general = get_section(ctx.config, "general")
    output_dir_name = cfg_str(general, "output_dir", DEFAULT_OUTPUT_ROOT)
    output_root = ctx.script_dir / output_dir_name
    file_name = f"{safe_fs_name(input_path.stem or 'source_lang')}.json"
    return output_root / "_extracted_lang" / file_name


def write_pack_files(
    build_dir: Path,
    icon_src: Path | None,
    mod_info: ModInfo,
    mod_root: Path,
    translated_entries: list[TranslatedLangEntry],
    target_locale: str,
    pack_format: int,
    supported_formats: dict[str, int] | None,
    description: str,
    config: dict[str, Any],
) -> None:
    for entry in translated_entries:
        lang_dir = build_dir / "assets" / entry.source.namespace / "lang"
        lang_dir.mkdir(parents=True, exist_ok=True)
        out_lang_path = lang_dir / f"{target_locale}.json"
        out_lang_path.write_text(
            json.dumps(entry.data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

    mcmeta = build_pack_mcmeta(description, pack_format, supported_formats)
    (build_dir / "pack.mcmeta").write_text(
        json.dumps(mcmeta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    maybe_convert_icon_to_png(icon_src, build_dir / "pack.png")

    api = get_section(config, "api")
    translation = get_section(config, "translation")
    source_locales = ", ".join(f"{entry.source.namespace}:{entry.source.locale}" for entry in translated_entries)

    info_txt = (
        f"app_name={APP_NAME}\n"
        f"mod_name={mod_info.mod_name}\n"
        f"mod_version={mod_info.mod_version}\n"
        f"mod_id={mod_info.mod_id}\n"
        f"loader={mod_info.loader}\n"
        f"mc_version_expr={mod_info.mc_version_expr}\n"
        f"target_locale={target_locale}\n"
        f"target_language_name={cfg_str(translation, 'target_language_name', 'Japanese (日本語)')}\n"
        f"source_locale={translated_entries[0].source.locale if len(translated_entries) == 1 else 'multiple'}\n"
        f"source_locales={source_locales}\n"
        f"source_mod_root={mod_root}\n"
        f"api_style={cfg_str(api, 'style', '')}\n"
        f"api_model={cfg_str(api, 'model', '')}\n"
        f"api_url={cfg_str(api, 'url', '') or get_default_api_url(cfg_str(api, 'style', ''), cfg_str(api, 'model', ''))}\n"
        f"pack_format={pack_format}\n"
        f"supported_formats={supported_formats}\n"
    )
    (build_dir / "_generated_info.txt").write_text(info_txt, encoding="utf-8", newline="\n")


def create_resource_pack(ctx: RuntimeContext, original_input_path: Path, mod_root: Path) -> tuple[Path | None, Path]:
    translation = get_section(ctx.config, "translation")
    minecraft = get_section(ctx.config, "minecraft")
    pack = get_section(ctx.config, "pack")

    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    mod_info = detect_mod_info(mod_root)
    maybe_cancel_if_target_locale_exists(mod_root, None, ctx.config, "リソースパック生成")

    if mod_info.mod_version in ("", "unknown", "${file.jarVersion}"):
        guessed_name, guessed_ver, guessed_mc = guess_from_folder_name(original_input_path if original_input_path.is_dir() else mod_root)
        if guessed_ver:
            mod_info.mod_version = guessed_ver
        if not mod_info.mc_version_expr and guessed_mc:
            mod_info.mc_version_expr = guessed_mc

    forced_mc_version = cfg_str(minecraft, "mc_version", "")
    if forced_mc_version:
        min_ver, max_ver = parse_version_spec(forced_mc_version)
        mod_info.mc_version_expr = forced_mc_version
    else:
        min_ver, max_ver = infer_versions_from_expr(mod_info.mc_version_expr)

    pack_format, supported_formats = resolve_pack_formats_from_versions(min_ver, max_ver)
    translated_entries = build_translated_entries(mod_root, mod_info, ctx.config)

    pack_name = create_pack_name(mod_info, ctx.config, target_locale)
    description = create_description(mod_info, ctx.config, target_locale)
    pack_dir, zip_path, keep_folder = create_output_paths(ctx, pack_name)

    if keep_folder:
        if pack_dir.exists():
            shutil.rmtree(pack_dir)
        build_dir = pack_dir
    else:
        build_dir = Path(tempfile.mkdtemp(prefix="babel_breaker_pack_", dir=pack_dir.parent))

    configured_icon_path = cfg_str(pack, "icon_path", "")
    icon_src = find_icon_file(ctx.script_dir, configured_icon_path)

    write_pack_files(
        build_dir=build_dir,
        icon_src=icon_src,
        mod_info=mod_info,
        mod_root=mod_root,
        translated_entries=translated_entries,
        target_locale=target_locale,
        pack_format=pack_format,
        supported_formats=supported_formats,
        description=description,
        config=ctx.config,
    )

    if cfg_bool(pack, "create_zip", True):
        zip_pack_dir(build_dir, zip_path)
    else:
        raise RuntimeError("このツールは ZIP 生成前提です。babel_breaker_app/config.toml の [pack].create_zip は true にしてください。")

    if keep_folder:
        return build_dir, zip_path

    shutil.rmtree(build_dir, ignore_errors=True)
    return None, zip_path


def run_extract_mode(ctx: RuntimeContext, cli_input_path: str | None, args: argparse.Namespace) -> int:
    translation = get_section(ctx.config, "translation")
    file_mode_active = cfg_str(translation, "mode", "ai").lower() == "file"
    skip_clipboard = args.extract_no_clipboard or file_mode_active
    if skip_clipboard and not args.extract_output.strip() and not file_mode_active:
        eprint("[ERROR] --extract-no-clipboard を使う場合は、あわせて --extract-output を指定してください。")
        return 1

    try:
        input_path = resolve_input_path(ctx, cli_input_path)
        vprint(ctx, f"[INFO] 入力: {input_path}")

        mod_root, temp_dir = unpack_if_needed(input_path)
        try:
            locale_priority = normalize_locale_priority(args.extract_locale)
            preferred_namespace = choose_namespace_for_extraction(mod_root, args.extract_namespace.strip() or None)
            maybe_cancel_if_target_locale_exists(mod_root, preferred_namespace, ctx.config, "元 lang 抽出")
            result = extract_lang_json_result(mod_root, preferred_namespace, locale_priority, ctx.config)
        finally:
            if temp_dir is not None:
                temp_dir.cleanup()
    except TargetLocaleAlreadyExists as e:
        print(f"[INFO] {e}")
        return 0
    except Exception as e:
        eprint(f"[ERROR] {e}")
        return 1

    if len(result.entries) == 1:
        print(f"[OK] 抽出元: {result.source.path}")
        print(f"[OK] namespace: {result.source.namespace}")
        print(f"[OK] locale: {result.source.locale}")
        print(f"[OK] キー数: {len(result.data)}")
    else:
        print(f"[OK] 抽出対象 namespace 数: {len(result.entries)}")
        total_keys = 0
        for entry in result.entries:
            total_keys += len(entry.data)
            print(f"[OK] - namespace={entry.source.namespace} locale={entry.source.locale} keys={len(entry.data)} path={entry.source.path}")
        print(f"[OK] 合計キー数: {total_keys}")

    output_path = args.extract_output.strip()
    if file_mode_active:
        output_path = str(ensure_json_output_path(Path(output_path))) if output_path else str(create_extract_output_path(ctx, input_path))
    if output_path:
        saved_path = write_output_text_file(Path(output_path), result.json_text)
        print(f"[OK] ファイル保存: {saved_path}")

    if file_mode_active:
        print("[INFO] file モードのため、抽出結果は JSON ファイル保存のみ行います。")

    if not skip_clipboard:
        try:
            method = set_clipboard_text(result.json_text)
            print(f"[OK] クリップボードへコピーしました: {method}")
        except Exception as e:
            if not output_path:
                eprint(f"[ERROR] クリップボードへのコピーに失敗しました: {e}")
                return 1
            eprint(f"[WARN] クリップボードへのコピーに失敗しましたが、ファイル保存は完了しています: {e}")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m babel_breaker_app",
        description="Babel Breaker: babel_breaker_app/config.toml を使って Minecraft mod の lang を翻訳し、リソースパック ZIP を作ります。"
    )
    parser.add_argument(
        "-g",
        "--gui",
        action="store_true",
        help="ブラウザ GUI を起動します。設定編集、元 lang 抽出、リソースパック生成を画面から行えます。",
    )
    parser.add_argument(
        "input_path",
        nargs="?",
        help="mod の .jar または解凍済みフォルダ。省略時は babel_breaker_app/config.toml と input/ を参照します。",
    )
    parser.add_argument(
        "-x",
        "--extract-lang",
        action="store_true",
        help="リソースパックを作らず、mod の元 lang JSON を取り出します。",
    )
    parser.add_argument(
        "-o",
        "--extract-output",
        default="",
        help="--extract-lang の時に、取り出した JSON を保存するファイルパスです。",
    )
    parser.add_argument(
        "-c",
        "--extract-no-clipboard",
        action="store_true",
        help="--extract-lang の時に、クリップボードへコピーせずファイル保存だけにします。",
    )
    parser.add_argument(
        "-l",
        "--extract-locale",
        action="append",
        default=[],
        help="--extract-lang の時に優先したい locale を指定します。複数回指定可。",
    )
    parser.add_argument(
        "-n",
        "--extract-namespace",
        default="",
        help="--extract-lang の時に優先したい namespace(mod_id) を指定します。",
    )
    parser.add_argument(
        "-a",
        "--no-auto-fetch-source-lang",
        action="store_true",
        help="clipboard モードで対応 JSON が見つからなくても、元 lang JSON の自動取得を行いません。",
    )
    args = parser.parse_args(argv)

    script_dir = detect_project_root()
    config_path = get_config_path(script_dir)
    config_path = migrate_legacy_root_config(script_dir, config_path)

    if args.gui:
        try:
            from .web_gui import launch_web_gui_app
        except ImportError:
            from web_gui import launch_web_gui_app

        return launch_web_gui_app(sys.modules[__name__], script_dir, config_path)

    if not config_path.exists() and not args.extract_lang:
        ensure_config_file(config_path)
        print("[INFO] babel_breaker_app/config.toml が無かったため、見本を自動生成しました。")
        print(f"[INFO] ここを編集してください: {config_path}")
        return 0

    config: dict[str, Any] = {}
    if config_path.exists():
        try:
            config = load_toml(config_path)
        except Exception as e:
            eprint(f"[ERROR] babel_breaker_app/config.toml の読み込みに失敗しました: {e}")
            return 1

    if args.no_auto_fetch_source_lang:
        clipboard_cfg = config.setdefault("clipboard", {})
        if isinstance(clipboard_cfg, dict):
            clipboard_cfg["auto_fetch_source_when_missing"] = False

    general = get_section(config, "general")
    ctx = RuntimeContext(
        script_dir=script_dir,
        config_path=config_path,
        config=config,
        verbose=cfg_bool(general, "verbose", False),
    )

    if args.extract_lang:
        return run_extract_mode(ctx, args.input_path, args)

    try:
        input_path = resolve_input_path(ctx, args.input_path)
        vprint(ctx, f"[INFO] 入力: {input_path}")

        mod_root, temp_dir = unpack_if_needed(input_path)
        try:
            pack_dir, zip_path = create_resource_pack(ctx, input_path, mod_root)
        finally:
            if temp_dir is not None:
                temp_dir.cleanup()

    except ClipboardSourceAutoFetched as e:
        print("[INFO] クリップボードにこの mod 用の翻訳 JSON が見つからなかったため、元 lang JSON を自動取得しました。")
        if len(e.result.entries) == 1:
            print(f"[INFO] 元 lang ファイル: {e.result.source.path}")
            print(f"[INFO] namespace: {e.result.source.namespace}")
            print(f"[INFO] locale: {e.result.source.locale}")
        else:
            print(f"[INFO] 抽出対象 namespace 数: {len(e.result.entries)}")
            for entry in e.result.entries:
                print(f"[INFO] - namespace={entry.source.namespace} locale={entry.source.locale} path={entry.source.path}")
        print(f"[INFO] クリップボード: {e.clipboard_method}")
        print("[INFO] この JSON の値だけ翻訳して、もう一度実行してください。")
        return 0
    except TargetLocaleAlreadyExists as e:
        print(f"[INFO] {e}")
        return 0
    except Exception as e:
        eprint(f"[ERROR] {e}")
        return 1

    print(f"[OK] {APP_NAME} がリソースパックを生成しました。")
    print(f"ZIPファイル  : {zip_path}")
    if pack_dir is not None:
        print(f"展開フォルダ: {pack_dir}")
    else:
        print("今回は ZIP のみ生成しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
