# Babel Breaker

[日本語](README.md)

Babel Breaker is an open-source browser tool that detects the source language of Minecraft mod language files, translates them into ten target languages, and builds an installable resource-pack ZIP.

The mod archive, extracted text, glossary, translation, and generated ZIP stay in the user's browser. There is no application backend, account, or API key.

## Features

- Drag and drop one or multiple `.jar` or `.zip` mod files
- Detect Fabric, Forge, NeoForge, and Quilt metadata
- Read multiple namespaces and both `.json` and legacy `.lang` files
- Keep the locale-declared language separate from the content-detected language and show high-confidence mismatches per entry
- Avoid auto-translating Han-only text when Japanese and Chinese cannot be distinguished safely
- Translate locally with Mozilla Bergamot and WebAssembly
- Translate non-English pairs locally by pivoting from the source language through English to the target
- Target Japanese, Korean, Simplified Chinese, Traditional Chinese, German, Spanish, French, Brazilian Portuguese, Russian, or Italian
- Switch the interface between Japanese, English, Korean, Simplified Chinese, and Spanish
- Default the target language to the selected interface language; English UI falls back to a supported browser preference
- Preserve Minecraft placeholders, color codes, line breaks, and URLs
- Reuse existing translations for the selected locale
- Review and edit every translation in the browser
- Show machine-translated entries under Needs review by default
- Include untranslated entries in the default review queue and sort them before errors, unclear languages, and machine translations
- Treat blank source values as non-translatable instead of untranslated
- Ignore entries individually or in bulk and omit unresolved, ignored, or unsafe entries without blocking ZIP creation
- Combine several mods into one translation resource pack
- Build resource packs for Minecraft 1.11–1.21.11 and 26.1
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

Babel Breaker is an unofficial community tool and is not affiliated with Mojang Studios or Microsoft. Check a mod's license and author policy before publishing or redistributing generated translations.
