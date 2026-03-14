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
   - このファイルと同じ場所に config.toml を置く
   - icon.png を置く（無くても動くが pack.png は付かない）
   - 必要なら API キーを環境変数に入れる

2. いちばん簡単な実行
   python3 babel_breaker.py

3. jar を直接指定
   python3 babel_breaker.py "/path/to/mod.jar"

4. 解凍済みフォルダを指定
   python3 babel_breaker.py "/path/to/unpacked_mod"

------------------------------------------------------------
モード
------------------------------------------------------------

A. clipboard モード
   - config.toml の translation.mode = "clipboard"
   - すでに翻訳済みの JSON をクリップボードから読む
   - それを <target_locale>.json として pack 化する

B. ai モード
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

- Python 3.10 以上推奨
- config.toml
- 入力 mod（jar のままでも、解凍済みでも可）

AI モードで追加:
- API キー

あると便利:
- Pillow
- tomli（Python 3.10系で tomllib が無い場合）

例:
  pip install pillow tomli
"""

from __future__ import annotations

import argparse
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
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # type: ignore
    except ImportError:
        tomllib = None


CONFIG_TEMPLATE = r'''# ============================================================
# Babel Breaker 設定ファイル
# ============================================================
#
# これは Minecraft mod の lang ファイルを翻訳し、
# resourcepacks に入れられる ZIP を自動生成するための設定です。
#
# 使い方:
#   1. 必要なところだけ書き換える
#   2. 保存する
#   3. python3 babel_breaker.py を実行する
#
# まず困ったら:
#   - translation.mode を "ai" にするか "clipboard" にするか確認
#   - api.style / api_key_env を確認
#   - general.input_path を入れるか、実行時に jar を渡す
# ============================================================

[general]
input_path = ""
output_dir = "_babel_breaker_output"
verbose = true

[translation]
mode = "ai"
target_locale = "ja_jp"
target_language_name = "Japanese (日本語)"
source_locale_priority = ["en_us", "en_gb"]
chunk_size = 120
repair_broken_placeholders = true

[pack]
create_zip = true
keep_folder = false
icon_path = ""
pack_name_template = "{app_name}_{mod_name}_{mod_version}_{target_locale}"
description_template = "{app_name} | {mod_name} {mod_version} -> {target_locale} | MC {mc_version_expr}"

[minecraft]
mc_version = ""

[api]
style = "gemini_generate_content"
model = "gemini-2.5-flash"
url = ""
api_key_env = "GEMINI_API_KEY"
api_key_direct = ""
timeout = 180
temperature = 0.2
max_output_tokens = 8192
anthropic_version = "2023-06-01"

[clipboard]
enabled = true

[input_scan]
folder = "input"
enabled = true
'''


APP_NAME = "Babel Breaker"
DEFAULT_OUTPUT_ROOT = "_babel_breaker_output"
DEFAULT_ICON_BASENAME = "icon"
ICON_EXT_PRIORITY = [".png", ".webp", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]

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
    config_path.write_text(CONFIG_TEMPLATE, encoding="utf-8", newline="\n")


def load_toml(path: Path) -> dict[str, Any]:
    if tomllib is None:
        raise RuntimeError("Python 3.11+ か tomli が必要です。Python 3.10 の場合は `pip install tomli` を実行してください。")
    with path.open("rb") as f:
        return tomllib.load(f)


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

    try:
        import tkinter as tk
    except Exception as e:
        raise RuntimeError("クリップボードを読むには macOS の pbpaste か tkinter が必要です。") from e

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

    data = load_toml(mods_toml)
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

    data = json.loads(fabric_json.read_text(encoding="utf-8"))
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

    data = json.loads(quilt_json.read_text(encoding="utf-8"))
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
        try:
            info = parser(mod_root)
            if info:
                if info.mod_version in ("", "${file.jarVersion}"):
                    info.mod_version = read_manifest_version(mod_root) or info.mod_version or "unknown"
                return info
        except Exception:
            pass
    return fallback_from_assets(mod_root)


def parse_lang_json_file(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return validate_lang_dict(data)


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
            if ext not in (".json", ".lang"):
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


def sanitize_translated_map(source_chunk: dict[str, str], translated_chunk: dict[str, str], repair: bool) -> tuple[dict[str, str], list[str]]:
    warnings: list[str] = []

    source_keys = list(source_chunk.keys())
    translated_keys = list(translated_chunk.keys())
    if set(source_keys) != set(translated_keys):
        missing = [k for k in source_keys if k not in translated_chunk]
        extra = [k for k in translated_keys if k not in source_chunk]
        raise RuntimeError(f"AI がキーを壊しました。missing={missing[:10]} extra={extra[:10]}")

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
        raise RuntimeError("API キー用の環境変数名が空です。config.toml の [api].api_key_env を設定してください。")
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


def build_translation_prompt(chunk: dict[str, str], source_locale: str, target_language_name: str) -> str:
    sample_json = json.dumps(chunk, ensure_ascii=False, indent=2)
    return f"""
