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

The first development or production build downloads 20 pinned bidirectional Mozilla models, verifies their sizes and SHA-256 hashes, and stores them under the ignored `public/models/` directory. The complete build-time model set is about 876 MiB. A visitor downloads only the models needed for the current translation: about 36–65 MB for English source text, or usually about 58–136 MB for a non-English pair that pivots through English. Mods with several source languages may require additional source-to-English models. The browser may reuse models from Cache Storage.

## Test and build

```bash
npm run check
```

The production site is generated under `dist/`.

## Firebase Hosting and GitHub model delivery

The configured Firebase project is `babel-breaker`.
Firebase serves only the roughly 6 MB Web application. The roughly 876 MiB model set is stored as regular Git files under `public/models/` in this public repository and served from `raw.githubusercontent.com` at the pinned `models-v1` tag. Babel Breaker does not use Git LFS, Firebase Storage, or a paid CDN.

```bash
# Create the immutable model tag once on the commit containing the model files
git tag models-v1
git push origin models-v1

npm run verify:model-hosting
firebase deploy --only hosting
```

Do not move or overwrite `models-v1` after publication. For a model update, change `GITHUB_MODEL_REVISION` to a new value such as `models-v2` and publish that new tag.

The Firebase predeploy hook runs `npm run check:firebase`, points the model registry to the pinned tag in this GitHub repository, and removes `dist/models`. The Content Security Policy allows model requests only to `raw.githubusercontent.com`. Every model file is under 100 MiB and is committed as a regular Git file, so Git LFS storage and bandwidth billing do not apply.

Firebase Hosting serves application files only. Babel Breaker does not use Firebase Authentication, Firestore, Storage, Analytics, or an application API.

## Privacy and security

- Mod files and translation text are not uploaded
- No account, API key, app cookie, Analytics ID, or LocalStorage data
- Cache Storage contains only reusable public translation-model files
- Model downloads come from the pinned tag in this public GitHub repository and are SHA-256 verified
- Non-English pivot translation remains entirely inside the browser
- Archive paths, expanded language-data size, and entry count are validated
- Minecraft formatting tokens are checked again before ZIP generation
- A restrictive Content Security Policy blocks third-party scripts and network requests

See [Privacy](PRIVACY.md) and [Security Policy](SECURITY.md).

## License

Babel Breaker is available under the [MIT License](LICENSE). Runtime dependencies and translation models retain their own licenses; production builds include `THIRD_PARTY_NOTICES.txt`.

Babel Breaker is an unofficial community tool and is not affiliated with Mojang Studios or Microsoft. Check a mod's license and author policy before publishing or redistributing generated translations.
