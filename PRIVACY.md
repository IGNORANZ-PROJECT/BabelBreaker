# Privacy

Babel Breaker is designed to process game translation data locally in the user's browser. The current release supports Minecraft mods, modpacks, Java and Bedrock worlds, Add-ons, resource packs, data packs, server-plugin locale files, Factorio, Stardew Valley Content Patcher, and RimWorld language-file formats.

## Data the application does not collect

- MOD JAR or ZIP contents
- extracted language files
- translation results
- glossary entries
- source images and OCR results
- generated resource packs, translated mods, or translation mods
- user accounts or API keys
- application cookies, Analytics identifiers, or LocalStorage data

The browser version does not include an application backend.

For Factorio and Stardew Valley, the browser copies the selected original archive and adds the translated language files to create a replacement mod. For RimWorld, it creates a separate translation mod without copying the original mod. Both operations happen locally; generated archives are not uploaded or retained by Babel Breaker.

Bedrock World LevelDB text in supported records is read locally. Existing database files are preserved; approved translations are added in a checksummed LevelDB log. Unsupported records and Java external chunks are preserved. Server plugin output is a separate locale patch and does not contain or rewrite plugin classes.

## Local translation model

Local translation uses the Mozilla Bergamot WebAssembly engine. Babel Breaker detects source languages from each supported game's locale filenames and the text itself. Supported local source languages are English, Japanese, Korean, Simplified Chinese, Traditional Chinese, German, Spanish, French, Portuguese, Russian, and Italian; the same set except English is available as a target. For non-English language pairs, the browser translates source-to-English and then English-to-target without sending either stage outside the device.

The browser downloads only the required compressed models from an immutable commit in the public `mukowaty/firefox-translations` Hugging Face repository. That repository mirrors Mozilla Firefox Translations models. Babel Breaker verifies the compressed byte size and SHA-256 before expanding a model. Requests contain only static model-file paths; they do not contain MOD text, extracted language entries, glossary entries, or translation results.

Downloaded model files may be retained in the browser's Cache Storage so they can be reused. Babel Breaker does not store MOD contents or translation results in that cache. Users can remove the model cache by clearing this site's stored data in their browser.

## Optional image OCR

Image translation is disabled until the user selects **Find images** and then runs OCR for a chosen image. Candidate PNG, JPEG, and supported TGA files are read from the archive locally. OCR, translation, preview, and compositing happen in the browser; source images, recognized text, and edited images are not uploaded.

When OCR is run, the browser downloads version-pinned Tesseract.js executable files and public OCR language data directly from jsDelivr. jsDelivr therefore receives the normal network metadata for those static requests, including the requesting IP address, but no archive bytes, image bytes, recognized text, or translation results. Tesseract.js may cache OCR language data in browser storage for reuse. Clearing this site's stored data removes that cache.

## Clipboard mode

External-tool mode creates the copyable request and downloadable source JSON locally. Translated JSON/TXT files selected or dropped back into Babel Breaker are read locally. Data leaves the device only if the user submits the copied request or source file to an external translation service. That service's privacy policy and terms then apply.

## Firebase Hosting

Firebase Hosting distributes the application's static HTML, CSS, JavaScript, icons, and legal notices. Translation-model files are excluded from Firebase and served by Hugging Face. Optional OCR runtime and language files are served directly by jsDelivr. According to Firebase's privacy documentation, Hosting processes incoming request IP addresses to detect abuse and provide usage analysis, and retains IP data for a limited period. Hugging Face and jsDelivr separately process requests for their static files under their own privacy terms.

Firebase privacy information:

https://firebase.google.com/support/privacy/

Hugging Face privacy information:

https://huggingface.co/privacy

jsDelivr privacy policy:

https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net

## Contact and changes

Questions may be submitted through the project's GitHub Issues:

https://github.com/IGNORANZ-PROJECT/BabelBreaker/issues

Material changes to this document should be reviewed before deployment.
