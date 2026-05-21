#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import cgi
import contextlib
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

try:
    from .gui_shared import API_STYLE_OPTIONS, FIELD_SPECS, TRANSLATION_MODE_OPTIONS
except ImportError:
    from gui_shared import API_STYLE_OPTIONS, FIELD_SPECS, TRANSLATION_MODE_OPTIONS

X_URL = "https://x.com/IGNORANZ_P"
GITHUB_URL = "https://github.com/IGNORANZ-PROJECT/BabelBreaker"


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


SECTION_TITLES = {
    "general": "基本",
    "translation": "翻訳",
    "file_mode": "file モード",
    "pack": "パック",
    "api": "API",
    "clipboard": "clipboard",
    "input_scan": "input 自動探索",
    "minecraft": "Minecraft",
}

SECTION_DESCRIPTIONS = {
    "general": "入力 mod と出力先の設定です。パスは直接貼り付けるか、右側の選択ボタンを使えます。",
    "translation": "AI / file / clipboard モードの切り替え、locale、用語統一、カスタム指示を設定します。",
    "file_mode": "file モードの時だけ使う翻訳データ入力です。複数ファイルと直接貼り付けを併用できます。",
    "pack": "生成するリソースパックの名前、説明、アイコン、保持方式を設定します。",
    "api": "AI モード専用です。通常は API キー環境変数と model を設定します。",
    "clipboard": "clipboard モード補助設定です。翻訳元 JSON の自動取得を制御します。",
    "input_scan": "input/ 自動探索の設定です。普段使いでは空のままでも問題ありません。",
    "minecraft": "Minecraft バージョンの固定が必要な時だけ使います。",
}

FIELD_HELP = {
    ("translation", "cancel_if_target_locale_exists"): "目的 locale が十分に入っている namespace は外し、一部未翻訳なら既存訳を残したまま不足分だけ補完します。",
    ("translation", "custom_prompt"): "作品用語、口調、公式訳優先ルールなどを自由に書けます。",
    ("translation", "source_locale_priority"): "カンマ区切りで入力します。例: en_us, en_gb",
    ("file_mode", "translation_files_text"): "1 行 1 ファイル。JSON / TXT を混在できます。1 ファイルに複数 mod 分の辞書が入っていても探索します。",
    ("file_mode", "inline_translation_text"): "翻訳済み JSON をそのまま貼り付けるか、複数の JSON ブロックをまとめて貼り付けられます。",
    ("api", "api_key_direct"): "必要な場合だけ使ってください。通常は環境変数推奨です。",
}

PATH_PICKERS = {
    ("general", "input_path"): [
        ("JAR/ZIP を選ぶ", "input_file"),
        ("フォルダを選ぶ", "input_dir"),
    ],
    ("general", "output_dir"): [
        ("フォルダを選ぶ", "output_dir"),
    ],
    ("pack", "icon_path"): [
        ("画像を選ぶ", "icon_file"),
    ],
}

EXTRACT_FIELD_SPECS = [
    ("extract_output", "保存先ファイル", "str"),
    ("extract_locale", "locale 優先順", "str"),
    ("extract_namespace", "namespace 指定", "str"),
    ("extract_no_clipboard", "クリップボードへ入れず、ファイルだけ保存する", "bool"),
]

SESSION_STALE_SECONDS = 120.0
SESSION_CLOSE_GRACE_SECONDS = 3.0


class MemoryWriter:
    def __init__(self, app: "WebGUIApp", stream_name: str) -> None:
        self.app = app
        self.stream_name = stream_name

    def write(self, text: str) -> int:
        if text:
            self.app.append_log(text, self.stream_name)
        return len(text)

    def flush(self) -> None:
        return


