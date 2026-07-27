from __future__ import annotations

import io
import json
import stat
import tempfile
import unittest
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

from babel_breaker_app import main, web_gui


class IdCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for key, value in attrs:
            if key == "id" and value:
                self.ids.append(value)


class LocalAiTests(unittest.TestCase):
    def make_config(self, style: str = "ollama_chat") -> dict[str, object]:
        config = main.merge_config_with_defaults({})
        config["translation"]["mode"] = "local_ai"
        config["local_ai"]["style"] = style
        return config

    def test_local_ai_defaults_are_loopback_only(self) -> None:
        settings = main.get_local_ai_settings(self.make_config())
        self.assertEqual(settings[0], "ollama_chat")
        self.assertEqual(settings[1], "qwen3:8b")
        self.assertEqual(settings[2], "http://127.0.0.1:11434/api/chat")
        with self.assertRaisesRegex(RuntimeError, "localhost"):
            main.validate_local_ai_url("https://example.com/v1/chat/completions")

    def test_ollama_translation_uses_native_json_chat_without_api_key(self) -> None:
        config = self.make_config()
        response = {"message": {"content": json.dumps({"item.test": "テスト"}, ensure_ascii=False)}}
        with mock.patch.object(main, "http_post_json", return_value=response) as post:
            translated = main.call_ai_translate_chunk(
                {"item.test": "Test", "__meta_source_locale__": "en_us"},
                config,
                main.ModInfo("fabric", "example", "Example", "1.0.0", "1.21.1", None),
                "",
            )
        self.assertEqual(translated, {"item.test": "テスト"})
        url, payload, headers, timeout = post.call_args.args
        self.assertEqual(url, "http://127.0.0.1:11434/api/chat")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["format"], "json")
        self.assertNotIn("Authorization", headers)
        self.assertEqual(timeout, 600)

    def test_openai_compatible_local_translation_has_no_authorization_header(self) -> None:
        config = self.make_config("openai_compatible_chat")
        config["local_ai"]["model"] = "local-model"
        response = {
            "choices": [
                {"message": {"content": json.dumps({"item.test": "テスト"}, ensure_ascii=False)}}
            ]
        }
        with mock.patch.object(main, "http_post_json", return_value=response) as post:
            translated = main.call_ai_translate_chunk(
                {"item.test": "Test"},
                config,
                main.ModInfo("fabric", "example", "Example", "1.0.0", "1.21.1", None),
                "",
            )
        self.assertEqual(translated["item.test"], "テスト")
        self.assertEqual(post.call_args.args[0], "http://127.0.0.1:1234/v1/chat/completions")
        self.assertNotIn("Authorization", post.call_args.args[2])

    def test_connection_check_reads_model_list(self) -> None:
        with mock.patch.object(
            main,
            "http_get_json",
            return_value={"models": [{"name": "qwen3:8b"}, {"model": "gemma3:12b"}]},
        ) as get:
            models = main.check_local_ai_connection(self.make_config())
        self.assertEqual(models, ["qwen3:8b", "gemma3:12b"])
        self.assertEqual(get.call_args.args[0], "http://127.0.0.1:11434/api/tags")


class ArchiveSafetyTests(unittest.TestCase):
    def test_safe_archive_extracts_normal_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "out"
            with zipfile.ZipFile(io.BytesIO(self.make_zip("assets/example/lang/en_us.json", b"{}"))) as zf:
                main.safe_extract_archive(zf, destination)
            self.assertEqual((destination / "assets/example/lang/en_us.json").read_bytes(), b"{}")

    def test_safe_archive_rejects_parent_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with zipfile.ZipFile(io.BytesIO(self.make_zip("../outside.txt", b"bad"))) as zf:
                with self.assertRaisesRegex(RuntimeError, "安全でない"):
                    main.safe_extract_archive(zf, Path(temp) / "out")

    def test_safe_archive_rejects_symbolic_link(self) -> None:
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as zf:
            info = zipfile.ZipInfo("assets/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, "../../outside")
        with tempfile.TemporaryDirectory() as temp, zipfile.ZipFile(io.BytesIO(data.getvalue())) as zf:
            with self.assertRaisesRegex(RuntimeError, "シンボリックリンク"):
                main.safe_extract_archive(zf, Path(temp) / "out")

    @staticmethod
    def make_zip(name: str, content: bytes) -> bytes:
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as zf:
            zf.writestr(name, content)
        return data.getvalue()


class ResourcePackSmokeTests(unittest.TestCase):
    def test_file_mode_builds_installable_zip(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mod_root = root / "example-mod"
            lang_dir = mod_root / "assets/example/lang"
            lang_dir.mkdir(parents=True)
            (lang_dir / "en_us.json").write_text(
                json.dumps({"item.example": "Example Item"}),
                encoding="utf-8",
            )
            (mod_root / "fabric.mod.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "id": "example",
                        "name": "Example Mod",
                        "version": "1.0.0",
                        "depends": {"minecraft": "1.21.1"},
                    }
                ),
                encoding="utf-8",
            )
            config = main.merge_config_with_defaults({})
            config["translation"]["mode"] = "file"
            config["file_mode"]["inline_translation_text"] = json.dumps(
                {"item.example": "サンプルアイテム"},
                ensure_ascii=False,
            )
            config["general"]["output_dir"] = str(root / "output")
            context = main.RuntimeContext(root, root / "config.toml", config, False)

            with mock.patch.object(main, "find_icon_file", return_value=None):
                pack_dir, zip_path = main.create_resource_pack(context, mod_root, mod_root)

            self.assertIsNone(pack_dir)
            self.assertTrue(zip_path.is_file())
            with zipfile.ZipFile(zip_path) as zf:
                names = set(zf.namelist())
                self.assertIn("pack.mcmeta", names)
                self.assertIn("assets/example/lang/ja_jp.json", names)
                translated = json.loads(zf.read("assets/example/lang/ja_jp.json"))
            self.assertEqual(translated, {"item.example": "サンプルアイテム"})


class GuiReleaseTests(unittest.TestCase):
    def test_rendered_gui_has_unique_ids_and_local_ai_controls(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app = web_gui.WebGUIApp(main, root, root / "babel_breaker_app/config.toml")
        try:
            page = app.render_html()
        finally:
            app.upload_temp_dir.cleanup()
        parser = IdCollector()
        parser.feed(page)
        duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
        self.assertEqual(duplicates, [])
        self.assertIn('id="mode-local-ai"', page)
        self.assertIn('id="local-ai-card"', page)
        self.assertIn("接続を確認", page)

    def test_failed_local_connection_keeps_selected_mode(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app = web_gui.WebGUIApp(main, root, root / "babel_breaker_app/config.toml")
        payload = {
            "action": "test_local_ai",
            "config": {
                "translation.mode": "local_ai",
                "local_ai.style": "ollama_chat",
                "local_ai.model": "qwen3:8b",
            },
        }
        try:
            with mock.patch.object(
                main,
                "check_local_ai_connection",
                side_effect=RuntimeError("ローカル AI に接続できません"),
            ):
                result = app.handle_action(payload)
        finally:
            app.upload_temp_dir.cleanup()
        self.assertFalse(result["ok"])
        self.assertEqual(result["config"]["translation"]["mode"], "local_ai")


if __name__ == "__main__":
    unittest.main()