You are a localization engine for Minecraft mod language files.

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

JSON:
{sample_json}
""".strip()


def call_ai_translate_chunk(chunk: dict[str, str], config: dict[str, Any]) -> dict[str, str]:
    translation = get_section(config, "translation")
    api = get_section(config, "api")

    target_language_name = cfg_str(translation, "target_language_name", "Japanese (日本語)")
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

    prompt = build_translation_prompt(chunk, source_locale, target_language_name)
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
                    "content": "You translate Minecraft mod lang JSON values only. Never modify keys. Return JSON only.",
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
            "system": "You translate Minecraft mod lang JSON values only. Never modify keys. Return JSON only.",
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


def translate_lang_dict_with_ai(source_map: dict[str, str], source_locale: str, config: dict[str, Any]) -> dict[str, str]:
    translation = get_section(config, "translation")
    chunk_size = cfg_int(translation, "chunk_size", 120)
    repair = cfg_bool(translation, "repair_broken_placeholders", True)

    items = list(source_map.items())
    chunks: list[dict[str, str]] = []
    for i in range(0, len(items), chunk_size):
        part = dict(items[i:i + chunk_size])
        part["__meta_source_locale__"] = source_locale
        chunks.append(part)

    merged: dict[str, str] = {}
    total = len(chunks)
    for idx, chunk in enumerate(chunks, start=1):
        print(f"[AI] 翻訳中 {idx}/{total} ...")
        translated_chunk = call_ai_translate_chunk(chunk, config)
        original_chunk = {k: v for k, v in chunk.items() if k != "__meta_source_locale__"}
        cleaned_chunk, warnings = sanitize_translated_map(original_chunk, translated_chunk, repair)
        for w in warnings:
            eprint(w)
        merged.update(cleaned_chunk)

    return merged


def find_icon_file(script_dir: Path, configured_icon_path: str) -> Path | None:
    if configured_icon_path.strip():
        p = Path(configured_icon_path).expanduser()
        if not p.is_absolute():
            p = script_dir / p
        if p.is_file():
            return p

    for ext in ICON_EXT_PRIORITY:
        p = script_dir / f"{DEFAULT_ICON_BASENAME}{ext}"
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
                if p.is_file() and p.suffix.lower() in (".jar", ".zip"):
                    candidates.append(p)
                    break
                if p.is_dir():
                    candidates.append(p)
                    break

    for p in candidates:
        if p.exists():
            return p.resolve()

    raise RuntimeError(
        "入力ファイルが見つかりません。\n"
        "次のどれかを行ってください:\n"
        "1. 実行時に jar / フォルダを渡す\n"
        "2. config.toml の [general].input_path を設定する\n"
        "3. input/ フォルダに jar を入れる"
    )


def unpack_if_needed(input_path: Path) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if input_path.is_dir():
        return input_path, None

    if input_path.is_file() and input_path.suffix.lower() in (".jar", ".zip"):
        temp_dir = tempfile.TemporaryDirectory(prefix="babel_breaker_unpacked_")
        unpack_root = Path(temp_dir.name)
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(unpack_root)
        return unpack_root, temp_dir

    raise RuntimeError(f"入力が jar / zip / フォルダ のいずれでもありません: {input_path}")


def choose_translation_source(mod_root: Path, mod_info: ModInfo, config: dict[str, Any]) -> LangSource:
    translation = get_section(config, "translation")
    target_locale = cfg_str(translation, "target_locale", "ja_jp")
    source_priority = cfg_str_list(translation, "source_locale_priority", ["en_us", "en_gb"])

    sources = discover_lang_sources(mod_root)
    best = choose_best_lang_source(sources, mod_info.mod_id, source_priority, target_locale)
    if not best:
        raise RuntimeError("翻訳元に使える lang ファイルが見つかりませんでした。")
    return best


def build_translated_map(mod_root: Path, mod_info: ModInfo, config: dict[str, Any]) -> tuple[dict[str, str], str]:
    translation = get_section(config, "translation")
    mode = cfg_str(translation, "mode", "ai").lower()

    if mode == "clipboard":
        text = get_clipboard_text()
        return validate_lang_dict(json.loads(text)), "clipboard"

    if mode == "ai":
        source = choose_translation_source(mod_root, mod_info, config)
        print(f"[AI] 元 lang ファイル: {source.path}")
        source_map = load_lang_source_dict(source)
        translated = translate_lang_dict_with_ai(source_map, source.locale, config)
        return translated, source.locale

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


def write_pack_files(
    build_dir: Path,
    icon_src: Path | None,
    mod_info: ModInfo,
    mod_root: Path,
    translated_map: dict[str, str],
    target_locale: str,
    source_locale: str,
    pack_format: int,
    supported_formats: dict[str, int] | None,
    description: str,
    config: dict[str, Any],
) -> None:
    lang_dir = build_dir / "assets" / mod_info.mod_id / "lang"
    lang_dir.mkdir(parents=True, exist_ok=True)

    out_lang_path = lang_dir / f"{target_locale}.json"
    out_lang_path.write_text(
        json.dumps(translated_map, ensure_ascii=False, indent=2) + "\n",
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

    info_txt = (
        f"app_name={APP_NAME}\n"
        f"mod_name={mod_info.mod_name}\n"
        f"mod_version={mod_info.mod_version}\n"
        f"mod_id={mod_info.mod_id}\n"
        f"loader={mod_info.loader}\n"
        f"mc_version_expr={mod_info.mc_version_expr}\n"
        f"target_locale={target_locale}\n"
        f"target_language_name={cfg_str(translation, 'target_language_name', 'Japanese (日本語)')}\n"
        f"source_locale={source_locale}\n"
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
    translated_map, source_locale = build_translated_map(mod_root, mod_info, ctx.config)

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
        translated_map=translated_map,
        target_locale=target_locale,
        source_locale=source_locale,
        pack_format=pack_format,
        supported_formats=supported_formats,
        description=description,
        config=ctx.config,
    )

    if cfg_bool(pack, "create_zip", True):
        zip_pack_dir(build_dir, zip_path)
    else:
        raise RuntimeError("このツールは ZIP 生成前提です。config.toml の [pack].create_zip は true にしてください。")

    if keep_folder:
        return build_dir, zip_path

    shutil.rmtree(build_dir, ignore_errors=True)
    return None, zip_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Babel Breaker: config.toml を使って Minecraft mod の lang を翻訳し、リソースパック ZIP を作ります。"
    )
    parser.add_argument(
        "input_path",
        nargs="?",
        help="mod の .jar または解凍済みフォルダ。省略時は config.toml と input/ を参照します。",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    config_path = script_dir / "config.toml"

    if not config_path.exists():
        ensure_config_file(config_path)
        print("[INFO] config.toml が無かったため、見本を自動生成しました。")
        print(f"[INFO] ここを編集してください: {config_path}")
        return 0

    try:
        config = load_toml(config_path)
    except Exception as e:
        eprint(f"[ERROR] config.toml の読み込みに失敗しました: {e}")
        return 1

    general = get_section(config, "general")
    ctx = RuntimeContext(
        script_dir=script_dir,
        config_path=config_path,
        config=config,
        verbose=cfg_bool(general, "verbose", True),
    )

    try:
        input_path = resolve_input_path(ctx, args.input_path)
        vprint(ctx, f"[INFO] 入力: {input_path}")

        mod_root, temp_dir = unpack_if_needed(input_path)
        try:
            pack_dir, zip_path = create_resource_pack(ctx, input_path, mod_root)
        finally:
            if temp_dir is not None:
                temp_dir.cleanup()

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