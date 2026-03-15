#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations


FIELD_SPECS = {
    "general": [
        ("input_path", "入力 mod パス", "str"),
        ("output_dir", "出力フォルダ", "str"),
        ("verbose", "詳細ログを表示", "bool"),
    ],
    "translation": [
        ("mode", "翻訳モード", "str"),
        ("target_locale", "出力 locale", "str"),
        ("cancel_if_target_locale_exists", "目的 locale 済みなら中止", "bool"),
        ("target_language_name", "翻訳先言語名", "str"),
        ("source_locale_priority", "元 locale 優先順", "list"),
        ("chunk_size", "1回の翻訳キー数", "int"),
        ("repair_broken_placeholders", "壊れたプレースホルダを原文に戻す", "bool"),
        ("enforce_consistent_terms", "同じ原文の訳語を揃える", "bool"),
        ("custom_prompt", "AI 追加指示", "multiline"),
    ],
    "pack": [
        ("create_zip", "ZIP を作る", "bool"),
        ("keep_folder", "展開フォルダも残す", "bool"),
        ("icon_path", "pack.png 用アイコン", "str"),
        ("pack_name_template", "パック名テンプレート", "str"),
        ("description_template", "説明テンプレート", "str"),
    ],
    "minecraft": [
        ("mc_version", "Minecraft バージョン固定", "str"),
    ],
    "api": [
        ("style", "API スタイル", "str"),
        ("model", "モデル名", "str"),
        ("url", "API URL", "str"),
        ("api_key_env", "API キー環境変数", "str"),
        ("api_key_direct", "API キー直書き", "str"),
        ("timeout", "タイムアウト秒", "int"),
        ("temperature", "温度", "float"),
        ("max_output_tokens", "最大出力トークン", "int"),
        ("anthropic_version", "Anthropic バージョン", "str"),
    ],
    "clipboard": [
        ("enabled", "clipboard モードを使う", "bool"),
        ("auto_fetch_source_when_missing", "不足時に元 lang JSON を自動取得", "bool"),
    ],
    "input_scan": [
        ("folder", "自動探索フォルダ名", "str"),
        ("enabled", "input/ 自動探索を使う", "bool"),
    ],
}

API_STYLE_OPTIONS = [
    "gemini_generate_content",
    "gemini_openai_chat",
    "openai_responses",
    "openai_chat_completions",
    "anthropic_messages",
    "openai_compatible_chat",
    "openai_compatible_responses",
]

TRANSLATION_MODE_OPTIONS = ["clipboard", "ai"]