class WebGUIApp:
    def __init__(self, core: Any, script_dir: Path, config_path: Path) -> None:
        self.core = core
        self.script_dir = script_dir
        self.config_path = config_path
        self.lock = threading.Lock()
        self.worker: threading.Thread | None = None
        self.server: ThreadingHTTPServer | None = None
        self.status = "準備完了"
        self.log_text = ""
        self.log_revision = 0
        self.config_data = self.load_or_default_config()
        self.upload_temp_dir = tempfile.TemporaryDirectory(prefix="babel_breaker_web_gui_")
        self.selected_input_path = str(self.config_data.get("general", {}).get("input_path", "")).strip()
        self.queue_serial = 0
        self.queue_items: list[dict[str, str]] = []
        self.current_job: dict[str, str] | None = None
        self.progress_action = ""
        self.progress_completed = 0
        self.progress_failures = 0
        self.extract_state = {
            "extract_output": "",
            "extract_locale": ", ".join(self.config_data.get("translation", {}).get("source_locale_priority", ["en_us", "en_gb"])),
            "extract_namespace": "",
            "extract_no_clipboard": False,
        }
        self.browser_sessions: dict[str, float] = {}
        self.auto_shutdown_armed = False
        self.no_session_since: float | None = None
        self.shutdown_requested = False
        if not self.config_path.exists():
            self.append_log(
                "[INFO] babel_breaker_app/config.toml はまだありません。GUI で設定を調整して「設定を保存」か「リソースパック生成」を押すと作成されます。\n",
                "stdout",
            )

    def append_log(self, text: str, stream_name: str) -> None:
        with self.lock:
            prefix = ""
            if stream_name == "stderr" and not text.startswith("["):
                prefix = "[STDERR] "
            self.log_text += prefix + text
            if len(self.log_text) > 200000:
                self.log_text = self.log_text[-200000:]
            self.log_revision += 1

    def set_status(self, text: str) -> None:
        with self.lock:
            self.status = text
            self.log_revision += 1

    def get_state(self) -> dict[str, Any]:
        with self.lock:
            pending = len(self.queue_items) + (1 if self.current_job else 0)
            total = self.progress_completed + pending
            return {
                "status": self.status,
                "running": self.worker is not None and self.worker.is_alive(),
                "log_text": self.log_text,
                "log_revision": self.log_revision,
                "selected_input_path": self.selected_input_path,
                "queue_items": [dict(item) for item in self.queue_items],
                "current_job": dict(self.current_job) if self.current_job else None,
                "progress": {
                    "action": self.progress_action,
                    "completed": self.progress_completed,
                    "total": total,
                    "failures": self.progress_failures,
                },
            }

    def touch_browser_session(self, session_id: str) -> None:
        normalized = session_id.strip()
        if not normalized:
            return
        now = time.monotonic()
        with self.lock:
            self.browser_sessions[normalized] = now
            self.auto_shutdown_armed = True
            self.no_session_since = None

    def close_browser_session(self, session_id: str) -> None:
        normalized = session_id.strip()
        if not normalized:
            return
        now = time.monotonic()
        with self.lock:
            self.browser_sessions.pop(normalized, None)
            if self.auto_shutdown_armed and not self.browser_sessions:
                self.no_session_since = now

    def prune_stale_browser_sessions(self) -> None:
        now = time.monotonic()
        with self.lock:
            stale_ids = [
                session_id
                for session_id, last_seen in self.browser_sessions.items()
                if now - last_seen >= SESSION_STALE_SECONDS
            ]
            for session_id in stale_ids:
                self.browser_sessions.pop(session_id, None)
            if self.auto_shutdown_armed and not self.browser_sessions:
                if self.no_session_since is None:
                    self.no_session_since = now
            else:
                self.no_session_since = None

    def monitor_browser_sessions(self) -> None:
        while True:
            time.sleep(1.0)
            self.prune_stale_browser_sessions()
            should_shutdown = False
            with self.lock:
                server_active = self.server is not None
                if (
                    server_active
                    and self.auto_shutdown_armed
                    and not self.shutdown_requested
                    and self.no_session_since is not None
                    and (time.monotonic() - self.no_session_since) >= SESSION_CLOSE_GRACE_SECONDS
                ):
                    self.shutdown_requested = True
                    self.status = "タブが閉じられたため GUI を終了します"
                    self.log_revision += 1
                    should_shutdown = True
            if not server_active:
                return
            if should_shutdown:
                self.append_log("[INFO] ブラウザのタブが閉じられたため、ローカル GUI を終了します。\n", "stdout")
                self.shutdown_server()
                return

    def reset_progress(self, action_name: str) -> None:
        with self.lock:
            self.progress_action = action_name
            self.progress_completed = 0
            self.progress_failures = 0
            self.log_revision += 1

    def update_progress(self, completed: int, failures: int) -> None:
        with self.lock:
            self.progress_completed = max(completed, 0)
            self.progress_failures = max(failures, 0)
            self.log_revision += 1

    def set_current_job_item(self, item: dict[str, str] | None) -> None:
        with self.lock:
            self.current_job = dict(item) if item else None
            self.log_revision += 1

    def set_selected_input_path(self, path: str) -> None:
        with self.lock:
            self.selected_input_path = path.strip()
            self.log_revision += 1

    def add_queue_path(self, path: str, source: str) -> dict[str, str]:
        normalized = path.strip()
        if not normalized:
            raise RuntimeError("空の入力はキューへ追加できません。")
        with self.lock:
            self.queue_serial += 1
            item = {
                "id": str(self.queue_serial),
                "path": normalized,
                "label": Path(normalized).name or normalized,
                "source": source,
            }
            self.queue_items.append(item)
            self.log_revision += 1
        self.set_status("入力をキューに追加しました")
        self.append_log(f"[INFO] キュー追加: {normalized}\n", "stdout")
        return dict(item)

    def add_queue_paths(self, paths: list[str], source: str) -> list[dict[str, str]]:
        added: list[dict[str, str]] = []
        for path in paths:
            added.append(self.add_queue_path(path, source))
        return added

    def remove_queue_item(self, item_id: str) -> bool:
        removed = False
        with self.lock:
            new_items = [item for item in self.queue_items if item["id"] != item_id]
            removed = len(new_items) != len(self.queue_items)
            if removed:
                self.queue_items = new_items
                self.log_revision += 1
        if removed:
            self.set_status("キューから削除しました")
        return removed

    def clear_queue(self) -> None:
        with self.lock:
            self.queue_items = []
            self.log_revision += 1
        self.set_status("キューを空にしました")

    def pop_next_queue_item(self) -> dict[str, str] | None:
        with self.lock:
            if not self.queue_items:
                return None
            item = dict(self.queue_items.pop(0))
            self.current_job = dict(item)
            self.log_revision += 1
            return item

    def clear_current_job(self) -> None:
        self.set_current_job_item(None)

    @staticmethod
    def build_runtime_job_item(action_name: str, argv: list[str]) -> dict[str, str]:
        for token in reversed(argv):
            if isinstance(token, str) and token and not token.startswith("-"):
                return {
                    "id": "single",
                    "path": token,
                    "label": Path(token).name or token,
                    "source": "runtime",
                }
        return {
            "id": "single",
            "path": "",
            "label": action_name,
            "source": "runtime",
        }

    def get_effective_input_path(self, config: dict[str, Any], payload: dict[str, Any] | None = None) -> str:
        if payload is not None:
            ui = payload.get("ui", {})
            if isinstance(ui, dict):
                ui_path = str(ui.get("selected_input_path", "") or "").strip()
                if ui_path:
                    return ui_path
        if self.selected_input_path:
            return self.selected_input_path
        return str(config.get("general", {}).get("input_path", "")).strip()

    def load_or_default_config(self) -> dict[str, Any]:
        if self.config_path.exists():
            try:
                return self.core.merge_config_with_defaults(self.core.load_toml(self.config_path))
            except Exception as e:
                self.append_log(f"[WARN] babel_breaker_app/config.toml の読込に失敗したため、既定値で開きます: {e}\n", "stderr")
        return self.core.merge_config_with_defaults({})

    def collect_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        defaults = self.core.merge_config_with_defaults({})
        config = self.core.merge_config_with_defaults({})
        form = payload.get("config", {})
        if not isinstance(form, dict):
            form = {}

        for section, fields in FIELD_SPECS.items():
            section_data = config.setdefault(section, {})
            default_section = defaults.get(section, {})
            for key, _, field_type in fields:
                raw = form.get(f"{section}.{key}")
                if field_type == "bool":
                    section_data[key] = bool(raw)
                elif field_type == "int":
                    text = str(raw or "").strip()
                    section_data[key] = int(text) if text else int(default_section.get(key, 0))
                elif field_type == "float":
                    text = str(raw or "").strip()
                    section_data[key] = float(text) if text else float(default_section.get(key, 0.0))
                elif field_type == "list":
                    section_data[key] = self.core.normalize_locale_priority([str(raw or "")])
                else:
                    section_data[key] = str(raw or "")

        return config

    def apply_config(self, config: dict[str, Any]) -> None:
        self.config_data = self.core.merge_config_with_defaults(config)

    def save_config_file(self, config: dict[str, Any]) -> dict[str, Any]:
        self.config_path.write_text(
            self.core.dump_config_template_with_values(config),
            encoding="utf-8",
            newline="\n",
        )
        self.apply_config(config)
        self.set_status("設定を保存しました")
        self.append_log(f"[INFO] 設定を保存しました: {self.config_path}\n", "stdout")
        return self.config_data

    def reset_defaults(self) -> dict[str, Any]:
        config = self.core.merge_config_with_defaults({})
        self.apply_config(config)
        self.set_selected_input_path(str(config.get("general", {}).get("input_path", "")).strip())
        self.extract_state["extract_locale"] = ", ".join(config.get("translation", {}).get("source_locale_priority", ["en_us", "en_gb"]))
        self.set_status("初期値を読み込みました")
        self.append_log("[INFO] 初期値を読み込みました。\n", "stdout")
        return self.config_data

    def reload_config(self) -> dict[str, Any]:
        self.config_data = self.load_or_default_config()
        self.set_selected_input_path(str(self.config_data.get("general", {}).get("input_path", "")).strip())
        self.extract_state["extract_locale"] = ", ".join(self.config_data.get("translation", {}).get("source_locale_priority", ["en_us", "en_gb"]))
        self.set_status("設定を再読込しました")
        self.append_log("[INFO] 設定を再読込しました。\n", "stdout")
        return self.config_data

    def update_extract_state(self, payload: dict[str, Any]) -> None:
        extract = payload.get("extract", {})
        if not isinstance(extract, dict):
            extract = {}
        for key, _, field_type in EXTRACT_FIELD_SPECS:
            raw = extract.get(key)
            if field_type == "bool":
                self.extract_state[key] = bool(raw)
            else:
                self.extract_state[key] = str(raw or "")

    def get_translation_mode(self, config: dict[str, Any]) -> str:
        return str(config.get("translation", {}).get("mode", "clipboard") or "clipboard").strip().lower()

    def build_runtime_argv(self, config: dict[str, Any], extra: list[str], payload: dict[str, Any] | None = None) -> list[str]:
        argv = list(extra)
        input_path = self.get_effective_input_path(config, payload)
        if input_path:
            argv.append(input_path)
        return argv

    def build_extract_argv(self, config: dict[str, Any], payload: dict[str, Any] | None = None) -> list[str]:
        output_path = self.extract_state["extract_output"].strip()
        mode = self.get_translation_mode(config)
        if self.extract_state["extract_no_clipboard"] and not output_path and mode != "file":
            raise RuntimeError("ファイルだけ保存する場合は保存先ファイルを指定してください。")

        argv = ["-x"]
        if output_path:
            argv.extend(["-o", output_path])
        if self.extract_state["extract_no_clipboard"]:
            argv.append("-c")

        locale_text = self.extract_state["extract_locale"].strip()
        if locale_text:
            for locale in self.core.normalize_locale_priority([locale_text]):
                argv.extend(["-l", locale])

        namespace = self.extract_state["extract_namespace"].strip()
        if namespace:
            argv.extend(["-n", namespace])

        return self.build_runtime_argv(config, argv, payload)

    def build_runtime_argv_for_input(self, input_path: str) -> list[str]:
        return [input_path] if input_path else []

    def derive_batch_extract_output(self, output_path: str, input_path: str, index: int) -> str:
        template = Path(output_path)
        safe_stem = self.core.safe_fs_name(Path(input_path).stem or f"input_{index}")
        if template.exists() and template.is_dir():
            return str(template / f"{safe_stem}.json")

        suffix = template.suffix or ".json"
        stem = template.stem if template.suffix else (template.name or "source_lang")
        return str(template.with_name(f"{stem}_{safe_stem}{suffix}"))

    def build_extract_argv_for_input(self, input_path: str, multiple: bool, index: int) -> list[str]:
        output_path = self.extract_state["extract_output"].strip()
        mode = self.get_translation_mode(self.config_data)
        if self.extract_state["extract_no_clipboard"] and not output_path and mode != "file":
            raise RuntimeError("ファイルだけ保存する場合は保存先ファイルを指定してください。")

        argv = ["-x"]
        if output_path:
            resolved_output = self.derive_batch_extract_output(output_path, input_path, index) if multiple else output_path
            argv.extend(["-o", resolved_output])
        if self.extract_state["extract_no_clipboard"]:
            argv.append("-c")

        locale_text = self.extract_state["extract_locale"].strip()
        if locale_text:
            for locale in self.core.normalize_locale_priority([locale_text]):
                argv.extend(["-l", locale])

        namespace = self.extract_state["extract_namespace"].strip()
        if namespace:
            argv.extend(["-n", namespace])

        argv.append(input_path)
        return argv

    def run_action_in_background(
        self,
        action_name: str,
        argv_builder: Any,
        single_argv: list[str] | None = None,
        allow_queue: bool = True,
    ) -> None:
        with self.lock:
            if self.worker is not None and self.worker.is_alive():
                raise RuntimeError("別の処理が実行中です。完了するまで待ってください。")
            self.status = f"{action_name} を実行中..."
            self.log_text += f"\n===== {action_name} =====\n"
            self.log_revision += 1
        self.reset_progress(action_name)

        def worker() -> None:
            stdout_writer = MemoryWriter(self, "stdout")
            stderr_writer = MemoryWriter(self, "stderr")
            processed = 0
            failures = 0
            try:
                with contextlib.redirect_stdout(stdout_writer), contextlib.redirect_stderr(stderr_writer):
                    if allow_queue and self.queue_items:
                        print(f"[INFO] キュー処理を開始します。件数: {len(self.queue_items)}")
                        while True:
                            item = self.pop_next_queue_item()
                            if item is None:
                                break
                            processed += 1
                            print(f"\n[QUEUE] {processed}件目: {item['label']}")
                            argv = argv_builder(item["path"], True, processed)
                            print(f"[INFO] 実行引数: {' '.join(argv)}")
                            code = self.core.main(argv)
                            if code != 0:
                                failures += 1
                            self.update_progress(processed, failures)
                            self.clear_current_job()
                    else:
                        if not allow_queue and self.queue_items:
                            print("[INFO] clipboard モードではキューを使わないため、現在の入力だけ処理します。")
                        argv = single_argv or []
                        self.set_current_job_item(self.build_runtime_job_item(action_name, argv))
                        print(f"[INFO] 実行引数: {' '.join(argv) if argv else '(babel_breaker_app/config.toml の設定のみ)'}")
                        code = self.core.main(argv)
                        processed = 1
                        if code != 0:
                            failures += 1
                        self.update_progress(processed, failures)
                        self.clear_current_job()
            except Exception as e:
                self.append_log(f"[ERROR] GUI 実行中に例外が発生しました: {e}\n", "stderr")
                self.update_progress(processed, max(failures, 1 if processed == 0 else failures))
                self.clear_current_job()
                self.set_status(f"{action_name} が失敗しました")
                return

            self.clear_current_job()
            if failures == 0:
                summary = f"{action_name} が完了しました"
            else:
                summary = f"{action_name} が完了しましたが {failures} 件失敗しました"
            if processed > 1:
                summary += f" ({processed}件)"
            self.set_status(summary)

        self.worker = threading.Thread(target=worker, daemon=True)
        self.worker.start()

    def render_html(self) -> str:
        config_json = json.dumps(self.config_data, ensure_ascii=False).replace("</", "<\\/")
        extract_json = json.dumps(self.extract_state, ensure_ascii=False).replace("</", "<\\/")
        field_meta = []
        for section, fields in FIELD_SPECS.items():
            for key, label, field_type in fields:
                field_meta.append({
                    "section": section,
                    "key": key,
                    "label": label,
                    "type": field_type,
                })
        field_meta_json = json.dumps(field_meta, ensure_ascii=False).replace("</", "<\\/")
        selected_input_json = json.dumps(self.selected_input_path, ensure_ascii=False).replace("</", "<\\/")
        queue_json = json.dumps(self.queue_items, ensure_ascii=False).replace("</", "<\\/")
        current_job_json = json.dumps(self.current_job, ensure_ascii=False).replace("</", "<\\/")
        html_page = f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Babel Breaker GUI</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    :root {{
      --bg: #f3efe8;
      --panel: rgba(255, 255, 255, 0.92);
      --ink: #1c2430;
      --muted: #5f6975;
      --accent: #165f4b;
      --accent-soft: #edf6f2;
      --accent-2: #c98b33;
      --warm-soft: #fff5e7;
      --border: #d8d2c7;
      --danger: #b34747;
      --shadow: 0 16px 36px rgba(28, 36, 48, 0.08);
      --radius: 18px;
      --mono: "SFMono-Regular", "Consolas", monospace;
      --sans: "Hiragino Sans", "Yu Gothic UI", "Segoe UI", sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: var(--sans);
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(201, 139, 51, 0.12), transparent 28%),
        linear-gradient(180deg, #ece7dd 0%, var(--bg) 20%, #f7f4ee 100%);
    }}
    .shell {{
      max-width: 940px;
      margin: 0 auto;
      padding: 24px 18px 48px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }}
    .hero {{
      padding: 24px;
    }}
    h1 {{
      margin: 0 0 6px;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.05;
      letter-spacing: -0.03em;
    }}
    .lead {{
      margin: 0;
      font-size: 1rem;
      color: var(--muted);
      line-height: 1.7;
    }}
    .topbar {{
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
    }}
    .header-copy {{
      max-width: 700px;
    }}
    .subtle-note {{
      margin: 10px 0 0;
      color: var(--accent);
      font-size: 0.92rem;
      line-height: 1.6;
    }}
    .status-block {{
      display: grid;
      gap: 6px;
      justify-items: end;
      min-width: 140px;
    }}
    .status-label {{
      font-size: 0.76rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }}
    .tool-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    button {{
      border: none;
      border-radius: 999px;
      padding: 11px 15px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      background: var(--ink);
      color: #fff;
      transition: transform 120ms ease, opacity 120ms ease, background 120ms ease, border-color 120ms ease;
    }}
    button:hover:not(:disabled) {{
      transform: translateY(-1px);
    }}
    button.secondary {{
      background: #fff;
      color: var(--ink);
      border: 1px solid var(--border);
    }}
    button.accent {{
      background: var(--accent);
    }}
    button.warn {{
      background: var(--accent-2);
      color: #34230d;
    }}
    button.ghost {{
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
    }}
    button:disabled {{
      opacity: 0.55;
      cursor: not-allowed;
    }}
    .stack {{
      display: grid;
      gap: 18px;
    }}
    .card {{
      padding: 20px;
    }}
    .card-head {{
      display: grid;
      gap: 6px;
      margin-bottom: 14px;
    }}
    .eyebrow {{
      font-size: 0.76rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 800;
    }}
    .section-title {{
      margin: 0;
      font-size: 1.18rem;
    }}
    .desc {{
      margin: 0;
      color: var(--muted);
      line-height: 1.7;
    }}
    .section-grid {{
      display: grid;
      gap: 14px;
    }}
    .dropzone {{
      border: 2px dashed rgba(22, 95, 75, 0.24);
      border-radius: 20px;
      padding: 28px 22px;
      background: linear-gradient(180deg, rgba(22, 95, 75, 0.05), rgba(255, 255, 255, 0.84));
      text-align: center;
      transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
    }}
    .dropzone.dragover {{
      border-color: var(--accent);
      transform: translateY(-1px);
      background: linear-gradient(180deg, rgba(22, 95, 75, 0.1), rgba(255, 255, 255, 0.9));
    }}
    .drop-title {{
      font-size: clamp(1.15rem, 2vw, 1.45rem);
      font-weight: 800;
      letter-spacing: -0.02em;
    }}
    .drop-sub {{
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.7;
    }}
    .drop-actions {{
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 10px;
      margin-top: 18px;
    }}
    .step-stack {{
      display: grid;
      gap: 14px;
    }}
    .selected {{
      padding: 16px 18px;
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(22, 95, 75, 0.06), rgba(255, 255, 255, 0.9));
      border: 1px solid rgba(22, 95, 75, 0.12);
    }}
    .selected-label {{
      font-size: 0.85rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .selected-path {{
      margin-top: 7px;
      font-size: 1rem;
      font-weight: 700;
      word-break: break-word;
    }}
    .selected-note {{
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.7;
    }}
    .selected-meta-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }}
    .selected-meta-item {{
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(28, 36, 48, 0.08);
    }}
    .selected-meta-item span {{
      display: block;
      font-size: 0.76rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .selected-meta-item strong {{
      display: block;
      margin-top: 6px;
      font-size: 0.94rem;
    }}
    .input-detail {{
      border-radius: 16px;
      border: 1px solid rgba(28, 36, 48, 0.08);
      background: rgba(255, 255, 255, 0.82);
      overflow: hidden;
    }}
    .summary-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }}
    .summary-item {{
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(28, 36, 48, 0.08);
      background: rgba(255, 255, 255, 0.84);
    }}
    .summary-label {{
      font-size: 0.76rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .summary-value {{
      margin-top: 6px;
      font-weight: 700;
      word-break: break-word;
    }}
    .queue-panel {{
      padding: 0;
    }}
    .queue-panel > summary {{
      list-style: none;
      cursor: pointer;
      padding: 16px 18px;
    }}
    .queue-panel > summary::-webkit-details-marker {{
      display: none;
    }}
    .queue-header {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }}
    .queue-body {{
      display: grid;
      gap: 12px;
      padding: 0 18px 18px;
    }}
    .queue-count {{
      font-size: 0.92rem;
      color: var(--muted);
    }}
    .queue-list {{
      display: grid;
      gap: 10px;
    }}
    .queue-item {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid rgba(28, 36, 48, 0.08);
    }}
    .queue-item.current {{
      border-color: rgba(22, 95, 75, 0.24);
      background: var(--accent-soft);
    }}
    .queue-item-title {{
      font-weight: 800;
      word-break: break-word;
    }}
    .queue-item-meta {{
      margin-top: 4px;
      font-size: 0.86rem;
      color: var(--muted);
      word-break: break-word;
    }}
    .queue-empty {{
      color: var(--muted);
      line-height: 1.7;
      padding: 6px 2px;
    }}
    .mode-card {{
      display: grid;
      gap: 12px;
      background: var(--warm-soft);
    }}
    .mode-help {{
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(201, 139, 51, 0.18);
    }}
    .mode-help-title {{
      font-size: 0.84rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 800;
    }}
    .mode-help-text {{
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.7;
    }}
    .mode-buttons {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }}
    .mode-button {{
      background: rgba(255, 255, 255, 0.84);
      color: var(--ink);
      border: 1px solid rgba(28, 36, 48, 0.1);
    }}
    .mode-button.active {{
      background: var(--ink);
      color: #fff;
      border-color: transparent;
    }}
    .primary-actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }}
    .primary-actions button {{
      min-width: 168px;
    }}
    .run-card {{
      background: linear-gradient(180deg, rgba(22, 95, 75, 0.05), rgba(255, 255, 255, 0.92));
    }}
    .run-note {{
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.6;
    }}
    details.disclosure {{
      overflow: hidden;
    }}
    details.disclosure > summary {{
      list-style: none;
      cursor: pointer;
      padding: 18px 20px;
      font-weight: 800;
      font-size: 1rem;
    }}
    details.disclosure > summary::-webkit-details-marker {{
      display: none;
    }}
    .details-body {{
      padding: 0 20px 20px;
      display: grid;
      gap: 14px;
    }}
    .mini-grid {{
      display: grid;
      gap: 14px;
      align-items: start;
    }}
    .field {{
      display: grid;
      gap: 7px;
    }}
    .field.inline {{
      grid-template-columns: minmax(140px, 220px) 1fr;
      align-items: center;
      gap: 12px;
    }}
    label {{
      font-weight: 700;
      font-size: 0.95rem;
    }}
    .hint {{
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.55;
    }}
    input[type="text"], input[type="password"], textarea, select {{
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #fff;
      color: var(--ink);
      padding: 11px 13px;
      font-size: 0.96rem;
      font-family: inherit;
    }}
    input[type="checkbox"] {{
      accent-color: var(--accent);
    }}
    textarea {{
      min-height: 130px;
      resize: vertical;
    }}
    .checkbox {{
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(28, 36, 48, 0.04);
      border: 1px solid rgba(28, 36, 48, 0.06);
    }}
    .path-row {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }}
    .button-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .log {{
      min-height: 260px;
      max-height: 520px;
      overflow: auto;
      background: #11161f;
      color: #f5f2ea;
      border-radius: 16px;
      padding: 16px;
      font-family: var(--mono);
      font-size: 0.88rem;
      line-height: 1.6;
      white-space: pre-wrap;
      border: 1px solid rgba(17,22,31,0.6);
    }}
    .status-pill {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(22, 95, 75, 0.1);
      color: var(--accent);
      font-weight: 700;
    }}
    .flash {{
      margin-top: 12px;
      min-height: 1.4em;
      color: var(--muted);
    }}
    .flash.error {{
      color: var(--danger);
    }}
    .flash.ok {{
      color: var(--accent);
    }}
    .progress-wrap {{
      margin-top: 14px;
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(22, 95, 75, 0.05);
      border: 1px solid rgba(22, 95, 75, 0.14);
      display: grid;
      gap: 8px;
    }}
    .progress-head {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      flex-wrap: wrap;
    }}
    .progress-label {{
      font-weight: 800;
    }}
    .progress-count {{
      font-size: 0.92rem;
      color: var(--muted);
    }}
    .progress-bar {{
      width: 100%;
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(28, 36, 48, 0.1);
    }}
    .progress-fill {{
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), #2f8f74);
      transition: width 180ms ease;
    }}
    .progress-wrap.done .progress-fill {{
      background: linear-gradient(90deg, var(--accent-2), #e6ae53);
    }}
    .progress-meta {{
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.6;
    }}
    .footer-note {{
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 14px;
      font-size: 0.92rem;
      color: var(--muted);
    }}
    .footer-link {{
      color: inherit;
      text-decoration: none;
      border-bottom: 1px solid rgba(28, 36, 48, 0.18);
      padding-bottom: 1px;
      transition: color 120ms ease, border-color 120ms ease;
    }}
    .footer-link:hover {{
      color: var(--ink);
      border-bottom-color: rgba(28, 36, 48, 0.42);
    }}
    @media (max-width: 760px) {{
      .shell {{
        padding: 16px 14px 32px;
      }}
      .hero {{
        padding: 18px;
      }}
      .card {{
        padding: 16px;
      }}
      .topbar {{
        flex-direction: column;
      }}
      .status-block {{
        justify-items: start;
      }}
      .drop-actions {{
        justify-content: stretch;
      }}
      .path-row {{
        grid-template-columns: 1fr;
      }}
      .field.inline {{
        grid-template-columns: 1fr;
      }}
      .queue-item {{
        grid-template-columns: 1fr;
      }}
      .selected-meta-grid {{
        grid-template-columns: 1fr;
      }}
      .primary-actions button {{
        width: 100%;
      }}
      .tool-row button,
      .drop-actions button {{
        width: 100%;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel hero">
      <div class="topbar">
        <div class="header-copy">
          <h1>Babel Breaker</h1>
          <p class="lead">mod を入れて、翻訳方法を選んで、実行するだけです。</p>
          <p class="subtle-note">最後のタブを閉じると、このローカル GUI も自動で終了します。</p>
        </div>
        <div class="status-block">
          <div class="status-label">状態</div>
          <div class="status-pill" id="status-pill">準備完了</div>
        </div>
      </div>
      <div id="flash" class="flash"></div>
      <div id="progress-wrap" class="progress-wrap" hidden>
        <div class="progress-head">
          <div id="progress-label" class="progress-label">待機中</div>
          <div id="progress-count" class="progress-count">0 / 0</div>
        </div>
        <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
        <div id="progress-meta" class="progress-meta"></div>
      </div>
    </section>

    <main class="stack">
      <section class="panel card">
        <div class="card-head">
          <div class="eyebrow">Step 1</div>
          <h2 class="section-title">mod を入れる</h2>
          <p class="desc">最初に入力する mod を選びます。通常は JAR / ZIP をドロップするだけで十分です。</p>
        </div>
        <div class="step-stack">
          <div id="dropzone" class="dropzone">
            <div id="drop-title" class="drop-title">mod JAR / ZIP をここへドロップ</div>
            <div id="drop-sub" class="drop-sub">またはファイルを選ぶ。解凍済みフォルダを使う時だけフォルダ選択を使ってください。</div>
            <div class="drop-actions">
              <button class="accent" data-nonblocking="1" type="button" onclick="document.getElementById('upload-input').click()">ファイルを選ぶ</button>
              <button class="secondary picker-button" data-nonblocking="1" type="button" onclick="pickInputFolder()">フォルダを選ぶ</button>
            </div>
            <input id="upload-input" type="file" accept=".jar,.zip,application/java-archive,application/zip" multiple hidden>
          </div>
          <div id="current-input-card" class="selected"></div>
          <details id="queue-panel" class="input-detail queue-panel">
            <summary class="queue-header">
              <div>
                <div class="selected-label">入力の詳細</div>
                <div id="queue-count" class="queue-count">待機なし</div>
              </div>
              <span class="hint">開く / 閉じる</span>
            </summary>
            <div class="queue-body">
              <div id="queue-list" class="queue-list"></div>
              <div class="tool-row">
                <button class="ghost" data-nonblocking="1" type="button" onclick="runAction('clear_input')">入力をクリア</button>
                <button class="ghost" data-nonblocking="1" data-queue-only="1" type="button" onclick="runAction('clear_queue')">キューを空にする</button>
              </div>
              <input id="selected_input_path" type="hidden">
            </div>
          </details>
        </div>
      </section>

      <section class="panel card mode-card">
        <div class="card-head">
          <div class="eyebrow">Step 2</div>
          <h2 class="section-title">翻訳方法を選ぶ</h2>
          <p class="desc">次に、翻訳済み JSON を使うか、AI でそのまま翻訳するかを選びます。</p>
        </div>
        <div class="mode-buttons">
          <button id="mode-clipboard" class="mode-button" type="button" onclick="setMode('clipboard')">clipboard</button>
          <button id="mode-file" class="mode-button" type="button" onclick="setMode('file')">file</button>
          <button id="mode-ai" class="mode-button" type="button" onclick="setMode('ai')">AI</button>
        </div>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">モード</div>
            <div class="summary-value" id="quick-mode"></div>
          </div>
          <div class="summary-item">
            <div class="summary-label">locale</div>
            <div class="summary-value" id="quick-target-locale"></div>
          </div>
          <div class="summary-item">
            <div class="summary-label">出力先</div>
            <div class="summary-value" id="quick-output-dir"></div>
          </div>
        </div>
        <div id="mode-help" class="mode-help"></div>
      </section>

      {self.render_file_mode_inputs()}

      <details class="panel disclosure">
        <summary>必要な場合だけ詳細設定</summary>
        <div class="details-body">
          <div class="mini-grid">
            {self.render_section("general")}
            {self.render_section("translation")}
            {self.render_extract_options()}
            {self.render_section("api")}
            {self.render_section("pack")}
            {self.render_section("clipboard")}
            {self.render_section("minecraft")}
            {self.render_section("input_scan")}
          </div>
        </div>
      </details>

      <section class="panel card run-card">
        <div class="card-head">
          <div class="eyebrow">Step 3</div>
          <h2 class="section-title">実行する</h2>
          <p class="desc">最後に実行します。通常は「リソースパック生成」を押せば完了です。</p>
        </div>
        <div class="primary-actions">
          <button class="accent" type="button" onclick="runAction('generate')">リソースパック生成</button>
          <button class="warn" type="button" onclick="runAction('extract')">元 lang を取得</button>
        </div>
        <div class="run-note">実行すると、画面にある設定内容を保存してから処理します。元 JSON だけ欲しい時だけ「元 lang を取得」を使ってください。</div>
      </section>

      <details class="panel disclosure">
        <summary>補助操作</summary>
        <div class="details-body">
          <p class="desc">保存、再読込、出力先を開く、GUI を閉じるなどの補助操作です。普段は触らなくて大丈夫です。</p>
          <div class="tool-row">
            <button class="secondary" type="button" onclick="runAction('save')">設定を保存</button>
            <button class="ghost" type="button" onclick="runAction('reload')">再読込</button>
            <button class="ghost" type="button" onclick="runAction('reset')">初期値</button>
            <button class="secondary" type="button" onclick="openTarget('output_dir')">出力先を開く</button>
            <button class="secondary" type="button" onclick="openTarget('config_dir')">設定フォルダを開く</button>
            <button class="ghost" type="button" onclick="openTarget('readme')">README</button>
            <button class="ghost" type="button" onclick="runAction('shutdown')">GUI を終了</button>
          </div>
        </div>
      </details>

      <details class="panel disclosure">
        <summary>ログを見る</summary>
        <div class="details-body">
          <div id="log" class="log"></div>
          <div class="tool-row">
            <button class="secondary" type="button" onclick="runAction('clear_log')">ログを消す</button>
            <button class="secondary" type="button" onclick="copyLog()">ログをコピー</button>
          </div>
        </div>
      </details>
    </main>
    <div class="footer-note">
      <a class="footer-link" href="{html.escape(X_URL)}" target="_blank" rel="noopener noreferrer">© IGNORANZ PROJECT</a>
      <a class="footer-link" href="{html.escape(GITHUB_URL)}" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
  </div>

  <script>
    const initialConfig = {config_json};
    const initialExtract = {extract_json};
    const fieldMeta = {field_meta_json};
    const sessionId = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `session-${{Date.now()}}-${{Math.random().toString(16).slice(2)}}`;
    const modeHelpMap = {{
      clipboard: {{
        title: 'clipboard モード',
        text: '翻訳済み JSON を手早く 1 件ずつ戻したい時向けです。入力 mod は 1 件ずつ処理します。'
      }},
      file: {{
        title: 'file モード',
        text: '翻訳済みファイルや貼り付けテキストを使って、複数 mod をまとめて処理したい時向けです。'
      }},
      ai: {{
        title: 'AI モード',
        text: '元 lang の抽出から翻訳、リソースパック生成までまとめて進めたい時向けです。'
      }},
    }};
    let selectedInputPath = {selected_input_json};
    let queueItems = {queue_json};
    let currentJob = {current_job_json};
    let lastLogRevision = -1;
    let closeNotified = false;

    function fieldId(section, key) {{
      return `${{section}}__${{key}}`;
    }}

    function currentMode() {{
      return document.getElementById(fieldId('translation', 'mode')).value || 'clipboard';
    }}

    function formatModeLabel(mode) {{
      return mode === 'ai' ? 'AI' : mode;
    }}

    function setFlash(message, kind='') {{
      const el = document.getElementById('flash');
      el.textContent = message || '';
      el.className = `flash ${{kind}}`.trim();
    }}

    function normalizeNotice(text) {{
      return String(text || '').trim().replace(/[。.!！?？\\s]+$/u, '');
    }}

    function showResultFlash(result, state) {{
      const message = result && result.message ? String(result.message) : '';
      if (!message) {{
        setFlash('');
        return;
      }}
      const sameAsStatus = Boolean(
        result &&
        result.ok &&
        state &&
        normalizeNotice(message) &&
        normalizeNotice(message) === normalizeNotice(state.status || '')
      );
      if (sameAsStatus) {{
        setFlash('');
        return;
      }}
      setFlash(message, result && result.ok ? 'ok' : 'error');
    }}

    function renderProgress(state) {{
      const wrap = document.getElementById('progress-wrap');
      const label = document.getElementById('progress-label');
      const count = document.getElementById('progress-count');
      const fill = document.getElementById('progress-fill');
      const meta = document.getElementById('progress-meta');
      if (!wrap || !label || !count || !fill || !meta) return;
      const progress = (state && state.progress) || {{}};
      const total = Number(progress.total || 0);
      const completed = Number(progress.completed || 0);
      const failures = Number(progress.failures || 0);
      const running = Boolean(state && state.running);
      const action = String(progress.action || '');
      const currentLabel = state && state.current_job ? String(state.current_job.label || state.current_job.path || '') : '';
      if (!action || total <= 0) {{
        wrap.hidden = true;
        fill.style.width = '0%';
        return;
      }}
      const percent = Math.max(0, Math.min(100, total ? (completed / total) * 100 : 0));
      wrap.hidden = false;
      wrap.classList.toggle('done', !running && completed >= total);
      label.textContent = running ? `${{action}} を実行中` : `${{action}} 完了`;
      count.textContent = `${{completed}} / ${{total}}`;
      fill.style.width = `${{percent}}%`;
      if (running && currentLabel) {{
        meta.textContent = failures > 0 ? `現在: ${{currentLabel}} / 失敗 ${{failures}} 件` : `現在: ${{currentLabel}}`;
      }} else if (failures > 0) {{
        meta.textContent = `失敗 ${{failures}} 件`;
      }} else if (running) {{
        meta.textContent = '処理中です。ログも確認できます。';
      }} else {{
        meta.textContent = '完了しました。';
      }}
    }}

    function renderCurrentInput(fallbackPath='') {{
      const card = document.getElementById('current-input-card');
      if (!card) return;
      const fallback = String(fallbackPath || '');
      const queuedPath = queueItems.length ? String((queueItems[0] && queueItems[0].path) || '') : '';
      const modeLabel = formatModeLabel(currentMode());
      const queueLabel = currentJob
        ? (queueItems.length ? `実行中 + ${{queueItems.length}} 件待機` : '実行中')
        : (queueItems.length ? `${{queueItems.length}} 件` : 'なし');
      const activePath = currentJob
        ? String(currentJob.path || currentJob.label || '')
        : (queueItems.length ? queuedPath : (selectedInputPath || fallback || queuedPath));
      const metaHtml = `<div class="selected-meta-grid">
        <div class="selected-meta-item">
          <span>モード<\/span>
          <strong>${{escapeHtml(modeLabel)}}<\/strong>
        <\/div>
        <div class="selected-meta-item">
          <span>キュー<\/span>
          <strong>${{escapeHtml(queueLabel)}}<\/strong>
        <\/div>
      <\/div>`;
      if (queueItems.length) {{
        card.innerHTML = `<div class="selected-label">現在の状態<\/div>
          <div class="selected-path">${{escapeHtml(activePath || 'キュー処理')}}<\/div>
          <div class="selected-note">次に処理される入力です。AI / file モードではこの下の詳細どおりに上から順に処理します。<\/div>
          ${{metaHtml}}`;
        return;
      }}
      if (activePath) {{
        const note = selectedInputPath
          ? '今この画面で選んだ入力を使います。'
          : '設定ファイルに保存された入力を使います。';
        card.innerHTML = `<div class="selected-label">現在の入力<\/div>
          <div class="selected-path">${{escapeHtml(activePath)}}<\/div>
          <div class="selected-note">${{note}}<\/div>
          ${{metaHtml}}`;
        return;
      }}
      card.innerHTML = `<div class="selected-label">現在の入力<\/div>
        <div class="selected-path">まだ選択されていません<\/div>
        <div class="selected-note">JAR / ZIP をドロップするか、ファイルまたはフォルダを選んでください。<\/div>
        ${{metaHtml}}`;
    }}

    function updateQuickSummary() {{
      const mode = currentMode();
      const locale = document.getElementById(fieldId('translation', 'target_locale')).value || 'ja_jp';
      const outputDir = document.getElementById(fieldId('general', 'output_dir')).value || '_babel_breaker_output';
      const fallbackPath = document.getElementById(fieldId('general', 'input_path')).value || '';
      const effectivePath = (queueItems.length > 0 ? '' : (selectedInputPath || fallbackPath));

      document.getElementById('quick-mode').textContent = formatModeLabel(mode);
      document.getElementById('quick-target-locale').textContent = locale;
      document.getElementById('quick-output-dir').textContent = outputDir;
      document.getElementById('selected_input_path').value = selectedInputPath || '';
      const modeHelp = modeHelpMap[mode] || modeHelpMap.clipboard;
      const modeHelpEl = document.getElementById('mode-help');
      if (modeHelpEl) {{
        modeHelpEl.innerHTML = `<div class="mode-help-title">${{escapeHtml(modeHelp.title)}}<\/div>
          <div class="mode-help-text">${{escapeHtml(modeHelp.text)}}<\/div>`;
      }}
      renderCurrentInput(fallbackPath);
      renderQueue(effectivePath);

      document.getElementById('mode-clipboard').classList.toggle('active', mode === 'clipboard');
      document.getElementById('mode-file').classList.toggle('active', mode === 'file');
      document.getElementById('mode-ai').classList.toggle('active', mode === 'ai');
      updateModeVisibility(mode);
    }}

    function updateModeVisibility(mode) {{
      if (mode === 'clipboard' && !selectedInputPath && queueItems.length) {{
        selectedInputPath = queueItems[0].path || '';
      }}
      const fileModeCard = document.getElementById('file-mode-card');
      const uploadInput = document.getElementById('upload-input');
      const dropTitle = document.getElementById('drop-title');
      const dropSub = document.getElementById('drop-sub');
      const extractNoClipboard = document.getElementById('extract_no_clipboard');
      if (fileModeCard) fileModeCard.hidden = (mode !== 'file');
      if (uploadInput) uploadInput.multiple = mode !== 'clipboard';
      document.querySelectorAll('[data-queue-only="1"]').forEach((el) => {{
        el.hidden = (mode === 'clipboard');
      }});
      if (dropTitle) {{
        dropTitle.textContent = mode === 'clipboard'
          ? 'mod JAR / ZIP を 1 件選ぶ'
          : 'mod JAR / ZIP をここへドロップ';
      }}
      if (dropSub) {{
        dropSub.textContent = mode === 'clipboard'
          ? 'clipboard モードでは 1 件ずつ処理します。フォルダも 1 件ずつ選んでください。'
          : 'またはファイル選択。フォルダ入力は別ボタンで選べます。';
      }}
      if (extractNoClipboard) {{
        if (mode === 'file') {{
          if (!extractNoClipboard.disabled) {{
            extractNoClipboard.dataset.restoreChecked = extractNoClipboard.checked ? '1' : '0';
          }}
          extractNoClipboard.checked = true;
          extractNoClipboard.disabled = true;
        }} else {{
          if (extractNoClipboard.disabled && 'restoreChecked' in extractNoClipboard.dataset) {{
            extractNoClipboard.checked = extractNoClipboard.dataset.restoreChecked === '1';
          }}
          extractNoClipboard.disabled = false;
        }}
      }}
    }}

    function renderQueue(fallbackPath='') {{
      const queueList = document.getElementById('queue-list');
      const queueCount = document.getElementById('queue-count');
      const mode = currentMode();
      if (currentJob) {{
        queueCount.textContent = queueItems.length
          ? `実行中 / 残り ${{queueItems.length}} 件`
          : '実行中';
      }} else if (queueItems.length) {{
        queueCount.textContent = `${{queueItems.length}} 件待機中`;
      }} else {{
        queueCount.textContent = mode === 'clipboard' ? '1 件ずつ処理' : '待機なし';
      }}
      const currentHtml = currentJob ? `<div class="queue-item current">
        <div>
          <div class="queue-item-title">実行中: ${{escapeHtml(currentJob.label || currentJob.path)}}<\/div>
          <div class="queue-item-meta">${{escapeHtml(currentJob.path || '')}}<\/div>
        <\/div>
        <span class="status-pill">処理中<\/span>
      <\/div>` : '';
      if (!queueItems.length) {{
        const fallback = fallbackPath
          ? `${{currentHtml}}<div class="queue-empty">現在の入力:<br>${{escapeHtml(fallbackPath)}}</div>`
          : `${{currentHtml}}<div class="queue-empty">${{mode === 'clipboard' ? 'clipboard モードでは 1 件ずつ処理します。' : 'JAR / ZIP を追加すると、ここに処理順で並びます。'}}</div>`;
        queueList.innerHTML = fallback;
        return;
      }}
      queueList.innerHTML = currentHtml + queueItems.map((item) => {{
        return `<div class="queue-item">
          <div>
            <div class="queue-item-title">${{escapeHtml(item.label || item.path)}}</div>
            <div class="queue-item-meta">${{escapeHtml(item.path)}}<\/div>
          <\/div>
          <button class="ghost" data-nonblocking="1" type="button" onclick="removeQueueItem('${{item.id}}')">削除<\/button>
        <\/div>`;
      }}).join('');
    }}

    function escapeHtml(text) {{
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }}

    function applyConfig(config) {{
      for (const field of fieldMeta) {{
        const value = (((config || {{}})[field.section] || {{}})[field.key]);
        const el = document.getElementById(fieldId(field.section, field.key));
        if (!el) continue;
        if (field.type === 'bool') {{
          el.checked = Boolean(value);
        }} else if (field.type === 'list') {{
          el.value = Array.isArray(value) ? value.join(', ') : '';
        }} else {{
          el.value = value == null ? '' : String(value);
        }}
      }}
      updateQuickSummary();
    }}

    function applyExtract(extract) {{
      document.getElementById('extract_output').value = extract.extract_output || '';
      document.getElementById('extract_locale').value = extract.extract_locale || '';
      document.getElementById('extract_namespace').value = extract.extract_namespace || '';
      document.getElementById('extract_no_clipboard').checked = Boolean(extract.extract_no_clipboard);
    }}

    function applyUi(ui) {{
      if (!ui) return;
      selectedInputPath = ui.selected_input_path || '';
      updateQuickSummary();
    }}

    function setMode(mode) {{
      document.getElementById(fieldId('translation', 'mode')).value = mode;
      updateQuickSummary();
    }}

    function appendUniqueMultilineValue(element, text) {{
      const existing = String(element.value || '').split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
      const incoming = String(text || '').split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
      for (const item of incoming) {{
        if (!existing.includes(item)) existing.push(item);
      }}
      element.value = existing.join('\\n');
    }}

    function collectPayload() {{
      const config = {{}};
      for (const field of fieldMeta) {{
        const el = document.getElementById(fieldId(field.section, field.key));
        if (!el) continue;
        config[`${{field.section}}.${{field.key}}`] = field.type === 'bool' ? el.checked : el.value;
      }}
      return {{
        config,
        extract: {{
          extract_output: document.getElementById('extract_output').value,
          extract_locale: document.getElementById('extract_locale').value,
          extract_namespace: document.getElementById('extract_namespace').value,
          extract_no_clipboard: document.getElementById('extract_no_clipboard').checked,
        }},
        ui: {{
          selected_input_path: selectedInputPath || '',
        }},
      }};
    }}

    async function postJson(path, payload) {{
      const response = await fetch(path, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(payload || {{}}),
      }});
      return response.json();
    }}

    async function runAction(action) {{
      setFlash('処理を送信しています...');
      const result = await postJson('/api/action', {{ action, ...collectPayload() }});
      if (result.config) applyConfig(result.config);
      if (result.extract) applyExtract(result.extract);
      if (result.ui) applyUi(result.ui);
      let state = null;
      try {{
        state = await refreshState();
      }} catch (error) {{
        state = null;
      }}
      showResultFlash(result, state);
      if (action === 'shutdown' && result.ok) {{
        window.setTimeout(() => window.close(), 400);
      }}
    }}

    async function removeQueueItem(itemId) {{
      const result = await postJson('/api/action', {{ action: 'remove_queue_item', item_id: itemId, ...collectPayload() }});
      if (result.ui) applyUi(result.ui);
      const state = await refreshState();
      showResultFlash(result, state);
    }}

    async function pickPath(kind, targetField='') {{
      const result = await postJson('/api/pick', {{ kind }});
      if (!result.ok) {{
        setFlash(result.message || '選択に失敗しました。', 'error');
        return;
      }}
      const fieldIdValue = targetField || result.target_field;
      const el = document.getElementById(fieldIdValue);
      if (el) {{
        if (fieldIdValue === fieldId('file_mode', 'translation_files_text')) {{
          appendUniqueMultilineValue(el, result.path || '');
        }} else {{
          el.value = result.path || '';
        }}
      }}
      if (kind === 'input_file' || kind === 'input_dir' || fieldIdValue === 'selected_input_path') {{
        selectedInputPath = result.path || '';
        updateQuickSummary();
      }}
      await refreshState();
      setFlash(result.message || '選択しました。', 'ok');
    }}

    async function pickInputFolder() {{
      const mode = currentMode();
      await pickPath(mode === 'clipboard' ? 'input_dir' : 'queue_input_dir');
    }}

    async function uploadInputFiles(files) {{
      if (!files || !files.length) return;
      const mode = currentMode();
      if (mode === 'clipboard' && files.length > 1) {{
        setFlash('clipboard モードでは入力 mod は 1 件ずつ指定してください。', 'error');
        return;
      }}
      const formData = new FormData();
      formData.append('queue_enabled', mode === 'clipboard' ? '0' : '1');
      for (const file of files) {{
        formData.append('input_file', file);
      }}
      const response = await fetch('/api/upload-input', {{
        method: 'POST',
        body: formData,
      }});
      const result = await response.json();
      if (result.ok) {{
        const state = await refreshState();
        showResultFlash(result, state);
      }} else {{
        setFlash(result.message || 'ファイルの取込に失敗しました。', 'error');
      }}
    }}

    async function openTarget(target) {{
      const result = await postJson('/api/open', {{ target, ...collectPayload() }});
      setFlash(result.message || '', result.ok ? 'ok' : 'error');
    }}

    function notifySessionClosed() {{
      if (closeNotified) return;
      closeNotified = true;
      const payload = JSON.stringify({{ session_id: sessionId }});
      if (navigator.sendBeacon) {{
        navigator.sendBeacon('/api/session-close', new Blob([payload], {{ type: 'application/json' }}));
        return;
      }}
      fetch('/api/session-close', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: payload,
        keepalive: true,
      }}).catch(() => {{}});
    }}

    async function refreshState() {{
      const response = await fetch(`/api/state?session_id=${{encodeURIComponent(sessionId)}}`);
      const state = await response.json();
      document.getElementById('status-pill').textContent = state.status;
      queueItems = state.queue_items || [];
      currentJob = state.current_job || null;
      renderProgress(state);
      if ((state.selected_input_path || '') !== (selectedInputPath || '')) {{
        selectedInputPath = state.selected_input_path || '';
        updateQuickSummary();
      }} else {{
        renderQueue(document.getElementById(fieldId('general', 'input_path')).value || '');
      }}
      if (state.log_revision !== lastLogRevision) {{
        const logEl = document.getElementById('log');
        const nearBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 24;
        logEl.textContent = state.log_text || '';
        if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
        lastLogRevision = state.log_revision;
      }}
      document.querySelectorAll('button').forEach((button) => {{
        if (button.textContent.includes('GUI を終了')) return;
        if (button.classList.contains('picker-button')) return;
        if (button.dataset.nonblocking === '1') return;
        button.disabled = Boolean(state.running);
      }});
      return state;
    }}

    async function copyLog() {{
      const text = document.getElementById('log').textContent;
      try {{
        await navigator.clipboard.writeText(text);
        setFlash('ログをクリップボードへコピーしました。', 'ok');
      }} catch (e) {{
        setFlash('ログのコピーに失敗しました。', 'error');
      }}
    }}

    document.getElementById('upload-input').addEventListener('change', (event) => {{
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length) uploadInputFiles(files);
      event.target.value = '';
    }});

    window.addEventListener('pagehide', notifySessionClosed);
    window.addEventListener('beforeunload', notifySessionClosed);

    const dropzone = document.getElementById('dropzone');
    ['dragenter', 'dragover'].forEach((eventName) => {{
      dropzone.addEventListener(eventName, (event) => {{
        event.preventDefault();
        dropzone.classList.add('dragover');
      }});
    }});
    ['dragleave', 'drop'].forEach((eventName) => {{
      dropzone.addEventListener(eventName, (event) => {{
        event.preventDefault();
        if (eventName === 'drop') {{
          const files = event.dataTransfer && event.dataTransfer.files ? Array.from(event.dataTransfer.files) : [];
          if (files.length) uploadInputFiles(files);
        }}
        dropzone.classList.remove('dragover');
      }});
    }});

    for (const id of [fieldId('translation', 'target_locale'), fieldId('general', 'output_dir'), fieldId('general', 'input_path')]) {{
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateQuickSummary);
    }}

    applyConfig(initialConfig);
    applyExtract(initialExtract);
    applyUi({{ selected_input_path: selectedInputPath }});
    refreshState().catch(() => {{}});
    setInterval(() => {{
      refreshState().catch(() => {{}});
    }}, 1000);
  </script>
