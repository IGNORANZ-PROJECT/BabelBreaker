# Security Policy

## Supported version

Security fixes are applied to the latest Web version on the `main` branch and the version published at `https://babel-breaker.web.app/`.

## Reporting a vulnerability

Do not disclose exploit details, malicious sample archives, personal information, or secrets in a public Issue.

Use GitHub's **Security → Report a vulnerability** flow:

https://github.com/IGNORANZ-PROJECT/BabelBreaker/security/advisories/new

Repository administrators should enable **Private vulnerability reporting** before the public Web launch. If the private report button is unavailable, open a public Issue containing only a request for private contact and no vulnerability details.

Please include:

- affected URL, commit, or version
- browser and operating system
- minimal reproduction steps
- expected and actual behavior
- impact assessment

## Security model

- MOD archives and translations are processed in the browser.
- Firebase Hosting serves static assets only.
- The app does not use Firebase Authentication, Storage, Firestore, Analytics, cookies, or API keys.
- Clipboard mode sends nothing automatically; users choose where to paste copied text.
- Source languages are inferred from archive locale filenames; no source text is sent to a language-detection service.
- Compressed local model files are pinned to an immutable Hugging Face commit by URL, byte size, and SHA-256 and are checked before browser-side decompression.
- Firebase production builds exclude model binaries; CSP permits model downloads only from the selected Hugging Face delivery hosts.
- Non-English translation pivots through English entirely inside local WebAssembly workers.
- Untrusted archives are subject to path, entry-count, format, namespace, and decompressed-size validation.
