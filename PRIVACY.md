# Privacy

Babel Breaker is designed to process Minecraft MOD translation data locally in the user's browser.

## Data the application does not collect

- MOD JAR or ZIP contents
- extracted language files
- translation results
- glossary entries
- downloaded resource packs
- user accounts or API keys
- application cookies, Analytics identifiers, or LocalStorage data

The browser version does not include an application backend.

## Local translation model

Local translation uses the Mozilla Bergamot WebAssembly engine. Babel Breaker detects source languages from Minecraft locale filenames. Supported local source languages are English, Japanese, Korean, Simplified Chinese, Traditional Chinese, German, Spanish, French, Portuguese, Russian, and Italian; the same set except English is available as a target. For non-English language pairs, the browser translates source-to-English and then English-to-target without sending either stage outside the device.

The browser downloads only the pinned models needed for the current translation from the `models-v1` tag in the public Babel Breaker GitHub repository. The development build obtains those models from Mozilla's official distribution endpoint, and both the build and browser verify their SHA-256 hashes. Model requests contain only static model-file paths; they do not contain MOD text, extracted language entries, glossary entries, or translation results.

Downloaded model files may be retained in the browser's Cache Storage so they can be reused. Babel Breaker does not store MOD contents or translation results in that cache. Users can remove the model cache by clearing this site's stored data in their browser.

## Clipboard mode

External-tool mode creates the copyable request and downloadable source JSON locally. Translated JSON/TXT files selected or dropped back into Babel Breaker are read locally. Data leaves the device only if the user submits the copied request or source file to an external translation service. That service's privacy policy and terms then apply.

## Firebase Hosting

Firebase Hosting distributes the application's static HTML, CSS, JavaScript, icons, and legal notices. Translation-model files are excluded from the Firebase deployment and are served as public files by GitHub. According to Firebase's privacy documentation, Hosting processes incoming request IP addresses to detect abuse and provide usage analysis, and retains IP data for a limited period. GitHub separately processes requests for static model files under its own privacy terms.

Firebase privacy information:

https://firebase.google.com/support/privacy/

GitHub privacy information:

https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement

## Contact and changes

Questions may be submitted through the project's GitHub Issues:

https://github.com/IGNORANZ-PROJECT/BabelBreaker/issues

Material changes to this document should be reviewed before deployment.
