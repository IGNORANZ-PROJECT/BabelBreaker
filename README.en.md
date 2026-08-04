# Babel Breaker

[日本語](README.md)

Babel Breaker is an open-source browser tool that detects and translates text from Minecraft, Factorio, Stardew Valley, and RimWorld game files into eleven target languages.

The mod archive, extracted text, glossary, translation, and generated ZIP stay in the user's browser. There is no application backend, account, or API key.

## Features

- Drag and drop one or multiple `.jar`, `.zip`, `.mrpack`, `.mcpack`, `.mcaddon`, or `.mcworld` files
- Auto-detect the game and supported language-file format
  - Minecraft Java Edition `.json` / `.lang`
  - Modrinth, CurseForge, and instance modpacks, with optional local JARs for referenced files not included in the export
  - Java worlds with nested `resources.zip` and known sign, book, and display-name text in Anvil regions
  - Bedrock Add-ons, worlds, and resource packs with `.lang`, `languages.json`, and manifest dependency handling
  - Known visible JSON and `.mcfunction` text in data packs
  - External JSON, YAML, and properties locale patches for server plugins without rewriting the plugin JAR
  - Patchouli resource-pack guidebook category, entry, and template JSON
  - FTB Quests 1.21 locale SNBT plus visible fields in legacy SNBT and binary NBT
  - Names and descriptions in legacy Better Questing JSON
  - Factorio `locale/<language>/*.cfg`
  - Stardew Valley Content Patcher `i18n/*.json`
  - RimWorld Keyed and DefInjected XML
- Detect Fabric, Forge, NeoForge, and Quilt metadata for Minecraft
- Keep the locale-declared language separate from the content-detected language and show high-confidence mismatches per entry
- Avoid auto-translating Han-only text when Japanese and Chinese cannot be distinguished safely
- Translate locally with Mozilla Bergamot and WebAssembly
- Translate non-English pairs locally by pivoting from the source language through English to the target
- Target English, Japanese, Korean, Simplified Chinese, Traditional Chinese, German, Spanish, French, Brazilian Portuguese, Russian, or Italian
- Switch the interface between Japanese, English, Korean, Simplified Chinese, and Spanish
- Default the target language to the selected interface language
- Preserve printf and plugin placeholders, MiniMessage tags, named quest substitutions, Patchouli `$(...)` formatting, color codes, line breaks, and URLs
- Reuse existing translations for the selected locale
- Review and edit every translation in the browser
- Show machine-translated entries under Needs review by default
- Include untranslated entries in the default review queue and sort them before errors, unclear languages, and machine translations
- Treat blank source values as non-translatable instead of untranslated
- Ignore entries individually or in bulk and omit unresolved, ignored, or unsafe entries without blocking ZIP creation
- Process several mods from the same game and download their outputs in one bundle
- Build resource packs for Minecraft 1.11–1.21.11 and 26.1
- Add translated Patchouli locale JSON to the Minecraft resource pack
- Build a translation bundle with separate resource-pack and instance files when FTB Quests or Better Questing data is detected
- Build complete translated replacement-mod ZIPs for Factorio
- Build complete translated replacement-mod ZIPs for Stardew Valley Content Patcher mods
- Build standalone RimWorld translation-mod ZIPs without modifying or including the original mod
- Copy a request or download source JSON for an external translation tool
- Paste, select, or drop a translated JSON/TXT file back into the review flow

Live site: https://babel-breaker.web.app/

## Local development

Requirements:

- Node.js 20 or newer
- npm

```bash
npm install
npm run dev
```

Open the localhost URL shown by Vite.

Development and production builds do not download model binaries. A visitor downloads only the compressed models needed for the current translation: about 24–48 MiB for English source text, or usually about 38–94 MiB for a non-English pair that pivots through English. The browser expands and SHA-256 verifies each download, then may reuse it from Cache Storage.

## Test and build

```bash
npm run check
```

The production site is generated under `dist/`.

## Minecraft extended-format scope

- Modpacks scan included JARs and can use separately selected local JARs to cover referenced files missing from an export. Original MOD JARs are not modified; a translation resource pack is added.
- Java worlds translate known sign, book, and display-name fields in standard Anvil region chunks. External chunks are preserved, and the region location table is rebuilt after text-size changes.
- Bedrock Add-ons and resource packs retain UUIDs while updating changed manifest patch versions and dependency versions. Bedrock World LevelDB data is preserved unchanged; only accessible embedded language resources are translated.
- Data packs and server plugins restrict extraction to known visible fields. Command identifiers and plugin JARs are not rewritten.
- Patchouli support targets resource-pack books under `assets/<namespace>/patchouli_books/<book>/<locale>/`.
- FTB Quests 1.21 locale files under `config/ftbquests/quests/lang/<locale>.snbt` reuse existing target translations. Legacy quest SNBT and binary NBT extract fields such as `title`, `subtitle`, and `description`.
- Better Questing support extracts fields such as `name`, `desc`, and `description` from quest JSON under `config/betterquesting`.
- Binary `.nbt` preserves all 12 tag types, Java Modified UTF-8, and raw, GZIP, or zlib compression while changing visible strings only. Malformed or over-limit NBT is skipped unchanged with a warning.

## Firebase Hosting and model delivery

The configured Firebase project is `babel-breaker`.
Firebase serves only the roughly 6 MB Web application. The roughly 619 MiB compressed model set is sourced from Mozilla Firefox Translations, pinned to an immutable commit of a public Hugging Face mirror, and delivered directly to each browser. Babel Breaker does not require Firebase Storage, Functions, a paid CDN, or a credit card.

```bash
npm run verify:model-hosting
firebase deploy --only hosting
```

The Firebase predeploy hook runs `npm run check:firebase`, verifies every pinned model URL, byte size, and CORS policy, and removes `dist/models`. The Content Security Policy allows model requests only to the pinned Hugging Face delivery hosts. Run `npm run sync:models` when intentionally updating the pinned model catalog.

Firebase Hosting serves application files only. Babel Breaker does not use Firebase Authentication, Firestore, Storage, Analytics, or an application API.

## Privacy and security

- Mod files and translation text are not uploaded
- No account, API key, app cookie, Analytics ID, or LocalStorage data
- Cache Storage contains only reusable public translation-model files
- Model downloads come from a pinned public Hugging Face commit and are SHA-256 verified
- Non-English pivot translation remains entirely inside the browser
- Archive paths, expanded language-data size, and entry count are validated
- Minecraft formatting tokens are checked again before ZIP generation
- A restrictive Content Security Policy blocks third-party scripts and network requests

See [Privacy](PRIVACY.md) and [Security Policy](SECURITY.md).

## License

Babel Breaker is available under the [MIT License](LICENSE). Runtime dependencies and translation models retain their own licenses; production builds include `THIRD_PARTY_NOTICES.txt`.

Babel Breaker is an unofficial community tool and is not affiliated with the developers or publishers of any supported game. Check a mod's license and author policy before publishing or redistributing generated translations.

Factorio and Stardew Valley outputs contain files from the selected original mod to make personal installation a simple replacement. Do not redistribute those output archives unless the original mod's license or author permits it. RimWorld output is a separate translation mod and does not contain the original mod.