</body>
</html>
"""
        return html_page

    def render_section(self, section: str) -> str:
        title = SECTION_TITLES.get(section, section)
        description = SECTION_DESCRIPTIONS.get(section, "")
        fields_html: list[str] = []

        for key, label, field_type in FIELD_SPECS[section]:
            element_id = f"{section}__{key}"
            hint = FIELD_HELP.get((section, key), "")
            buttons = PATH_PICKERS.get((section, key), [])

            if field_type == "bool":
                fields_html.append(
                    f'<label class="checkbox"><input id="{element_id}" type="checkbox"> {html.escape(label)}</label>'
                )
                continue

            if field_type == "multiline":
                fields_html.append(
                    "<div class=\"field\">"
                    f"<label for=\"{element_id}\">{html.escape(label)}</label>"
                    f"<textarea id=\"{element_id}\"></textarea>"
                    + (f"<div class=\"hint\">{html.escape(hint)}</div>" if hint else "")
                    + "</div>"
                )
                continue

            control_html = ""
            if (section, key) == ("translation", "mode"):
                options = "".join(f'<option value="{html.escape(v)}">{html.escape(v)}</option>' for v in TRANSLATION_MODE_OPTIONS)
                control_html = f'<select id="{element_id}">{options}</select>'
            elif (section, key) == ("api", "style"):
                options = "".join(f'<option value="{html.escape(v)}">{html.escape(v)}</option>' for v in API_STYLE_OPTIONS)
                control_html = f'<select id="{element_id}">{options}</select>'
            else:
                input_type = "password" if (section, key) == ("api", "api_key_direct") else "text"
                control_html = f'<input id="{element_id}" type="{input_type}">'

            if buttons:
                buttons_html = "".join(
                    f'<button class="secondary picker-button" data-nonblocking="1" type="button" onclick="pickPath(\'{kind}\', \'{element_id}\')">{html.escape(text)}</button>'
                    for text, kind in buttons
                )
                control_html = f'<div class="path-row">{control_html}<div class="button-row">{buttons_html}</div></div>'

            fields_html.append(
                "<div class=\"field\">"
                f"<label for=\"{element_id}\">{html.escape(label)}</label>"
                f"{control_html}"
                + (f"<div class=\"hint\">{html.escape(hint)}</div>" if hint else "")
                + "</div>"
            )

        return (
            f'<article class="panel card"><div class="card-head"><div class="eyebrow">Detail</div>'
            f'<h2 class="section-title">{html.escape(title)}</h2>'
            f'<p class="desc">{html.escape(description)}</p></div>'
            f'<div class="section-grid">{"".join(fields_html)}</div></article>'
        )

    def render_extract_options(self) -> str:
        return (
            '<article class="panel card">'
            '<div class="card-head"><div class="eyebrow">Detail</div>'
            '<h2 class="section-title">抽出オプション</h2>'
            '<p class="desc">元 lang を取得する時だけ必要です。普段は何も触らなくて大丈夫です。file モードでは常に JSON ファイル保存のみを行い、クリップボードには入れません。</p></div>'
            '<div class="section-grid">'
            '<div class="field"><label for="extract_output">保存先ファイル</label>'
            '<div class="path-row"><input id="extract_output" type="text">'
            '<div class="button-row"><button class="secondary picker-button" data-nonblocking="1" type="button" onclick="pickPath(\'extract_output\', \'extract_output\')">保存先を選ぶ</button></div>'
            '</div></div>'
            '<div class="field"><label for="extract_locale">locale 優先順</label><input id="extract_locale" type="text"><div class="hint">カンマ区切り。例: en_us, en_gb</div></div>'
            '<div class="field"><label for="extract_namespace">namespace 指定</label><input id="extract_namespace" type="text"></div>'
            '<label class="checkbox"><input id="extract_no_clipboard" type="checkbox"> クリップボードへ入れず、ファイルだけ保存する</label>'
            '</div></article>'
        )

    def render_file_mode_inputs(self) -> str:
        return (
            '<article id="file-mode-card" class="panel card" hidden>'
            '<div class="card-head"><div class="eyebrow">File Mode</div>'
            '<h2 class="section-title">file モード入力</h2>'
            '<p class="desc">翻訳済み JSON / TXT のファイル一覧か、直接貼り付けテキストを使います。1 ファイルに複数 mod 分の辞書が入っていても自動で探索します。</p></div>'
            '<div class="section-grid">'
            '<div class="field"><label for="file_mode__translation_files_text">翻訳ファイル一覧</label>'
            '<div class="button-row"><button class="secondary picker-button" data-nonblocking="1" type="button" onclick="pickPath(\'translation_files\', \'file_mode__translation_files_text\')">ファイルを追加</button></div>'
            '<textarea id="file_mode__translation_files_text" placeholder="/path/to/mod_a.json&#10;/path/to/mod_bundle.txt"></textarea>'
            '<div class="hint">1 行 1 ファイル。JSON / TXT 以外でもテキストとして読めれば解析を試みます。</div>'
            '</div>'
            '<div class="field"><label for="file_mode__inline_translation_text">直接入力テキスト</label>'
            '<textarea id="file_mode__inline_translation_text" placeholder="{&#10;  &quot;mod_a&quot;: {&#10;    &quot;item.example.name&quot;: &quot;例のアイテム&quot;&#10;  }&#10;}"></textarea>'
            '<div class="hint">翻訳済み JSON をそのまま貼るか、複数の JSON ブロックをまとめて貼り付けられます。</div>'
            '</div>'
            '</div></article>'
        )

    def save_uploaded_temp_file(self, filename: str, file_obj: Any, fallback_name: str = "uploaded_mod.jar") -> str:
        safe_name = Path(filename or fallback_name).name
        if not safe_name:
            safe_name = fallback_name
        target = Path(self.upload_temp_dir.name) / safe_name
        stem = target.stem
        suffix = target.suffix
        counter = 1
        while target.exists():
            target = Path(self.upload_temp_dir.name) / f"{stem}_{counter}{suffix}"
            counter += 1
        with target.open("wb") as f:
            shutil.copyfileobj(file_obj, f)
        return str(target)

    def save_uploaded_input_file(self, filename: str, file_obj: Any, queue_enabled: bool = True) -> str:
        target = self.save_uploaded_temp_file(filename, file_obj, "uploaded_mod.jar")
        if queue_enabled:
            self.add_queue_path(str(target), "upload")
            self.set_status("入力ファイルをキューへ追加しました")
        else:
            self.set_selected_input_path(str(target))
            self.set_status("入力ファイルを設定しました")
            self.append_log(f"[INFO] 入力更新: {target}\n", "stdout")
        return str(target)

    def choose_path(self, kind: str) -> tuple[bool, str, str | None, str | None]:
        try:
            if kind == "input_file":
                path = self.pick_file("JAR / ZIP を選ぶ", "All files (*.*)|*.*")
                self.set_selected_input_path(path)
                return True, "入力ファイルを選択しました。", path, "selected_input_path"
            if kind == "input_dir":
                path = self.pick_folder("解凍済み mod フォルダを選ぶ")
                self.set_selected_input_path(path)
                return True, "入力フォルダを選択しました。", path, "selected_input_path"
            if kind == "queue_input_dir":
                path = self.pick_folder("解凍済み mod フォルダをキューへ追加")
                self.add_queue_path(path, "picker")
                return True, "入力フォルダをキューへ追加しました。", path, "queue_only"
            if kind == "translation_files":
                path = self.pick_files("翻訳ファイルを選ぶ", "JSON / Text (*.json;*.txt;*.lang)|*.json;*.txt;*.lang|All files (*.*)|*.*")
                return True, "翻訳ファイルを追加しました。", path, "file_mode__translation_files_text"
            if kind == "output_dir":
                path = self.pick_folder("出力フォルダを選ぶ")
                return True, "出力フォルダを選択しました。", path, "general__output_dir"
            if kind == "icon_file":
                path = self.pick_file("アイコン画像を選ぶ", "Images (*.png;*.webp;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff)|*.png;*.webp;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff|All files (*.*)|*.*")
                return True, "アイコン画像を選択しました。", path, "pack__icon_path"
            if kind == "extract_output":
                path = self.pick_save_file("抽出 JSON の保存先を選ぶ", "source_lang.json")
                return True, "保存先ファイルを選択しました。", path, "extract_output"
            return False, "未対応の選択種別です。", None, None
        except RuntimeError as e:
            return False, str(e), None, None
        except Exception as e:
            return False, f"選択ダイアログを開けませんでした: {e}", None, None

    def pick_file(self, prompt: str, filter_spec: str) -> str:
        if sys.platform == "darwin":
            return self.run_macos_osascript(f'POSIX path of (choose file with prompt "{self.escape_applescript(prompt)}")')
        if sys.platform.startswith("win"):
            script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$dialog = New-Object System.Windows.Forms.OpenFileDialog;"
                f"$dialog.Title = '{self.escape_powershell(prompt)}';"
                f"$dialog.Filter = '{self.escape_powershell(filter_spec)}';"
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {"
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
                "Write-Output $dialog.FileName }"
            )
            return self.run_windows_powershell(script)
        raise RuntimeError("この OS ではファイル選択ダイアログ未対応です。パスを直接入力してください。")

    def pick_files(self, prompt: str, filter_spec: str) -> str:
        if sys.platform == "darwin":
            script = (
                f'set chosen to choose file with prompt "{self.escape_applescript(prompt)}" with multiple selections allowed\n'
                'set output to {}\n'
                'repeat with itemRef in chosen\n'
                'copy POSIX path of itemRef to end of output\n'
                'end repeat\n'
                'set AppleScript\'s text item delimiters to linefeed\n'
                'return output as text'
            )
            return self.run_macos_osascript(script)
        if sys.platform.startswith("win"):
            script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$dialog = New-Object System.Windows.Forms.OpenFileDialog;"
                f"$dialog.Title = '{self.escape_powershell(prompt)}';"
                f"$dialog.Filter = '{self.escape_powershell(filter_spec)}';"
                "$dialog.Multiselect = $true;"
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {"
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
                "$dialog.FileNames -join \"`n\" }"
            )
            return self.run_windows_powershell(script)
        raise RuntimeError("この OS では複数ファイル選択ダイアログ未対応です。パスを直接入力してください。")

    def pick_folder(self, prompt: str) -> str:
        if sys.platform == "darwin":
            return self.run_macos_osascript(f'POSIX path of (choose folder with prompt "{self.escape_applescript(prompt)}")')
        if sys.platform.startswith("win"):
            script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;"
                f"$dialog.Description = '{self.escape_powershell(prompt)}';"
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {"
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
                "Write-Output $dialog.SelectedPath }"
            )
            return self.run_windows_powershell(script)
        raise RuntimeError("この OS ではフォルダ選択ダイアログ未対応です。パスを直接入力してください。")

    def pick_save_file(self, prompt: str, default_name: str) -> str:
        if sys.platform == "darwin":
            script = (
                f'POSIX path of (choose file name with prompt "{self.escape_applescript(prompt)}" '
                f'default name "{self.escape_applescript(default_name)}")'
            )
            return self.run_macos_osascript(script)
        if sys.platform.startswith("win"):
            script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$dialog = New-Object System.Windows.Forms.SaveFileDialog;"
                f"$dialog.Title = '{self.escape_powershell(prompt)}';"
                "$dialog.Filter = 'JSON (*.json)|*.json|All files (*.*)|*.*';"
                f"$dialog.FileName = '{self.escape_powershell(default_name)}';"
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {"
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
                "Write-Output $dialog.FileName }"
            )
            return self.run_windows_powershell(script)
        raise RuntimeError("この OS では保存先選択ダイアログ未対応です。パスを直接入力してください。")

    def run_macos_osascript(self, script: str) -> str:
        proc = subprocess.run(
            ["osascript", "-e", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            message = (proc.stderr or "").strip().lower()
            if "user canceled" in message:
                raise RuntimeError("選択はキャンセルされました。")
            raise RuntimeError((proc.stderr or proc.stdout or "AppleScript 実行に失敗しました。").strip())
        path = proc.stdout.strip()
        if not path:
            raise RuntimeError("選択結果が空でした。")
        return path

    def run_windows_powershell(self, script: str) -> str:
        candidates = ["powershell", "pwsh"]
        last_error = "powershell が見つかりませんでした。"
        for exe in candidates:
            try:
                proc = subprocess.run(
                    [exe, "-NoProfile", "-STA", "-Command", script],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=False,
                )
            except FileNotFoundError:
                continue
            if proc.returncode != 0:
                last_error = (proc.stderr or proc.stdout or last_error).strip()
                continue
            path = proc.stdout.strip()
            if not path:
                raise RuntimeError("選択はキャンセルされました。")
            return path
        raise RuntimeError(last_error)

    def open_target(self, target: str, payload: dict[str, Any]) -> tuple[bool, str]:
        if target == "config_dir":
            return self.open_in_file_manager(self.config_path.parent)
        if target == "readme":
            return self.open_in_file_manager(self.script_dir / "README.md")
        if target == "output_dir":
            form = payload.get("config", {})
            output_dir = ""
            if isinstance(form, dict):
                output_dir = str(form.get("general.output_dir", "") or "").strip()
            path = Path(output_dir) if output_dir else self.script_dir / self.core.DEFAULT_OUTPUT_ROOT
            if not path.is_absolute():
                path = self.script_dir / path
            return self.open_in_file_manager(path)
        return False, "未対応の開く対象です。"

    def open_in_file_manager(self, path: Path) -> tuple[bool, str]:
        target = path.expanduser()
        if not target.exists():
            return False, f"この場所はまだ存在しません: {target}"
        try:
            if sys.platform.startswith("win"):
                os.startfile(str(target))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target)])
        except Exception as e:
            return False, str(e)
        return True, f"開きました: {target}"

    def get_favicon_path(self) -> Path | None:
        for favicon_path in (
            get_assets_dir(self.script_dir) / "favicon.png",
            self.script_dir / "favicon.png",
        ):
            if favicon_path.is_file():
                return favicon_path
        return None

    def handle_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = str(payload.get("action", "")).strip()
        if not action:
            return {"ok": False, "message": "action が指定されていません。"}

        try:
            if action == "save":
                config = self.collect_config(payload)
                self.update_extract_state(payload)
                return {"ok": True, "message": "設定を保存しました。", "config": self.save_config_file(config), "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "reload":
                config = self.reload_config()
                return {"ok": True, "message": "設定を再読込しました。", "config": config, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "reset":
                config = self.reset_defaults()
                return {"ok": True, "message": "初期値を読み込みました。", "config": config, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "clear_input":
                self.set_selected_input_path("")
                self.clear_queue()
                self.set_status("入力をクリアしました")
                return {"ok": True, "message": "入力をクリアしました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": ""}}

            if action == "remove_queue_item":
                item_id = str(payload.get("item_id", "")).strip()
                if not item_id:
                    raise RuntimeError("削除するキュー項目が指定されていません。")
                if not self.remove_queue_item(item_id):
                    raise RuntimeError("指定されたキュー項目が見つかりませんでした。")
                return {"ok": True, "message": "キューから削除しました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "clear_queue":
                self.clear_queue()
                return {"ok": True, "message": "キューを空にしました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "clear_log":
                with self.lock:
                    self.log_text = ""
                    self.log_revision += 1
                self.set_status("ログを消しました")
                return {"ok": True, "message": "ログを消しました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "generate":
                config = self.collect_config(payload)
                self.update_extract_state(payload)
                self.save_config_file(config)
                mode = self.get_translation_mode(config)
                single_argv = self.build_runtime_argv(config, [], payload)
                self.run_action_in_background(
                    "リソースパック生成",
                    lambda input_path, _multiple, _index: self.build_runtime_argv_for_input(input_path),
                    single_argv,
                    allow_queue=(mode != "clipboard"),
                )
                return {"ok": True, "message": "リソースパック生成を開始しました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "extract":
                config = self.collect_config(payload)
                self.update_extract_state(payload)
                self.save_config_file(config)
                mode = self.get_translation_mode(config)
                single_argv = self.build_extract_argv(config, payload)
                self.run_action_in_background(
                    "元 lang 抽出",
                    lambda input_path, multiple, index: self.build_extract_argv_for_input(input_path, multiple, index),
                    single_argv,
                    allow_queue=(mode != "clipboard"),
                )
                return {"ok": True, "message": "元 lang 抽出を開始しました。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            if action == "shutdown":
                with self.lock:
                    self.shutdown_requested = True
                self.set_status("GUI を終了します")
                threading.Thread(target=self.shutdown_server, daemon=True).start()
                return {"ok": True, "message": "GUI を終了します。", "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

            return {"ok": False, "message": f"未対応の action です: {action}"}
        except Exception as e:
            self.append_log(f"[ERROR] {e}\n", "stderr")
            return {"ok": False, "message": str(e), "config": self.config_data, "extract": self.extract_state, "ui": {"selected_input_path": self.selected_input_path}}

    def shutdown_server(self) -> None:
        server = self.server
        if server is not None:
            server.shutdown()

    @staticmethod
    def escape_applescript(text: str) -> str:
        return text.replace("\\", "\\\\").replace('"', '\\"')

    @staticmethod
    def escape_powershell(text: str) -> str:
        return text.replace("'", "''")


def launch_web_gui_app(core: Any, script_dir: Path | None = None, config_path: Path | None = None) -> int:
    project_root = script_dir or detect_project_root()
    app = WebGUIApp(core, project_root, config_path or get_config_path(project_root))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                body = app.render_html().encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path in ("/favicon.png", "/favicon.ico"):
                favicon_path = app.get_favicon_path()
                if favicon_path is None:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                body = favicon_path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path == "/api/state":
                session_id = parse_qs(parsed.query).get("session_id", [""])[0]
                app.touch_browser_session(session_id)
                self.send_json(app.get_state())
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/action":
                payload = self.read_json()
                self.send_json(app.handle_action(payload))
                return
            if parsed.path == "/api/pick":
                payload = self.read_json()
                kind = str(payload.get("kind", "")).strip()
                ok, message, path, target_field = app.choose_path(kind)
                self.send_json({"ok": ok, "message": message, "path": path, "target_field": target_field})
                return
            if parsed.path == "/api/open":
                payload = self.read_json()
                ok, message = app.open_target(str(payload.get("target", "")).strip(), payload)
                self.send_json({"ok": ok, "message": message})
                return
            if parsed.path == "/api/upload-input":
                ok, message, path = self.handle_upload_input()
                self.send_json({"ok": ok, "message": message, "path": path, "ui": {"selected_input_path": path or ""}})
                return
            if parsed.path == "/api/session-close":
                payload = self.read_json()
                app.close_browser_session(str(payload.get("session_id", "")))
                self.send_json({"ok": True})
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def handle_upload_input(self) -> tuple[bool, str, str | None]:
            try:
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={
                        "REQUEST_METHOD": "POST",
                        "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    },
                    keep_blank_values=True,
                )
            except Exception as e:
                return False, f"アップロード解析に失敗しました: {e}", None

            file_items = form["input_file"] if "input_file" in form else None
            if file_items is None:
                return False, "アップロードされたファイルが見つかりませんでした。", None

            items = file_items if isinstance(file_items, list) else [file_items]
            valid_items = [item for item in items if getattr(item, "filename", "")]
            if not valid_items:
                return False, "アップロードされたファイルが見つかりませんでした。", None

            queue_enabled = str(form.getfirst("queue_enabled", "1") or "1").strip() not in ("0", "false", "False")
            try:
                saved_paths = [app.save_uploaded_input_file(item.filename, item.file, queue_enabled=queue_enabled) for item in valid_items]
            except Exception as e:
                return False, str(e), None
            if queue_enabled:
                return True, f"{len(saved_paths)} 件の入力をキューへ追加しました。", saved_paths[-1]
            return True, "入力ファイルを設定しました。", saved_paths[-1]

        def read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return {}

        def send_json(self, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    app.server = server
    threading.Thread(target=app.monitor_browser_sessions, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"[INFO] ブラウザ GUI を起動します。")
    print(f"[INFO] 次の URL を開いてください: {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"[WARN] ブラウザの自動起動に失敗しました: {e}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] GUI を終了します。")
    finally:
        app.server = None
        server.server_close()
    return 0
