import "./styles.css";
import {
  MAX_LANG_TEXT_LENGTH,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MINECRAFT_VERSIONS,
  SUPPORTED_ARTIFACTS,
  SUPPORTED_GAMES,
  applyClipboardTranslation,
  buildClipboardPayload,
  buildTranslationRequest,
  combineProjects,
  getEntryWorkflowState,
  getLocalTranslatorStatus,
  getProjectStats,
  placeholdersMatch,
  sanitizeFileName,
  translateProject,
} from "./core.js";
import {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  estimateLocalModelSizeMb,
  getDefaultTargetLanguage,
  getSourceLanguage,
  getTargetLanguage,
} from "./languages.js";
import {
  UI_LOCALES,
  createI18n,
  detectUiLocale,
} from "./i18n.js";
import { selectGuideForProject } from "./guide-selection.js";
import { SHOW_PROJECT_INFO } from "./site-config.js";
import {
  analyzeArchiveInBackground,
  buildArchiveInBackground,
  scanImagesInBackground,
} from "./archive-jobs.js";

const initialUrl = new URL(window.location.href);
const requestedUiLocale = initialUrl.searchParams.get("lang");
const { locale: uiLocale, numberLocale, t } = createI18n(
  requestedUiLocale || detectUiLocale(),
);
const requestedTargetLanguage = initialUrl.searchParams.get("target");
const initialTargetLanguage = TARGET_LANGUAGES.some(
  (language) => language.id === requestedTargetLanguage,
)
  ? requestedTargetLanguage
  : getDefaultTargetLanguage(uiLocale);
document.documentElement.lang = uiLocale;
document.title = t("pageTitle");
document
  .querySelector('meta[name="description"]')
  ?.setAttribute("content", t("heroCopy"));

const state = {
  project: null,
  sourceFiles: [],
  targetLanguage: initialTargetLanguage,
  mode: "local",
  translatorStatus: { supported: false, availability: "checking" },
  filter: "warning",
  search: "",
  visibleEntries: 100,
  abortController: null,
  busy: false,
  guideGame: "minecraft",
  minecraftGuideMode: "javaMod",
  bedrockTranslationMode: "localized",
  imageCandidates: [],
  imageRegions: new Map(),
  selectedImageId: "",
  translateImages: false,
  imageView: "after",
  imageEditing: false,
  selectedRegionIds: new Set(),
  imageSelectionMode: false,
  selectedImageIds: new Set(),
  textSelectionMode: false,
  selectedEntryIds: new Set(),
  lastSelectedEntryId: "",
  reviewTab: "text",
};
const CONTENT_KIND_LABELS = {
  patchouli: "Patchouli",
  ftbquests: "FTB Quests",
  betterquesting: "Better Questing",
};
const MINECRAFT_GUIDES = [
  { id: "javaMod", label: "minecraftGuideJavaMod", prefix: "guide" },
  { id: "modpack", label: "minecraftGuideModpack", prefix: "modpackGuide" },
  { id: "javaWorld", label: "minecraftGuideJavaWorld", prefix: "javaWorldGuide" },
  { id: "javaResourcePack", label: "minecraftGuideJavaResourcePack", prefix: "javaResourcePackGuide" },
  { id: "dataPack", label: "minecraftGuideDataPack", prefix: "dataPackGuide" },
  { id: "serverPlugin", label: "minecraftGuideServerPlugin", prefix: "serverPluginGuide" },
  { id: "bedrockAddon", label: "minecraftGuideBedrockAddon", prefix: "bedrockAddonGuide" },
  { id: "bedrockWorld", label: "minecraftGuideBedrockWorld", prefix: "bedrockWorldGuide" },
];

const icon = (name, size = 20) => {
  const paths = {
    upload:
      '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/>',
    shield:
      '<path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    copy:
      '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download:
      '<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    jar: '<path d="M7 3h10l2 4v13H5V7l2-4Z"/><path d="M5 8h14M9 3v5m6-5v5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    refresh:
      '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 1 0 1 8"/>',
    external: '<path d="M14 4h6v6m0-6-9 9"/><path d="M19 13v6H5V5h6"/>',
    warning:
      '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
};

const targetLanguageOptions = TARGET_LANGUAGES.map(
  (language) => {
    const label =
      language.nativeName === language.englishName
        ? language.nativeName
        : `${language.nativeName} · ${language.englishName}`;
    return `<option value="${language.id}" ${language.id === state.targetLanguage ? "selected" : ""}>${label}</option>`;
  },
).join("");

const uiLanguageOptions = UI_LOCALES.map(
  (locale) =>
    `<option value="${locale.id}" ${locale.id === uiLocale ? "selected" : ""}>${locale.label}</option>`,
).join("");

const sourceLanguageOptions = SOURCE_LANGUAGES.map((language) =>
  `<option value="${language.id}">${language.nativeName}</option>`,
).join("");

const headerProjectLink = SHOW_PROJECT_INFO
  ? `
      <a
        class="header-link header-github"
        href="https://github.com/IGNORANZ-PROJECT/BabelBreaker"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${t("githubAria")}"
      >GitHub ${icon("external", 15)}</a>`
  : "";

const projectCallout = SHOW_PROJECT_INFO
  ? `
      <a
        class="oss-callout"
        href="https://github.com/IGNORANZ-PROJECT/BabelBreaker"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>
          <strong>${t("ossTitle")}</strong>
          <small>${t("ossCopy")}</small>
        </span>
        ${icon("external", 15)}
      </a>`
  : "";

const ossPanel = SHOW_PROJECT_INFO
  ? `
      <div class="oss-panel">
        <div>
          <span class="oss-mark">MIT</span>
          <span>
            <strong>${t("ossFreedom")}</strong>
            <small>
              © 2026
              <a class="project-link" href="https://ignoranz-project.web.app/" target="_blank" rel="noopener noreferrer" aria-label="${t("projectSiteAria")}">IGNORANZ PROJECT</a>
            </small>
          </span>
        </div>
        <div class="oss-links">
          <a href="https://github.com/IGNORANZ-PROJECT/BabelBreaker" target="_blank" rel="noopener noreferrer">
            ${t("sourceCode")} ${icon("external", 14)}
          </a>
          <a href="/LICENSE.txt" target="_blank" rel="noopener">MIT License</a>
          <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">${t("thirdParty")}</a>
        </div>
      </div>`
  : "";

const footerProjectInfo = SHOW_PROJECT_INFO
  ? `
    <span>
      © 2026
      <a class="project-link" href="https://ignoranz-project.web.app/" target="_blank" rel="noopener noreferrer" aria-label="${t("projectSiteAria")}">IGNORANZ PROJECT</a>
    </span>`
  : "<span>© 2026 Babel Breaker</span>";

const footerProjectLinks = SHOW_PROJECT_INFO
  ? `
      <a href="/LICENSE.txt" target="_blank" rel="noopener">MIT</a>
      <a href="https://x.com/IGNORANZ_P" target="_blank" rel="noopener noreferrer" aria-label="${t("xAria")}">X ${icon("external", 15)}</a>
      <a href="https://github.com/IGNORANZ-PROJECT/BabelBreaker" target="_blank" rel="noopener noreferrer">GitHub ${icon("external", 15)}</a>`
  : "";

document.querySelector("#app").innerHTML = `
  <header class="site-header">
    <a class="brand" href="/" aria-label="${t("brandHome")}">
      <img src="/icon-ui.png" width="36" height="36" alt="" />
      <span>Babel Breaker</span>
      <span class="beta">Beta</span>
    </a>
    <nav class="header-nav" aria-label="${t("mainNavigation")}">
      <label class="header-language">
        <span class="sr-only">${t("uiLanguage")}</span>
        <select id="ui-language" aria-label="${t("uiLanguage")}">${uiLanguageOptions}</select>
      </label>
      <a class="header-link" href="#guide">${t("guideLink")}</a>
      ${headerProjectLink}
    </nav>
  </header>

  <main>
    <section class="hero" id="home">
      <div class="eyebrow">${t("eyebrow")}</div>
      <h1>${t("heroTitleBefore")}<br /> <span class="no-wrap">${t("heroTitleAfter")}</span></h1>
      <p class="hero-copy">${t("heroCopy")}</p>

      <div class="language-picker">
        <label for="target-language">
          <span>${t("targetLanguage")}</span>
          <select id="target-language">${targetLanguageOptions}</select>
        </label>
      </div>

      <div class="drop-shell">
        <!-- Safari may disable ZIP-based game formats when accept filters are present. Validation runs after selection instead. -->
        <input id="mod-file" type="file" multiple hidden />
        <button class="drop-zone" id="drop-zone" type="button" data-testid="drop-zone">
          <span class="drop-icon">${icon("upload", 30)}</span>
          <strong>${t("dropTitle")}</strong>
          <span>${t("dropAlternative")}</span>
          <small>${t("dropTypes")}</small>
        </button>
        <div class="drop-footer">
          <span>${icon("lock", 15)} ${t("fileNotUploaded")}</span>
        </div>
      </div>

      <div class="trust-row">
        <span>${icon("shield", 17)} ${t("trustLocal")}</span>
        <span>${icon("check", 17)} ${t("trustImages")}</span>
        <span>${icon("jar", 17)} ${t("trustMinecraft")}</span>
      </div>
      <div class="supported-formats" aria-label="${t("supportedFormats")}">
        <div>
          <strong>${t("javaFormatGroup")}</strong>
          <span>${t("javaFormatList")}</span>
        </div>
        <div>
          <strong>${t("bedrockFormatGroup")}</strong>
          <span>${t("bedrockFormatList")}</span>
        </div>
        <div>
          <strong>${t("factorioFormatGroup")}</strong>
          <span>${t("factorioFormatList")}</span>
        </div>
        <div>
          <strong>${t("stardewFormatGroup")}</strong>
          <span>${t("stardewFormatList")}</span>
        </div>
        <div>
          <strong>${t("rimworldFormatGroup")}</strong>
          <span>${t("rimworldFormatList")}</span>
        </div>
      </div>
      ${projectCallout}
    </section>

    <section class="workspace section-wrap" id="workspace" hidden aria-live="polite">
      <div class="section-heading">
        <div>
          <span class="step-label">${t("translateStep")}</span>
          <h2 id="workspace-title">${t("workspaceTitle", { target: getTargetLanguage(state.targetLanguage).nativeName })}</h2>
        </div>
        <button class="quiet-button" id="reset-button" type="button">${icon("refresh", 17)} ${t("chooseAnother")}</button>
      </div>

      <div id="notice" class="notice" hidden></div>

      <article class="mod-card">
        <div class="mod-mark">${icon("jar", 28)}</div>
        <div class="mod-primary">
          <span class="file-name" id="file-name"></span>
          <h3 id="mod-name"></h3>
          <div class="mod-tags" id="mod-tags"></div>
        </div>
        <div class="mod-stats" id="mod-stats"></div>
      </article>

      <div class="work-grid">
        <div class="translation-panel panel">
          <div class="panel-header">
            <span class="panel-number">01</span>
            <div>
              <h3>${t("methodTitle")}</h3>
              <p>${t("methodCopy")}</p>
            </div>
          </div>

          <div class="mode-list" role="radiogroup" aria-label="${t("methodAria")}">
            <label class="mode-card selected" id="local-mode-card">
              <input type="radio" name="translation-mode" value="local" checked />
              <span class="mode-copy">
                <strong>${t("localName")} <span class="recommended">${t("recommended")}</span></strong>
                <small>${t("localCopy")}</small>
                <span class="availability" id="local-availability">${t("availabilityChecking")}</span>
              </span>
              <span class="radio-dot"></span>
            </label>

            <label class="mode-card" id="clipboard-mode-card">
              <input type="radio" name="translation-mode" value="clipboard" />
              <span class="mode-copy">
                <strong>${t("externalName")}</strong>
                <small>${t("externalCopy")}</small>
              </span>
              <span class="radio-dot"></span>
            </label>
          </div>

          <label class="image-option" for="image-translation-toggle">
            <span class="image-option-control">
              <input id="image-translation-toggle" type="checkbox" />
              <span class="switch" aria-hidden="true"></span>
            </span>
            <span>
              <strong>${t("imageOptionTitle")}</strong>
              <small>${t("imageOptionCopy")}</small>
            </span>
          </label>

          <details class="advanced">
            <summary>${t("advanced")} <span>${t("optional")}</span></summary>
            <div class="advanced-body">
              <div id="minecraft-settings">
                <label for="minecraft-version">${t("minecraftVersion")}</label>
                <select id="minecraft-version"></select>
              </div>
              <label for="glossary">${t("glossary")} <span>${t("glossaryFormat")}</span></label>
              <textarea id="glossary" rows="4" placeholder="Gear=歯車&#10;Steam=蒸気"></textarea>
            </div>
          </details>

          <button class="primary-button" id="start-button" type="button">
            <span id="start-label">${t("startLocal", { target: getTargetLanguage(state.targetLanguage).nativeName })}</span>${icon("arrow", 18)}
          </button>
        </div>

        <aside class="privacy-panel panel">
          <span class="privacy-icon">${icon("shield", 22)}</span>
          <h3>${t("privacyTitle")}</h3>
          <p>${t("privacyCopy")}</p>
          <ul>
            <li>${icon("check", 15)} ${t("noAccount")}</li>
            <li>${icon("check", 15)} ${t("noApiKey")}</li>
            <li>${icon("check", 15)} ${t("noHistory")}</li>
          </ul>
        </aside>
      </div>

      <section class="progress-panel panel" id="progress-panel" hidden>
        <div class="progress-copy">
          <div>
            <span id="progress-kicker">${t("translating")}</span>
            <h3 id="progress-title">${t("translatingTo", { target: getTargetLanguage(state.targetLanguage).nativeName })}</h3>
          </div>
          <strong id="progress-percent">0%</strong>
        </div>
        <div class="progress-track"><span id="progress-bar"></span></div>
        <div class="progress-meta">
          <span id="progress-detail">${t("preparing")}</span>
          <button class="text-button danger" id="cancel-button" type="button">${t("cancel")}</button>
        </div>
      </section>

      <section class="clipboard-panel panel" id="clipboard-panel" hidden>
        <div class="panel-header">
          <span class="panel-number">02</span>
          <div>
            <h3>${t("pasteTitle")}</h3>
            <p id="paste-copy">${t("pasteCopy", { target: getTargetLanguage(state.targetLanguage).nativeName })}</p>
          </div>
        </div>
        <div class="clipboard-actions">
          <div class="clipboard-action-group">
            <button class="secondary-button" id="copy-request-button" type="button">${icon("copy", 17)} ${t("copyRequest")}</button>
            <button class="secondary-button" id="download-source-button" type="button">${icon("download", 17)} ${t("downloadSourceData")}</button>
          </div>
          <span>${icon("arrow", 16)}</span>
          <span>${t("translateElsewhere")}</span>
          <span>${icon("arrow", 16)}</span>
          <span>${t("pasteBelow")}</span>
        </div>
        <div class="translation-input-heading">
          <label for="translation-paste">${t("translatedJson")}</label>
          <input id="translation-file" type="file" accept=".json,.txt,application/json,text/plain" hidden />
          <button class="text-button" id="load-translation-file-button" type="button">${icon("upload", 15)} ${t("loadTranslationFile")}</button>
        </div>
        <textarea id="translation-paste" rows="9" spellcheck="false" placeholder='{"item.example": "Translated item"}'></textarea>
        <button class="primary-button compact" id="apply-translation-button" type="button">${t("applyTranslation")} ${icon("arrow", 17)}</button>
      </section>

      <section class="review-panel panel" id="review-panel" hidden>
        <div class="review-heading">
          <div class="panel-header">
            <span class="panel-number">02</span>
            <div>
              <h3>${t("reviewTitle")}</h3>
              <p id="review-summary"></p>
            </div>
          </div>
        </div>
        <div class="review-content-tabs" role="tablist" aria-label="${t("reviewContentAria")}">
          <button type="button" role="tab" data-review-tab="text" aria-selected="true">${t("reviewTextTab")} <span id="review-text-count">0</span></button>
          <button type="button" role="tab" data-review-tab="images" aria-selected="false" id="review-image-tab" hidden>${t("reviewImageTab")} <span id="review-image-count">0</span></button>
        </div>

        <div class="review-pane" id="review-text-pane">
          <div class="review-actions">
            <button class="secondary-button compact selection-mode-button" id="text-selection-button" type="button">${t("selectItems")}</button>
            <label class="search-box">
              <span class="sr-only">${t("searchAria")}</span>
              <input id="entry-search" type="search" placeholder="${t("searchPlaceholder")}" />
            </label>
            <select id="entry-filter" aria-label="${t("filterAria")}">
              <option value="warning" selected>${t("filterWarning")}</option>
              <option value="pending">${t("filterPending")}</option>
              <option value="translated">${t("filterTranslated")}</option>
              <option value="ignored">${t("filterIgnored")}</option>
              <option value="all">${t("filterAll")}</option>
            </select>
          </div>
          <div class="review-bulk-actions">
            <button class="text-button" id="ignore-ambiguous-button" type="button">${t("ignoreAmbiguous")}</button>
            <button class="text-button" id="ignore-visible-button" type="button">${t("ignoreVisible")}</button>
          </div>
          <div class="entry-list" id="entry-list"></div>
          <button class="quiet-button load-more" id="load-more-button" type="button" hidden>${t("loadMore")}</button>
          <div class="selection-action-bar ambiguous-language-action" id="ambiguous-language-action" hidden>
            <strong id="ambiguous-language-count"></strong>
            <label><span>${t("detectedLanguage")}</span><select id="bulk-source-language" aria-label="${t("detectedLanguage")}">${sourceLanguageOptions}</select></label>
            <label class="selection-toggle"><input id="bulk-translation-toggle" type="checkbox" checked /> ${t("translationEnabled")}</label>
            <button class="secondary-button compact" id="apply-bulk-source-language" type="button">${t("applySelection")}</button>
            <button class="text-button" id="clear-text-selection" type="button">${t("clearSelection")}</button>
          </div>
        </div>

        <section class="image-panel review-pane" id="image-panel" hidden>
          <div class="image-panel-heading">
            <div>
              <h4>${t("imageTranslationTitle")}</h4>
              <p>${t("imageTranslationCopy")}</p>
            </div>
            <div class="image-heading-actions">
              <strong class="image-result-count" id="image-result-count"></strong>
              <button class="secondary-button compact selection-mode-button" id="image-select-button" type="button">${t("selectImages")}</button>
            </div>
          </div>
          <p class="image-local-note">${icon("lock", 14)} ${t("imageLocalOnly")}</p>
          <div class="image-workspace" id="image-workspace">
            <div class="image-results" id="image-results" aria-label="${t("imageResultsAria")}"></div>
            <div class="image-review-bar">
              <div class="image-view-tabs" role="group" aria-label="${t("imageViewAria")}">
                <button type="button" data-image-view="before">${t("imageBefore")}</button>
                <button type="button" data-image-view="after" class="selected">${t("imageAfter")}</button>
                <button type="button" data-image-view="compare">${t("imageCompare")}</button>
              </div>
            </div>
            <div class="image-editor-layout">
              <div>
                <div class="image-preview-shell" id="image-preview-shell">
                  <img id="image-preview-before" alt="" />
                  <div class="image-after-clip" id="image-after-clip"><img id="image-preview" alt="" /></div>
                  <div class="image-region-overlay" id="image-region-overlay"></div>
                  <input class="image-compare-slider" id="image-compare-slider" type="range" min="0" max="100" value="50" aria-label="${t("imageCompareSlider")}" hidden />
                </div>
                <button class="secondary-button image-edit-button" id="image-edit-button" type="button">${t("imageEdit")}</button>
              </div>
              <div>
                <p class="image-status" id="image-status"></p>
                <div class="image-region-list" id="image-region-list"></div>
                <button class="secondary-button image-apply-button" id="apply-image-button" type="button" hidden>${t("imageApplyButton")}</button>
              </div>
            </div>
            <div class="selection-action-bar image-selection-bar" id="image-selection-bar" hidden>
              <strong id="image-selection-count"></strong>
              <label><span>${t("detectedLanguage")}</span><select id="image-selection-language" aria-label="${t("detectedLanguage")}">${sourceLanguageOptions}</select></label>
              <label class="selection-toggle"><input id="image-selection-translation-toggle" type="checkbox" checked /> ${t("translationEnabled")}</label>
              <button type="button" class="secondary-button compact" id="image-selection-language-button">${t("applySelection")}</button>
              <button type="button" class="text-button" id="image-selection-clear-button">${t("clearSelection")}</button>
            </div>
          </div>
        </section>

        <div class="download-row">
          <div class="download-summary">
            <strong id="ready-title">${t("readyTitle")}</strong>
            <span id="ready-copy">${t("readyCopy")}</span>
            <div class="bedrock-output-settings" id="bedrock-output-settings" hidden>
              <label for="bedrock-output-mode">${t("bedrockOutputMode")}</label>
              <select id="bedrock-output-mode">
                <option value="localized">${t("bedrockLocalizedMode")}</option>
                <option value="forced">${t("bedrockForcedMode")}</option>
              </select>
              <small id="bedrock-output-mode-copy">${t("bedrockLocalizedModeCopy")}</small>
              <div class="bedrock-localization-status" id="bedrock-localization-status" role="status"></div>
            </div>
          </div>
          <button class="primary-button download-button" id="download-button" type="button">
            ${icon("download", 18)} <span id="download-label">${t("downloadPack")}</span>
          </button>
        </div>
      </section>
    </section>

    <section class="guide section-wrap" id="guide">
      <div class="guide-tabs" role="tablist" aria-label="${t("supportedGames")}">
        ${Object.values(SUPPORTED_GAMES)
          .map(
            (game, index) =>
              `<button type="button" role="tab" data-guide-game="${game.id}" aria-selected="${index === 0}">${game.name}</button>`,
          )
          .join("")}
      </div>
      <div class="minecraft-guide-tabs" id="minecraft-guide-tabs" role="tablist" aria-label="${t("minecraftGuideFormats")}">
        ${MINECRAFT_GUIDES.map(
          (guide, index) =>
            `<button type="button" role="tab" data-minecraft-guide="${guide.id}" aria-selected="${index === 0}">${t(guide.label)}</button>`,
        ).join("")}
      </div>
      <div class="guide-heading">
        <span class="step-label" id="guide-step">${t("guideStep")}</span>
        <h2 id="guide-title">${t("guideTitle")}</h2>
        <p id="guide-copy">${t("guideCopy")}</p>
      </div>
      <div class="guide-steps">
        <article>
          <span class="guide-number">1</span>
          <h3 id="guide-1-title">${t("guide1Title")}</h3>
          <p id="guide-1-copy">${t("guide1Copy")}</p>
        </article>
        <article>
          <span class="guide-number">2</span>
          <h3 id="guide-2-title">${t("guide2Title")}</h3>
          <p id="guide-2-copy">${t("guide2Copy")}</p>
        </article>
        <article>
          <span class="guide-number">3</span>
          <h3 id="guide-3-title">${t("guide3Title")}</h3>
          <p id="guide-3-copy">${t("guide3Copy")}</p>
        </article>
      </div>
      <details class="troubleshooting" id="minecraft-troubleshooting">
        <summary>${icon("warning", 18)} ${t("troubleshooting")}</summary>
        <div>
          <p>${t("reloadResources").replace("F3 + T", "<kbd>F3</kbd> + <kbd>T</kbd>")}</p>
          <p>${t("troubleshootingCopy")}</p>
        </div>
      </details>
    </section>

    <section class="privacy-disclosure section-wrap" id="privacy">
      <div class="privacy-heading">
        <span class="step-label">${t("privacyOss")}</span>
        <h2>${t("disclosureTitle")}</h2>
        <p>${t("disclosureCopy")}</p>
      </div>
      <div class="privacy-facts">
        <article>
          <h3>${t("fileProcessing")}</h3>
          <p>${t("fileProcessingCopy")}</p>
        </article>
        <article>
          <h3>${t("localTranslation")}</h3>
          <p>${t("localTranslationCopy")}</p>
        </article>
        <article>
          <h3>${t("externalServices")}</h3>
          <p>${t("externalServicesCopy")}</p>
        </article>
      </div>
      ${ossPanel}
      <p class="legal-note">
        ${t("legalNote")}
      </p>
    </section>
  </main>

  <dialog class="download-warning-dialog" id="download-warning-dialog" aria-labelledby="download-warning-title" aria-describedby="download-warning-copy">
    <div class="download-warning-icon">${icon("warning", 22)}</div>
    <div>
      <h2 id="download-warning-title"></h2>
      <p id="download-warning-copy"></p>
    </div>
    <div class="download-warning-actions">
      <button class="primary-button compact" id="download-warning-primary" type="button"></button>
      <button class="secondary-button" id="download-warning-secondary" type="button"></button>
      <button class="text-button" id="download-warning-cancel" type="button">${t("cancel")}</button>
    </div>
  </dialog>

  <footer>
    <a class="brand footer-brand" href="#home"><img src="/icon-ui.png" width="30" height="30" alt="" /> Babel Breaker</a>
    ${footerProjectInfo}
    <nav class="footer-links" aria-label="${t("footerAria")}">
      <a href="#privacy">${t("privacyLink")}</a>
      ${footerProjectLinks}
    </nav>
  </footer>
`;

const elements = Object.fromEntries(
  [
    "mod-file",
    "drop-zone",
    "ui-language",
    "target-language",
    "workspace",
    "workspace-title",
    "notice",
    "reset-button",
    "file-name",
    "mod-name",
    "mod-tags",
    "mod-stats",
    "local-mode-card",
    "clipboard-mode-card",
    "local-availability",
    "minecraft-version",
    "minecraft-settings",
    "glossary",
    "start-button",
    "start-label",
    "progress-panel",
    "progress-kicker",
    "progress-title",
    "progress-percent",
    "progress-bar",
    "progress-detail",
    "cancel-button",
    "clipboard-panel",
    "paste-copy",
    "copy-request-button",
    "download-source-button",
    "translation-file",
    "load-translation-file-button",
    "translation-paste",
    "apply-translation-button",
    "review-panel",
    "review-summary",
    "review-text-pane",
    "review-text-count",
    "review-image-tab",
    "review-image-count",
    "text-selection-button",
    "entry-search",
    "entry-filter",
    "ignore-ambiguous-button",
    "ambiguous-language-action",
    "ambiguous-language-count",
    "bulk-source-language",
    "bulk-translation-toggle",
    "apply-bulk-source-language",
    "clear-text-selection",
    "ignore-visible-button",
    "entry-list",
    "load-more-button",
    "ready-title",
    "ready-copy",
    "download-button",
    "download-label",
    "bedrock-output-settings",
    "bedrock-output-mode",
    "bedrock-output-mode-copy",
    "bedrock-localization-status",
    "image-translation-toggle",
    "image-panel",
    "image-workspace",
    "image-result-count",
    "image-select-button",
    "image-results",
    "image-preview",
    "image-preview-before",
    "image-preview-shell",
    "image-after-clip",
    "image-region-overlay",
    "image-compare-slider",
    "image-edit-button",
    "image-selection-bar",
    "image-selection-count",
    "image-selection-language",
    "image-selection-translation-toggle",
    "image-selection-language-button",
    "image-selection-clear-button",
    "image-status",
    "image-region-list",
    "apply-image-button",
    "download-warning-dialog",
    "download-warning-title",
    "download-warning-copy",
    "download-warning-primary",
    "download-warning-secondary",
    "download-warning-cancel",
    "guide-step",
    "minecraft-guide-tabs",
    "guide-title",
    "guide-copy",
    "guide-1-title",
    "guide-1-copy",
    "guide-2-title",
    "guide-2-copy",
    "guide-3-title",
    "guide-3-copy",
    "minecraft-troubleshooting",
  ].map((id) => [id, document.getElementById(id)]),
);

elements["minecraft-version"].innerHTML = MINECRAFT_VERSIONS.map(
  (version) => `<option value="${version.id}">${version.label}</option>`,
).join("");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function formatBytes(bytes) {
  if (!bytes) return t("demo");
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function artifactLabel(project = state.project) {
  if (!project?.artifactType) return "";
  return t(`artifact_${project.artifactType}`) || SUPPORTED_ARTIFACTS[project.artifactType]?.label || project.artifactType;
}

function showNotice(message, type = "info") {
  elements.notice.className = `notice ${type}`;
  elements.notice.innerHTML = `${type === "error" ? icon("warning", 18) : icon("check", 18)}<span>${escapeHtml(message)}</span>`;
  elements.notice.hidden = false;
}

function localizeError(error) {
  const message = String(error?.message || error || "");
  const mappings = [
    [/対応する \.jar|MODの \.jar/, "errorInvalidFile"],
    [/512MB/, "errorTooLarge"],
    [/アーカイブを開けませんでした/, "errorOpenArchive"],
    [/アーカイブ内のファイル数/, "errorTooManyEntries"],
    [/対応する言語ファイルが見つかりません/, "errorNoLang"],
    [/langファイル.*サイズ|langファイルの合計サイズ/, "errorLangTooLarge"],
    [/読み込めるlangファイル/, "errorNoReadableLang"],
    [/安全でないファイルパス/, "errorUnsafePath"],
    [/JSONとして読み取れません/, "errorClipboardJson"],
    [/一致するキーがありません/, "errorNoMatchingKeys"],
    [/WebAssemblyまたはWeb Worker/, "errorLocalUnsupported"],
    [/未対応の原文言語/, "errorSourceUnsupported"],
    [/翻訳モデル|translation model/i, "errorModel"],
  ];
  const match = mappings.find(([pattern]) => pattern.test(message));
  return match ? t(match[1]) : message;
}

function clearNotice() {
  elements.notice.hidden = true;
}

function setBusy(busy) {
  state.busy = busy;
  elements["start-button"].disabled = busy;
  elements["download-button"].disabled = busy;
  elements["reset-button"].disabled = busy;
  elements["target-language"].disabled = busy;
  elements["bedrock-output-mode"].disabled = busy;
  elements["image-translation-toggle"].disabled = busy || state.mode !== "local" || !state.translatorStatus.supported;
}

function supportsForcedBedrockOutput(project = state.project) {
  return Boolean(
    project &&
    ["bedrock_addon", "bedrock_world"].includes(project.artifactType) &&
    (project.documents || []).some((document) => document.format === "bedrock-lang"),
  );
}

function bedrockLocalizationSummary(project = state.project) {
  const documents = (project?.documents || []).filter(
    (document) => document.format === "bedrock-lang",
  );
  const uncertain = documents.filter(
    (document) => !document.localizationEvidence?.confirmed,
  ).length;
  return { total: documents.length, uncertain, confirmed: documents.length - uncertain };
}

function updateBedrockOutputMode() {
  const supported = supportsForcedBedrockOutput();
  elements["bedrock-output-settings"].hidden = !supported;
  if (!supported) state.bedrockTranslationMode = "localized";
  elements["bedrock-output-mode"].value = state.bedrockTranslationMode;
  elements["bedrock-output-mode-copy"].textContent = t(
    state.bedrockTranslationMode === "forced"
      ? "bedrockForcedModeCopy"
      : "bedrockLocalizedModeCopy",
  );
  const summary = bedrockLocalizationSummary();
  const status = elements["bedrock-localization-status"];
  status.classList.toggle("is-warning", summary.uncertain > 0);
  status.classList.toggle("is-confirmed", summary.total > 0 && summary.uncertain === 0);
  status.textContent = !supported
    ? ""
    : summary.uncertain === 0
      ? t("bedrockLocalizationConfirmed")
      : state.project?.artifactType === "bedrock_world" && summary.total > 1
        ? t("bedrockWorldLocalizationUncertain", summary)
        : t("bedrockLocalizationUncertain");
}

function openDownloadWarning(kind, summary) {
  const dialog = elements["download-warning-dialog"];
  const forced = kind === "forced";
  elements["download-warning-title"].textContent = t(
    forced ? "bedrockCompatibilityWarningTitle" : "bedrockLocalizationWarningTitle",
  );
  elements["download-warning-copy"].textContent = forced
    ? t("bedrockCompatibilityWarningCopy")
    : state.project?.artifactType === "bedrock_world" && summary.total > 1
      ? t("bedrockWorldLocalizationWarningCopy", summary)
      : t("bedrockLocalizationWarningCopy");
  elements["download-warning-primary"].textContent = t(
    forced ? "downloadCompatibilityAfterBackup" : "downloadStandardVersion",
  );
  elements["download-warning-secondary"].textContent = t(
    forced ? "switchToStandardVersion" : "switchToCompatibilityVersion",
  );
  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      resolve(result);
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish("cancel");
    };
    dialog.addEventListener("cancel", onCancel);
    elements["download-warning-primary"].onclick = () => finish("download");
    elements["download-warning-secondary"].onclick = () => finish("switch");
    elements["download-warning-cancel"].onclick = () => finish("cancel");
    dialog.showModal();
  });
}

async function confirmBedrockDownloadMode() {
  if (!supportsForcedBedrockOutput()) return state.bedrockTranslationMode;
  const summary = bedrockLocalizationSummary();
  const forced = state.bedrockTranslationMode === "forced";
  if (!forced && summary.uncertain === 0) return "localized";
  const decision = await openDownloadWarning(forced ? "forced" : "localized", summary);
  if (decision === "download") return state.bedrockTranslationMode;
  if (decision === "switch") {
    state.bedrockTranslationMode = forced ? "localized" : "forced";
    updateBedrockOutputMode();
  }
  return null;
}

function currentTarget() {
  return getTargetLanguage(state.targetLanguage);
}

function pendingUnsupportedSourceLocales() {
  if (!state.project) return [];
  return [
    ...new Set(
      state.project.entries
        .filter(
          (entry) =>
            !entry.translation.trim() &&
            !entry.translationBlocked &&
            !entry.sourceLanguage,
        )
        .map((entry) => entry.sourceLocale || t("unknownLanguage")),
    ),
  ];
}

function languageNeedsReview(entry) {
  if (entry.ignored) return false;
  return (
    entry.translationBlocked ||
    (entry.languageConflict && !entry.languageConfirmed)
  );
}

function sourceLanguageLabel(entry) {
  const effective =
    getSourceLanguage(entry.sourceLanguage)?.nativeName ||
    entry.sourceLocale ||
    t("unknownLanguage");
  const declared =
    getSourceLanguage(entry.declaredSourceLanguage)?.nativeName ||
    entry.sourceLocale ||
    t("unknownLanguage");

  if (entry.translationBlocked) {
    return t("ambiguousLanguageLabel", { declared });
  }
  if (
    entry.languageConflict &&
    entry.detectedSourceLanguage
  ) {
    const detected =
      getSourceLanguage(entry.detectedSourceLanguage)?.nativeName ||
      entry.detectedSourceLanguage;
    return t("detectedLanguageLabel", { detected, declared });
  }
  return effective;
}

function sourceLanguageWarning(entry) {
  if (entry.ignored) return "";
  if (entry.translationBlocked) return t("ambiguousLanguageWarning");
  if (entry.languageConflict && !entry.languageConfirmed) {
    return t("languageConflictWarning");
  }
  return "";
}

function entryKeyLabel(entry) {
  const key = String(entry.key || "");
  const separator = key.indexOf("\u0000");
  if (separator < 0) return key;
  const section = key.slice(0, separator);
  const name = key.slice(separator + 1);
  return section ? `[${section}] ${name}` : name;
}

function sourceLanguageSummary() {
  if (!state.project) return "";
  const sources = [
    ...new Set(
      state.project.namespaces.flatMap((namespace) => {
        const languages = namespace.sourceLanguages?.length
          ? namespace.sourceLanguages
          : [namespace.sourceLanguage].filter(Boolean);
        if (languages.length) {
          return languages.map(
            (language) =>
              getSourceLanguage(language)?.nativeName || language,
          );
        }
        return namespace.sourceLocales?.length
          ? namespace.sourceLocales
          : [namespace.sourceLocale || t("unknownLanguage")];
      }),
    ),
  ];
  const visible = sources.slice(0, 3);
  if (sources.length > visible.length) {
    visible.push(t("moreLanguages", { count: sources.length - visible.length }));
  }
  return visible.join(" + ");
}

function localModelDownloadCopy() {
  if (!state.project) {
    return t("modelsAfterAnalysis");
  }
  const size = estimateLocalModelSizeMb(state.project, state.targetLanguage);
  return size
    ? t("modelsDownload", { size })
    : t("availableNow");
}

function selectMode(mode) {
  state.mode = mode;
  document.querySelector(`input[name="translation-mode"][value="${mode}"]`).checked = true;
  elements["local-mode-card"].classList.toggle("selected", mode === "local");
  elements["clipboard-mode-card"].classList.toggle("selected", mode === "clipboard");
  elements["image-translation-toggle"].disabled = mode !== "local" || !state.translatorStatus.supported;
  if (mode !== "local") {
    elements["image-translation-toggle"].checked = false;
    state.translateImages = false;
  }
  updateStartLabel();
}

function updateStartLabel() {
  const complete = state.project && getProjectStats(state.project).pending === 0;
  elements["start-label"].textContent = complete && !state.translateImages
    ? t("reviewResult")
    : state.mode === "local"
      ? t("startLocal", { target: currentTarget().nativeName })
      : t("prepareData");
}

function updateProjectSummary() {
  if (!state.project) return;
  const stats = getProjectStats(state.project);
  elements["mod-stats"].innerHTML = `
    <span><strong>${stats.total.toLocaleString(numberLocale)}</strong>${t("translationKeys")}</span>
    <span><strong>${stats.pending.toLocaleString(numberLocale)}</strong>${t("untranslated")}</span>
  `;
  updateStartLabel();
}

function renderGameGuide(game = state.guideGame || "minecraft", minecraftMode = state.minecraftGuideMode || "javaMod") {
  state.guideGame = game;
  if (game === "minecraft") state.minecraftGuideMode = minecraftMode;
  const selectedMinecraftGuide = MINECRAFT_GUIDES.find((guide) => guide.id === state.minecraftGuideMode) || MINECRAFT_GUIDES[0];
  const prefix = game === "minecraft" ? selectedMinecraftGuide.prefix : `${game}Guide`;
  for (const [id, suffix] of [
    ["guide-step", "Step"],
    ["guide-title", "Title"],
    ["guide-copy", "Copy"],
    ["guide-1-title", "1Title"],
    ["guide-1-copy", "1Copy"],
    ["guide-2-title", "2Title"],
    ["guide-2-copy", "2Copy"],
    ["guide-3-title", "3Title"],
    ["guide-3-copy", "3Copy"],
  ]) {
    elements[id].textContent = t(`${prefix}${suffix}`);
  }
  document.querySelectorAll("[data-guide-game]").forEach((button) => {
    const selected = button.dataset.guideGame === game;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  elements["minecraft-guide-tabs"].hidden = game !== "minecraft";
  document.querySelectorAll("[data-minecraft-guide]").forEach((button) => {
    const selected = button.dataset.minecraftGuide === state.minecraftGuideMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  elements["minecraft-troubleshooting"].hidden = game !== "minecraft" || !["javaMod", "javaResourcePack"].includes(state.minecraftGuideMode);
}

function outputUiKeys(project) {
  const game = project.game || "minecraft";
  if (project.artifactType) {
    const copy = project.artifactType === "modpack"
      ? "readyModpackCopy"
      : project.artifactType === "resource_pack" && project.edition === "java"
        ? "readyResourcePackCopy"
        : project.artifactType === "server_plugin"
          ? "readyPluginCopy"
          : "readyNativeCopy";
    return {
      title: "readyNativeTitle",
      copy,
      download: "downloadNative",
      success: "downloadNativeSuccess",
    };
  }
  if (game === "minecraft" && project.requiresInstanceInstall) {
    return {
      title: "readyBundleTitle",
      copy: "readyBundleCopy",
      download: "downloadTranslationBundle",
      success: "downloadTranslationBundleSuccess",
    };
  }
  if (project.isBatch && game !== "minecraft") {
    return {
      title: "readyBatchTitle",
      copy: "readyBatchCopy",
      download: "downloadModBundle",
      success: "downloadBatchSuccess",
    };
  }
  if (game === "factorio" || game === "stardew") {
    return {
      title: "readyTranslatedModTitle",
      copy: "readyTranslatedModCopy",
      download: "downloadTranslatedMod",
      success: "downloadTranslatedModSuccess",
    };
  }
  if (game === "rimworld") {
    return {
      title: "readyRimWorldTitle",
      copy: "readyRimWorldCopy",
      download: "downloadTranslationMod",
      success: "downloadTranslationModSuccess",
    };
  }
  return {
    title: "readyTitle",
    copy: "readyCopy",
    download: "downloadPack",
    success: "downloadSuccess",
  };
}

function renderProject({ scroll = true } = {}) {
  if (!state.project) return;
  const { project } = state;
  const stats = getProjectStats(project);
  elements.workspace.hidden = false;
  elements["ui-language"].disabled = true;
  elements["ui-language"].title = t("uiReloadTitle");
  elements["workspace-title"].textContent = t("workspaceTitle", {
    target: currentTarget().nativeName,
  });
  elements["paste-copy"].textContent = t("pasteCopy", {
    target: currentTarget().nativeName,
  });
  elements["file-name"].textContent = project.isBatch
    ? t("batchFileSummary", {
        count: project.fileNames.length,
        size: formatBytes(project.fileSize),
      })
    : `${project.fileName} · ${formatBytes(project.fileSize)}`;
  elements["file-name"].title = project.fileNames?.join("\n") || project.fileName;
  elements["mod-name"].textContent = project.artifactBatch
    ? artifactLabel(project)
    : project.isBatch
      ? t("batchModName", { count: project.mods.length })
      : project.artifactType
      ? artifactLabel(project)
      : project.mod.name;
  elements["mod-tags"].innerHTML = [
    ...new Set(
      [
        project.artifactType
          ? t("detectedArtifact", { format: artifactLabel(project) })
          : SUPPORTED_GAMES[project.game || "minecraft"]?.name,
        project.edition ? `Minecraft ${project.edition === "java" ? "Java" : "Bedrock"}` : "",
        project.artifact?.variant || "",
        project.mod.loader,
        project.mod.version !== "unknown" && project.mod.version !== "batch"
          ? `v${project.mod.version}`
          : "",
        t("languageFileCount", {
          count: stats.namespaces.toLocaleString(numberLocale),
        }),
        project.coverage
          ? t("artifactCoverage", {
              documents: project.coverage.documents.toLocaleString(numberLocale),
              containers: project.coverage.containers.toLocaleString(numberLocale),
            })
          : "",
        project.coverage?.missingReferences
          ? t("missingReferences", {
              count: project.coverage.missingReferences.toLocaleString(numberLocale),
            })
          : "",
        project.coverage?.suppliedLocalMods
          ? t("suppliedLocalMods", {
              count: project.coverage.suppliedLocalMods.toLocaleString(numberLocale),
            })
          : "",
        sourceLanguageSummary()
          ? t("detectedLanguageRoute", {
              source: sourceLanguageSummary(),
              target: currentTarget().nativeName,
            })
          : "",
        ...(project.artifactType
          ? []
          : (project.contentKinds || []).map(
              (kind) => CONTENT_KIND_LABELS[kind] || kind,
            )),
      ].filter(Boolean),
    ),
  ]
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  updateProjectSummary();
  const isMinecraft = (project.game || "minecraft") === "minecraft";
  const usesJavaPackVersion = isMinecraft && project.edition !== "bedrock" && project.artifactType !== "server_plugin";
  elements["minecraft-settings"].hidden = !usesJavaPackVersion;
  if (usesJavaPackVersion) elements["minecraft-version"].value = project.minecraftVersion;
  const outputCopy = outputUiKeys(project);
  elements["ready-title"].textContent = t(outputCopy.title);
  elements["ready-copy"].textContent = t(outputCopy.copy);
  elements["download-label"].textContent = t(outputCopy.download);
  updateBedrockOutputMode();
  elements["start-button"].disabled = stats.total === 0;
  elements["download-button"].disabled = stats.total === 0;
  const selectedGuide = selectGuideForProject(project);
  renderGameGuide(selectedGuide.game, selectedGuide.minecraftMode);
  elements["review-panel"].hidden = true;
  elements["clipboard-panel"].hidden = true;
  elements["progress-panel"].hidden = true;
  updateAvailability();
  const unsupportedLocales = pendingUnsupportedSourceLocales();
  if (stats.total === 0) {
    showNotice(t("noTranslatableContent"), "warning");
  } else if (unsupportedLocales.length) {
    showNotice(
      t("localUnsupportedSource", { locales: unsupportedLocales.join(", ") }),
      "warning",
    );
  } else if (project.warnings.length) {
    showNotice(
      project.isBatch
        ? t("batchWarnings", { count: project.warnings.length })
        : t("skippedFiles", { count: project.warnings.length }),
      "warning",
    );
  } else {
    clearNotice();
  }
  if (scroll) {
    requestAnimationFrame(() =>
      elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
}

function filteredEntries() {
  if (!state.project) return [];
  const query = state.search.toLocaleLowerCase(uiLocale);
  const workflowOrder = {
    pending: 0,
    error: 1,
    ambiguous: 2,
    review: 3,
    complete: 4,
    ignored: 5,
    excluded: 6,
  };
  return state.project.entries
    .filter((entry) => {
      const workflowState = getEntryWorkflowState(entry);
      if (
        state.filter === "warning" &&
        !["pending", "error", "ambiguous", "review"].includes(workflowState)
      ) {
        return false;
      }
      if (state.filter === "pending" && workflowState !== "pending") return false;
      if (
        state.filter === "translated" &&
        !["review", "complete"].includes(workflowState)
      ) {
        return false;
      }
      if (state.filter === "ignored" && workflowState !== "ignored") return false;
      if (!query) return true;
      return [entry.key, entry.source, entry.translation].some((value) =>
        value.toLocaleLowerCase(uiLocale).includes(query),
      );
    })
    .sort(
      (left, right) =>
        workflowOrder[getEntryWorkflowState(left)] -
        workflowOrder[getEntryWorkflowState(right)],
    );
}

function workflowStateLabel(entry) {
  return t(`status_${getEntryWorkflowState(entry)}`);
}

function updateReviewChrome(stats = getProjectStats(state.project)) {
  elements["review-summary"].textContent = t("reviewSummary", {
    review: stats.needsReview.toLocaleString(numberLocale),
    pending: stats.pending.toLocaleString(numberLocale),
    errors: stats.errors.toLocaleString(numberLocale),
    ambiguous: stats.ambiguous.toLocaleString(numberLocale),
  });
  elements["download-button"].disabled = state.busy;
  const outputCopy = outputUiKeys(state.project);
  elements["ready-title"].textContent = t(outputCopy.title);
  elements["ready-copy"].textContent = `${t(outputCopy.copy)} · ${t("downloadSummary", {
    output: stats.output.toLocaleString(numberLocale),
    omitted: stats.omitted.toLocaleString(numberLocale),
    ignored: stats.ignored.toLocaleString(numberLocale),
  })}`;
  elements["ignore-ambiguous-button"].disabled = stats.ambiguous === 0;
  const selectedCount = state.selectedEntryIds.size;
  elements["ambiguous-language-action"].hidden = selectedCount === 0;
  elements["ambiguous-language-count"].textContent = t("selectedTextCount", {
    count: selectedCount.toLocaleString(numberLocale),
  });
  elements["review-text-count"].textContent = stats.needsReview.toLocaleString(numberLocale);
  elements["review-image-count"].textContent = state.imageCandidates.length.toLocaleString(numberLocale);
  elements["review-image-tab"].hidden = state.imageCandidates.length === 0;
}

function renderEntries() {
  if (!state.project) return;
  const stats = getProjectStats(state.project);
  const entries = filteredEntries();
  const visible = entries.slice(0, state.visibleEntries);
  elements["entry-list"].innerHTML = visible.length
    ? visible
        .map(
          (entry) => {
            const workflowState = getEntryWorkflowState(entry);
            const locked = ["ignored", "excluded"].includes(workflowState);
            const selectable = workflowState !== "excluded";
            const keyLabel = entryKeyLabel(entry);
            return `
            <article class="entry-row ${entry.warning || languageNeedsReview(entry) ? "has-warning" : ""} ${workflowState === "ignored" ? "is-ignored" : ""} ${state.selectedEntryIds.has(entry.id) ? "is-selected" : ""}" data-entry-id="${entry.id}">
              <div class="entry-key">
                <div class="entry-meta">
                  ${state.textSelectionMode && selectable ? `<label class="entry-language-select"><input type="checkbox" data-language-entry-id="${entry.id}" ${state.selectedEntryIds.has(entry.id) ? "checked" : ""} /> ${t("selectForLanguage")}</label>` : ""}
                  <span>${escapeHtml(entry.modName ? `${entry.modName} · ${entry.namespace}` : entry.namespace)}</span>
                  <span class="status-pill status-${workflowState}">${escapeHtml(workflowStateLabel(entry))}</span>
                </div>
                <code title="${escapeHtml(keyLabel)}">${escapeHtml(keyLabel)}</code>
                ${workflowState !== "excluded" ? `<button class="entry-ignore-button" type="button" data-ignore-id="${entry.id}">${t(workflowState === "ignored" ? "restoreEntry" : "ignoreEntry")}</button>` : ""}
              </div>
              <div class="entry-source">
                <div class="entry-source-heading">
                  <small>${t("source")} · ${escapeHtml(sourceLanguageLabel(entry))}</small>
                </div>
                <p>${escapeHtml(entry.source)}</p>
                ${sourceLanguageWarning(entry) ? `<span class="entry-warning language-warning">${icon("warning", 14)} ${escapeHtml(sourceLanguageWarning(entry))}</span>` : ""}
              </div>
              <span class="entry-arrow">${icon("arrow", 16)}</span>
              <label class="entry-translation">
                <span class="sr-only">${escapeHtml(t("translationAria", { key: keyLabel, target: currentTarget().nativeName }))}</span>
                <small>${escapeHtml(t("translation", { target: currentTarget().nativeName }))} ${entry.status === "preserved" ? `· ${t("existing")}` : entry.status === "translated" ? `· ${t("filterWarning")}` : ""}</small>
                <textarea rows="${entry.translation.length > 70 || entry.source.length > 70 ? 3 : 1}" data-translation-id="${entry.id}" spellcheck="false" ${locked ? "disabled" : ""}>${escapeHtml(entry.translation)}</textarea>
                ${entry.warning ? `<span class="entry-warning translation-warning">${icon("warning", 14)} ${escapeHtml(entry.warning)}</span>` : ""}
              </label>
            </article>
          `;
          },
        )
        .join("")
    : `<div class="empty-state">${state.filter === "warning" ? t("noReviewItems") : t("emptyResults")}</div>`;
  elements["load-more-button"].hidden = visible.length >= entries.length;
  updateReviewChrome(stats);
}

function showReview() {
  elements["review-panel"].hidden = false;
  state.filter = "warning";
  elements["entry-filter"].value = "warning";
  state.visibleEntries = 100;
  updateProjectSummary();
  renderEntries();
  renderReviewTab();
  elements["review-panel"].scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderReviewTab() {
  if (state.reviewTab === "images" && !state.imageCandidates.length) state.reviewTab = "text";
  elements["review-text-pane"].hidden = state.reviewTab !== "text";
  elements["image-panel"].hidden = state.reviewTab !== "images" || !state.imageCandidates.length;
  document.querySelectorAll("[data-review-tab]").forEach((button) => {
    const selected = button.dataset.reviewTab === state.reviewTab;
    button.setAttribute("aria-selected", String(selected));
    button.classList.toggle("selected", selected);
  });
}

function selectedImageCandidate() {
  return state.imageCandidates.find((candidate) => candidate.id === state.selectedImageId) || null;
}

async function showSelectedImage() {
  const candidate = selectedImageCandidate();
  if (!candidate) return;
  const { candidatePreviewUrl } = await import("./image-editor.js");
  candidate.originalPreviewUrl ||= await candidatePreviewUrl({ ...candidate, previewUrl: "" });
  const translatedPreviewUrl = await candidatePreviewUrl(candidate);
  elements["image-preview-before"].src = candidate.originalPreviewUrl;
  elements["image-preview"].src = candidate.excluded ? candidate.originalPreviewUrl : translatedPreviewUrl;
  elements["image-preview"].alt = candidate.name;
  elements["image-preview-before"].alt = candidate.name;
  elements["image-preview-shell"].style.aspectRatio = `${candidate.width} / ${candidate.height}`;
  elements["image-results"].querySelectorAll("[data-image-id]").forEach((button) => {
    button.classList.toggle("current", button.dataset.imageId === candidate.id);
  });
  updateImageView();
  renderImageOverlay();
  renderImageRegions();
}

function updateImageView() {
  const compare = state.imageView === "compare";
  const amount = state.imageView === "before"
    ? 0
    : state.imageView === "after"
      ? 100
      : Number(elements["image-compare-slider"].value);
  elements["image-after-clip"].style.setProperty("--image-reveal", `${amount}%`);
  elements["image-compare-slider"].hidden = !compare;
  document.querySelectorAll("[data-image-view]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.imageView === state.imageView);
  });
}

function renderImageOverlay() {
  const candidate = selectedImageCandidate();
  const regions = state.imageRegions.get(state.selectedImageId) || [];
  elements["image-region-overlay"].hidden = !state.imageEditing;
  elements["image-region-overlay"].innerHTML = candidate ? regions.map((region) => {
    const selected = state.selectedRegionIds.has(region.id);
    return `<button type="button" class="image-region-box ${selected ? "selected" : ""} ${region.enabled ? "" : "disabled"} ${region.confidence < 45 ? "uncertain" : ""}" data-overlay-region="${escapeHtml(region.id)}" style="left:${region.x / candidate.width * 100}%;top:${region.y / candidate.height * 100}%;width:${region.width / candidate.width * 100}%;height:${region.height / candidate.height * 100}%;transform:rotate(${Number(region.angle || 0)}deg)" aria-pressed="${selected}">
      ${region.confidence < 45 ? `<span class="image-region-question">?</span>` : ""}
      <span class="image-region-resize" data-overlay-handle="resize"></span>
      <span class="image-region-rotate" data-overlay-handle="rotate"></span>
    </button>`;
  }).join("") : "";
  updateImageSelectionBar();
}

function updateImageSelectionBar() {
  const count = state.selectedImageIds.size;
  elements["image-selection-bar"].hidden = !state.imageSelectionMode || count === 0;
  elements["image-selection-count"].textContent = t("selectedImages", { count });
}

function renderImageRegions() {
  const regions = state.imageRegions.get(state.selectedImageId) || [];
  const visible = state.imageEditing
    ? regions.filter((region) => state.selectedRegionIds.has(region.id))
    : [];
  elements["image-region-list"].innerHTML = visible.map((region) => `
    <article class="image-region-row" data-image-region="${escapeHtml(region.id)}">
      <div class="image-region-heading">
        <span>${t("imageOriginal")}</span>
        <span>${Math.round(region.confidence)}%</span>
      </div>
      <label>${t("imageOriginal")}
        <textarea rows="2" data-region-field="text">${escapeHtml(region.text)}</textarea>
      </label>
      <label>${t("imageTranslation")}
        <textarea rows="2" data-region-field="translation">${escapeHtml(region.translation)}</textarea>
      </label>
    </article>
  `).join("");
  elements["apply-image-button"].hidden = !state.imageEditing || !visible.length;
}

async function renderImageResultTabs() {
  const { candidatePreviewUrl } = await import("./image-editor.js");
  elements["image-results"].innerHTML = "";
  for (const candidate of state.imageCandidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `image-result-card ${candidate.id === state.selectedImageId ? "current" : ""} ${state.selectedImageIds.has(candidate.id) ? "selected" : ""}`;
    button.dataset.imageId = candidate.id;
    button.setAttribute("aria-pressed", String(state.selectedImageIds.has(candidate.id)));
    const preview = await candidatePreviewUrl(candidate);
    button.innerHTML = `${state.imageSelectionMode ? `<span class="image-card-check" aria-hidden="true">${state.selectedImageIds.has(candidate.id) ? icon("check", 12) : ""}</span>` : ""}<img src="${preview}" alt="" /><span><strong>${escapeHtml(candidate.name)}</strong><small>${candidate.excluded ? t("imageExcluded") : t("imageTextAreas", { count: (state.imageRegions.get(candidate.id) || []).length })}</small></span>`;
    elements["image-results"].append(button);
  }
  elements["image-result-count"].textContent = t("imageOutputCount", {
    included: state.imageCandidates.filter((candidate) => !candidate.excluded).length,
    total: state.imageCandidates.length,
  });
  updateImageSelectionBar();
}

function imageTemporaryProject(detected) {
  const detectedSource = state.project.sourceLanguages?.[0] || "en";
  return {
    targetLanguage: state.targetLanguage,
    namespaces: [],
    entries: detected.flatMap(({ candidate, regions }) => regions.map((region) => ({
      id: `${candidate.id}::${region.id}`,
      key: region.id,
      source: region.text,
      sourceLanguage: detectedSource,
      sourceLocale: detectedSource,
      translation: "",
      status: "pending",
      ignored: false,
      warning: "",
      translationBlocked: false,
    }))),
  };
}

async function setSelectedEntryLanguage() {
  if (!state.project) return;
  const selected = state.project.entries.filter((entry) => state.selectedEntryIds.has(entry.id));
  if (!selected.length) return;
  const sourceLanguage = elements["bulk-source-language"].value;
  const translationEnabled = elements["bulk-translation-toggle"].checked;
  const applyButton = elements["apply-bulk-source-language"];
  const scrollPosition = window.scrollY;
  if (!translationEnabled) {
    for (const entry of selected) entry.ignored = true;
    state.selectedEntryIds.clear();
    renderEntries();
    updateProjectSummary();
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
    return;
  }
  const temporaryProject = {
    targetLanguage: state.targetLanguage,
    namespaces: [],
    entries: selected.map((entry) => ({
      ...entry,
      ignored: false,
      sourceLanguage,
      declaredSourceLanguage: sourceLanguage,
      detectedSourceLanguage: null,
      languageConfirmed: true,
      languageConflict: false,
      languageConfidence: "manual",
      translationBlocked: false,
      translation: "",
      warning: "",
      status: "pending",
    })),
  };
  setBusy(true);
  applyButton.disabled = true;
  applyButton.textContent = t("applyingSelection");
  try {
    await translateProject(temporaryProject, { glossaryText: elements.glossary.value });
    const translated = new Map(temporaryProject.entries.map((entry) => [entry.id, entry]));
    for (const entry of selected) Object.assign(entry, translated.get(entry.id));
    const failures = temporaryProject.entries.filter((entry) => entry.warning).length;
    state.selectedEntryIds.clear();
    renderEntries();
    updateProjectSummary();
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
    showNotice(
      failures ? t("translationFailures", { count: failures }) : t("translationComplete"),
      failures ? "warning" : "success",
    );
  } catch (error) {
    showNotice(localizeError(error), "error");
  } finally {
    applyButton.disabled = false;
    applyButton.textContent = t("applySelection");
    setBusy(false);
  }
}

async function processProjectImages() {
  if (!state.translateImages || !state.project) return;
  const { candidatePreviewUrl, createImageRecognizer, ocrLanguagesForProject, renderTranslatedImage } = await import("./image-editor.js");
  const candidates = await scanImagesInBackground(state.project);
  if (!candidates.length) return;
  const detected = [];
  let currentIndex = 0;
  const recognizer = await createImageRecognizer({
    languages: ocrLanguagesForProject(state.project),
    onProgress({ percent }) {
      const overall = Math.round(((currentIndex + percent / 100) / candidates.length) * 70);
      elements["progress-percent"].textContent = `${overall}%`;
      elements["progress-bar"].style.width = `${overall}%`;
    },
  });
  try {
    for (const candidate of candidates) {
      if (state.abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
      elements["progress-detail"].textContent = t("imageAnalyzingProgress", {
        current: currentIndex + 1,
        total: candidates.length,
      });
      const regions = await recognizer.recognize(candidate);
      if (regions.length) detected.push({ candidate, regions });
      currentIndex += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await recognizer.terminate();
  }
  if (!detected.length) {
    elements["image-panel"].hidden = true;
    return;
  }
  const temporaryProject = imageTemporaryProject(detected);
  await translateProject(temporaryProject, {
    glossaryText: elements.glossary.value,
    signal: state.abortController?.signal,
    onProgress({ percent }) {
      const overall = Math.round(70 + percent * 0.2);
      elements["progress-percent"].textContent = `${overall}%`;
      elements["progress-bar"].style.width = `${overall}%`;
      elements["progress-detail"].textContent = t("imageTranslatingProgress");
    },
  });
  const translations = new Map(temporaryProject.entries.map((entry) => [entry.id, entry.translation]));
  state.imageCandidates = detected.map(({ candidate }) => candidate);
  state.imageRegions = new Map();
  state.project.imageReplacements = [];
  for (const [index, { candidate, regions }] of detected.entries()) {
    for (const region of regions) region.translation = translations.get(`${candidate.id}::${region.id}`) || "";
    state.imageRegions.set(candidate.id, regions);
    const bytes = await renderTranslatedImage(candidate, regions);
    candidate.renderedBytes = bytes;
    candidate.excluded = false;
    candidate.previewUrl = await candidatePreviewUrl({ ...candidate, bytes, previewUrl: "" });
    state.project.imageReplacements.push({
      containerId: candidate.containerId,
      path: candidate.path,
      bytes,
      ...(Number.isInteger(candidate.sourceProjectIndex) ? { sourceProjectIndex: candidate.sourceProjectIndex } : {}),
    });
    const overall = Math.round(90 + ((index + 1) / detected.length) * 10);
    elements["progress-percent"].textContent = `${overall}%`;
    elements["progress-bar"].style.width = `${overall}%`;
  }
  state.selectedImageId = state.imageCandidates[0]?.id || "";
  elements["image-result-count"].textContent = t("imageResultCount", { count: detected.length });
  elements["image-status"].textContent = t("imageAutoApplied");
  elements["image-panel"].hidden = false;
  await renderImageResultTabs();
  await showSelectedImage();
}

async function applySelectedImage() {
  const candidate = selectedImageCandidate();
  const regions = state.imageRegions.get(candidate?.id) || [];
  if (!candidate || !regions.length) return;
  setBusy(true);
  try {
    const { renderTranslatedImage } = await import("./image-editor.js");
    const bytes = await renderTranslatedImage(candidate, regions);
    candidate.renderedBytes = bytes;
    const replacement = {
      containerId: candidate.containerId,
      path: candidate.path,
      bytes,
      ...(Number.isInteger(candidate.sourceProjectIndex)
        ? { sourceProjectIndex: candidate.sourceProjectIndex }
        : {}),
    };
    state.project.imageReplacements = [
      ...(state.project.imageReplacements || []).filter((item) => !(
        item.containerId === replacement.containerId
        && item.path === replacement.path
        && item.sourceProjectIndex === replacement.sourceProjectIndex
      )),
      ...(!candidate.excluded ? [replacement] : []),
    ];
    const { candidatePreviewUrl } = await import("./image-editor.js");
    candidate.previewUrl = await candidatePreviewUrl({ ...candidate, bytes, previewUrl: "" });
    await showSelectedImage();
    elements["image-status"].textContent = t("imageApplied");
    showNotice(t("imageApplied"), "success");
  } catch (error) {
    showNotice(localizeError(error), "error");
  } finally {
    setBusy(false);
  }
}

function replacementMatchesCandidate(replacement, candidate) {
  return replacement.containerId === candidate.containerId
    && replacement.path === candidate.path
    && replacement.sourceProjectIndex === candidate.sourceProjectIndex;
}

function setCandidateOutput(candidate, included) {
  candidate.excluded = !included;
  state.project.imageReplacements = (state.project.imageReplacements || [])
    .filter((replacement) => !replacementMatchesCandidate(replacement, candidate));
  if (included && candidate.renderedBytes) {
    state.project.imageReplacements.push({
      containerId: candidate.containerId,
      path: candidate.path,
      bytes: candidate.renderedBytes,
      ...(Number.isInteger(candidate.sourceProjectIndex) ? { sourceProjectIndex: candidate.sourceProjectIndex } : {}),
    });
  }
}

async function applySelectedImageSettings() {
  const candidates = state.imageCandidates.filter((candidate) => state.selectedImageIds.has(candidate.id));
  if (!candidates.length) return;
  const sourceLanguage = elements["image-selection-language"].value;
  const translationEnabled = elements["image-selection-translation-toggle"].checked;
  if (!translationEnabled) {
    for (const candidate of candidates) setCandidateOutput(candidate, false);
    state.selectedImageIds.clear();
    state.imageSelectionMode = false;
    elements["image-select-button"].textContent = t("selectImages");
    await renderImageResultTabs();
    await showSelectedImage();
    updateReviewChrome();
    return;
  }
  setBusy(true);
  try {
    const { candidatePreviewUrl, createImageRecognizer, cropImageCandidate, ocrLanguageFor, renderTranslatedImage } = await import("./image-editor.js");
    const recognizer = await createImageRecognizer({ languages: [ocrLanguageFor(sourceLanguage)] });
    try {
      for (const candidate of candidates) {
        for (const region of state.imageRegions.get(candidate.id) || []) {
          const crop = await cropImageCandidate(candidate, region);
          const recognized = await recognizer.recognize(crop);
          const text = recognized.map((item) => item.text).join(" ").trim();
          if (text) region.text = text;
        }
      }
    } finally {
      await recognizer.terminate();
    }
    const selectedRegions = candidates.flatMap((candidate) =>
      (state.imageRegions.get(candidate.id) || []).map((region) => ({ candidate, region })),
    );
    const temporaryProject = {
      targetLanguage: state.targetLanguage,
      namespaces: [],
      entries: selectedRegions.map(({ candidate, region }) => ({
        id: `${candidate.id}::${region.id}`,
        key: region.id,
        source: region.text,
        sourceLanguage,
        declaredSourceLanguage: sourceLanguage,
        translation: "",
        status: "pending",
        ignored: false,
        warning: "",
        translationBlocked: false,
        languageConfirmed: true,
      })),
    };
    await translateProject(temporaryProject, { glossaryText: elements.glossary.value });
    const translated = new Map(temporaryProject.entries.map((entry) => [entry.id, entry.translation]));
    for (const { candidate, region } of selectedRegions) {
      region.sourceLanguage = sourceLanguage;
      region.translation = translated.get(`${candidate.id}::${region.id}`) || region.translation;
      region.confidence = Math.max(70, region.confidence);
      region.enabled = true;
    }
    for (const candidate of candidates) {
      const bytes = await renderTranslatedImage(candidate, state.imageRegions.get(candidate.id) || []);
      candidate.renderedBytes = bytes;
      candidate.previewUrl = await candidatePreviewUrl({ ...candidate, bytes, previewUrl: "" });
      setCandidateOutput(candidate, true);
    }
    state.selectedImageIds.clear();
    state.imageSelectionMode = false;
    elements["image-select-button"].textContent = t("selectImages");
    await renderImageResultTabs();
    await showSelectedImage();
    renderImageOverlay();
    renderImageRegions();
  } catch (error) {
    showNotice(localizeError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function loadFiles(fileList, { scroll = true } = {}) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (files.length > MAX_BATCH_FILES) {
    showNotice(t("tooManyMods", { count: MAX_BATCH_FILES }), "error");
    return;
  }
  if (
    files.reduce((total, file) => total + Number(file.size || 0), 0) >
    MAX_BATCH_BYTES
  ) {
    showNotice(t("batchTooLarge"), "error");
    return;
  }
  state.sourceFiles = files;
  state.bedrockTranslationMode = "localized";
  state.imageCandidates = [];
  state.imageRegions = new Map();
  state.selectedImageId = "";
  state.imageEditing = false;
  state.imageView = "after";
  state.selectedRegionIds.clear();
  state.imageSelectionMode = false;
  state.selectedImageIds.clear();
  state.textSelectionMode = false;
  state.selectedEntryIds.clear();
  state.reviewTab = "text";
  clearNotice();
  elements["drop-zone"].classList.add("loading");
  elements["drop-zone"].querySelector("strong").textContent = t("analyzing");
  try {
    const projects = [];
    const failures = [];
    for (const [index, file] of files.entries()) {
      elements["drop-zone"].querySelector("strong").textContent =
        files.length > 1
          ? t("analyzingBatch", { current: index + 1, total: files.length })
          : t("analyzing");
      try {
        projects.push(
          await analyzeArchiveInBackground(file, {
            targetLanguage: state.targetLanguage,
            targetLocale: currentTarget().minecraftLocale,
          }, {
            onProgress({ percent }) {
              elements["drop-zone"].querySelector("strong").textContent =
                files.length > 1
                  ? t("analyzingBatch", { current: index + 1, total: files.length })
                  : `${t("analyzing")} ${percent}%`;
            },
          }),
        );
      } catch (error) {
        failures.push(`${file.name}: ${localizeError(error)}`);
      }
    }
    if (!projects.length) {
      throw new Error(failures[0] || t("errorNoReadableLang"));
    }
    state.project = combineProjects(projects);
    state.project.warnings.push(...failures);
    state.imageCandidates = [];
    state.imageRegions = new Map();
    state.selectedImageId = "";
    elements["image-panel"].hidden = true;
    elements["image-edit-button"].textContent = t("imageEdit");
    renderProject({ scroll });
  } catch (error) {
    showNotice(localizeError(error), "error");
    elements.workspace.hidden = false;
    elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    elements["drop-zone"].classList.remove("loading");
    elements["drop-zone"].querySelector("strong").textContent = t("dropTitle");
    elements["mod-file"].value = "";
  }
}

async function startLocalTranslation() {
  const stats = getProjectStats(state.project);
  if (!stats.pending && !state.translateImages) {
    showReview();
    return;
  }
  setBusy(true);
  clearNotice();
  elements["clipboard-panel"].hidden = true;
  elements["review-panel"].hidden = true;
  elements["progress-panel"].hidden = false;
  elements["progress-kicker"].textContent = t("translating");
  elements["progress-title"].textContent = t("translatingTo", {
    target: currentTarget().nativeName,
  });
  elements["progress-percent"].textContent = "0%";
  elements["progress-bar"].style.width = "0%";
  elements["progress-detail"].textContent = t("enginePreparing");
  state.abortController = new AbortController();

  try {
    if (stats.pending) await translateProject(state.project, {
      glossaryText: elements.glossary.value,
      signal: state.abortController.signal,
      onDownloadProgress(percent) {
        const overallPercent = Math.round(percent * 0.35);
        elements["progress-kicker"].textContent = t("modelPreparing");
        elements["progress-percent"].textContent = `${overallPercent}%`;
        elements["progress-bar"].style.width = `${overallPercent}%`;
        elements["progress-detail"].textContent = t("modelDetail", {
          target: currentTarget().nativeName,
          percent,
        });
      },
      onProgress({ completed, total, percent, entry }) {
        const overallPercent = Math.round(35 + percent * 0.65);
        elements["progress-kicker"].textContent = t("translating");
        elements["progress-percent"].textContent = `${overallPercent}%`;
        elements["progress-bar"].style.width = `${overallPercent}%`;
        elements["progress-detail"].textContent = `${completed.toLocaleString(numberLocale)} / ${total.toLocaleString(numberLocale)} · ${entry.key}`;
      },
    });
    if (state.translateImages) {
      elements["progress-kicker"].textContent = t("imageTranslationTitle");
      elements["progress-title"].textContent = t("imageAutomaticTitle");
      elements["progress-percent"].textContent = "0%";
      elements["progress-bar"].style.width = "0%";
      elements["progress-detail"].textContent = t("imageScanProgress");
      await processProjectImages();
    }
    const result = getProjectStats(state.project);
    elements["progress-panel"].hidden = true;
    if (result.warnings) {
      showNotice(t("translationFailures", { count: result.warnings }), "warning");
    } else {
      showNotice(t("translationComplete"), "success");
    }
    showReview();
  } catch (error) {
    elements["progress-panel"].hidden = true;
    if (error.name === "AbortError") {
      showNotice(t("translationCancelled"), "warning");
      showReview();
    } else {
      showNotice(localizeError(error), "error");
    }
  } finally {
    state.abortController = null;
    setBusy(false);
  }
}

function openClipboardFlow() {
  elements["review-panel"].hidden = true;
  elements["progress-panel"].hidden = true;
  elements["clipboard-panel"].hidden = false;
  elements["clipboard-panel"].scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadTextFile(contents, filename, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function translationDataFilename() {
  return `${sanitizeFileName(state.project.mod.name)}_${state.project.targetLocale}_source.json`;
}

async function copyTranslationRequest() {
  const target = currentTarget();
  const prompt = buildTranslationRequest(state.project);
  try {
    await navigator.clipboard.writeText(prompt);
    showNotice(t("copySuccess"), "success");
  } catch {
    downloadTextFile(
      prompt,
      `babel-breaker-translation-request-${target.id}.txt`,
      "text/plain;charset=utf-8",
    );
    showNotice(t("copyFallback"), "warning");
  }
}

function downloadTranslationData() {
  const filename = translationDataFilename();
  downloadTextFile(
    `${buildClipboardPayload(state.project)}\n`,
    filename,
    "application/json;charset=utf-8",
  );
  showNotice(t("sourceDataDownloaded", { filename }), "success");
}

async function loadTranslationFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_LANG_TEXT_LENGTH) {
      throw new Error(t("translationFileTooLarge"));
    }
    elements["translation-paste"].value = await file.text();
    applyPastedTranslation({ loadedFileName: file.name });
  } catch (error) {
    showNotice(localizeError(error), "error");
  } finally {
    elements["translation-file"].value = "";
    elements["translation-paste"].classList.remove("dragging");
  }
}

function applyPastedTranslation({ loadedFileName = "" } = {}) {
  try {
    const result = applyClipboardTranslation(state.project, elements["translation-paste"].value);
    const resultMessage = result.rejected
      ? t("appliedWithRejected", {
          applied: result.applied,
          rejected: result.rejected,
        })
      : t("applied", { count: result.applied });
    const message = loadedFileName
      ? `${t("translationFileLoaded", { filename: loadedFileName })} ${resultMessage}`
      : resultMessage;
    showNotice(message, result.rejected ? "warning" : "success");
    showReview();
    return result;
  } catch (error) {
    showNotice(localizeError(error), "error");
    return null;
  }
}

async function downloadPack() {
  const confirmedMode = await confirmBedrockDownloadMode();
  if (!confirmedMode) return;
  setBusy(true);
  clearNotice();
  try {
    if ((state.project.game || "minecraft") === "minecraft" && state.project.edition !== "bedrock") {
      state.project.minecraftVersion = elements["minecraft-version"].value;
    }
    const { archive, filename } = await buildArchiveInBackground(
      state.project,
      state.project.minecraftVersion,
      { bedrockTranslationMode: confirmedMode },
      {
        onProgress({ percent }) {
          elements["download-label"].textContent = `${t("preparing")} ${percent}%`;
        },
      },
    );
    const url = URL.createObjectURL(archive);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showNotice(
      t(outputUiKeys(state.project).success, { filename }),
      "success",
    );
    document.querySelector("#guide").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showNotice(localizeError(error), "error");
  } finally {
    setBusy(false);
    elements["download-label"].textContent = t(outputUiKeys(state.project).download);
    renderEntries();
  }
}

function resetWorkspace() {
  if (state.busy) return;
  state.project = null;
  state.sourceFiles = [];
  state.filter = "warning";
  state.search = "";
  state.bedrockTranslationMode = "localized";
  state.imageEditing = false;
  state.imageView = "after";
  state.selectedRegionIds.clear();
  state.imageSelectionMode = false;
  state.selectedImageIds.clear();
  state.textSelectionMode = false;
  state.selectedEntryIds.clear();
  state.reviewTab = "text";
  elements.workspace.hidden = true;
  elements["ui-language"].disabled = false;
  elements["ui-language"].removeAttribute("title");
  elements["translation-paste"].value = "";
  elements["translation-file"].value = "";
  elements["image-panel"].hidden = true;
  elements["image-region-list"].innerHTML = "";
  elements["image-edit-button"].textContent = t("imageEdit");
  clearNotice();
  if (state.translatorStatus.supported) selectMode("local");
  elements["minecraft-settings"].hidden = false;
  elements["download-label"].textContent = t("downloadPack");
  renderGameGuide("minecraft", "javaMod");
  updateAvailability();
  document.querySelector("#home").scrollIntoView({ behavior: "smooth" });
}

elements["drop-zone"].addEventListener("click", () => elements["mod-file"].click());
elements["ui-language"].addEventListener("change", (event) => {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", event.target.value);
  url.searchParams.delete("target");
  window.location.assign(url);
});
elements["target-language"].addEventListener("change", async (event) => {
  state.targetLanguage = event.target.value;
  const url = new URL(window.location.href);
  url.searchParams.set("target", state.targetLanguage);
  window.history.replaceState(null, "", url);
  elements["glossary"].placeholder =
    state.targetLanguage === "ja" ? "Gear=歯車\nSteam=蒸気" : "Gear=...\nSteam=...";
  updateAvailability();
  updateStartLabel();
  if (state.sourceFiles.length && !state.busy) {
    elements["translation-paste"].value = "";
    await loadFiles(state.sourceFiles, { scroll: false });
  }
});
document.querySelectorAll("[data-guide-game]").forEach((button) => {
  button.addEventListener("click", () => renderGameGuide(button.dataset.guideGame));
});
document.querySelectorAll("[data-minecraft-guide]").forEach((button) => {
  button.addEventListener("click", () => renderGameGuide("minecraft", button.dataset.minecraftGuide));
});
elements["mod-file"].addEventListener("change", () => {
  const files = elements["mod-file"].files;
  if (files?.length) loadFiles(files);
});
elements["image-translation-toggle"].addEventListener("change", (event) => {
  state.translateImages = event.target.checked;
  updateStartLabel();
});
document.querySelectorAll("[data-review-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.reviewTab = button.dataset.reviewTab;
    renderReviewTab();
  });
});
elements["text-selection-button"].addEventListener("click", () => {
  state.textSelectionMode = !state.textSelectionMode;
  state.selectedEntryIds.clear();
  elements["bulk-translation-toggle"].checked = true;
  elements["text-selection-button"].textContent = t(state.textSelectionMode ? "finishSelection" : "selectItems");
  renderEntries();
});
elements["clear-text-selection"].addEventListener("click", () => {
  state.selectedEntryIds.clear();
  state.textSelectionMode = false;
  elements["text-selection-button"].textContent = t("selectItems");
  renderEntries();
});
elements["image-select-button"].addEventListener("click", async () => {
  state.imageSelectionMode = !state.imageSelectionMode;
  state.selectedImageIds.clear();
  elements["image-selection-translation-toggle"].checked = true;
  state.imageEditing = false;
  state.selectedRegionIds.clear();
  elements["image-edit-button"].textContent = t("imageEdit");
  elements["image-select-button"].textContent = t(state.imageSelectionMode ? "finishSelection" : "selectImages");
  await renderImageResultTabs();
  renderImageOverlay();
  renderImageRegions();
});
elements["image-results"].addEventListener("click", async (event) => {
  const button = event.target.closest("[data-image-id]");
  if (!button) return;
  if (state.imageSelectionMode) {
    const id = button.dataset.imageId;
    if (state.selectedImageIds.has(id)) state.selectedImageIds.delete(id);
    else state.selectedImageIds.add(id);
    await renderImageResultTabs();
    return;
  }
  state.selectedImageId = button.dataset.imageId;
  state.selectedRegionIds.clear();
  await showSelectedImage();
});
document.querySelectorAll("[data-image-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.imageView = button.dataset.imageView;
    updateImageView();
  });
});
elements["image-compare-slider"].addEventListener("input", updateImageView);
elements["image-edit-button"].addEventListener("click", () => {
  if (state.imageSelectionMode) return;
  state.imageEditing = !state.imageEditing;
  state.selectedRegionIds.clear();
  elements["image-edit-button"].textContent = t(state.imageEditing ? "imageEditDone" : "imageEdit");
  renderImageOverlay();
  renderImageRegions();
});
elements["image-selection-clear-button"].addEventListener("click", () => {
  state.selectedImageIds.clear();
  state.imageSelectionMode = false;
  elements["image-select-button"].textContent = t("selectImages");
  renderImageResultTabs();
});
elements["image-selection-language-button"].addEventListener("click", applySelectedImageSettings);
elements["apply-image-button"].addEventListener("click", applySelectedImage);
elements["image-region-list"].addEventListener("input", (event) => {
  const field = event.target.dataset.regionField;
  const row = event.target.closest("[data-image-region]");
  if (!field || !row) return;
  const region = (state.imageRegions.get(state.selectedImageId) || []).find((item) => item.id === row.dataset.imageRegion);
  if (!region) return;
  if (field === "enabled") region.enabled = event.target.checked;
  else if (field === "translation" || field === "text") region[field] = event.target.value;
  else region[field] = Number(event.target.value);
  renderImageOverlay();
});

elements["image-region-overlay"].addEventListener("click", (event) => {
  const box = event.target.closest("[data-overlay-region]");
  if (!box || event.target.closest("[data-overlay-handle]")) return;
  const id = box.dataset.overlayRegion;
  state.selectedRegionIds.clear();
  state.selectedRegionIds.add(id);
  renderImageOverlay();
  renderImageRegions();
});

elements["image-region-overlay"].addEventListener("pointerdown", (event) => {
  if (!state.imageEditing) return;
  const overlay = elements["image-region-overlay"];
  const candidate = selectedImageCandidate();
  if (!candidate) return;
  const rect = overlay.getBoundingClientRect();
  const box = event.target.closest("[data-overlay-region]");
  const handle = event.target.closest("[data-overlay-handle]")?.dataset.overlayHandle;
  const region = box
    ? (state.imageRegions.get(state.selectedImageId) || []).find((item) => item.id === box.dataset.overlayRegion)
    : null;
  const startX = event.clientX;
  const startY = event.clientY;
  const original = region ? { ...region } : null;
  if (!region) return;
  event.preventDefault();
  overlay.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (region) {
      if (handle === "resize") {
        region.width = Math.max(8, original.width + dx * candidate.width / rect.width);
        region.height = Math.max(8, original.height + dy * candidate.height / rect.height);
      } else if (handle === "rotate") {
        const centerX = rect.left + (original.x + original.width / 2) / candidate.width * rect.width;
        const centerY = rect.top + (original.y + original.height / 2) / candidate.height * rect.height;
        region.angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180 / Math.PI + 90;
      } else {
        region.x = Math.max(0, Math.min(candidate.width - original.width, original.x + dx * candidate.width / rect.width));
        region.y = Math.max(0, Math.min(candidate.height - original.height, original.y + dy * candidate.height / rect.height));
      }
      renderImageOverlay();
    }
  };
  const up = async (upEvent) => {
    overlay.removeEventListener("pointermove", move);
    overlay.removeEventListener("pointerup", up);
    if (region) {
      state.selectedRegionIds.clear();
      state.selectedRegionIds.add(region.id);
      await applySelectedImage();
    }
    renderImageOverlay();
    renderImageRegions();
  };
  overlay.addEventListener("pointermove", move);
  overlay.addEventListener("pointerup", up);
});
for (const eventName of ["dragenter", "dragover"]) {
  elements["drop-zone"].addEventListener(eventName, (event) => {
    event.preventDefault();
    elements["drop-zone"].classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements["drop-zone"].addEventListener(eventName, (event) => {
    event.preventDefault();
    elements["drop-zone"].classList.remove("dragging");
  });
}
elements["drop-zone"].addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  if (files?.length) loadFiles(files);
});
elements["reset-button"].addEventListener("click", resetWorkspace);
document.querySelectorAll('input[name="translation-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => selectMode(radio.value));
});
elements["start-button"].addEventListener("click", () => {
  if (!state.project || state.busy) return;
  if (state.mode === "local") startLocalTranslation();
  else openClipboardFlow();
});
elements["cancel-button"].addEventListener("click", () => state.abortController?.abort());
elements["copy-request-button"].addEventListener("click", copyTranslationRequest);
elements["download-source-button"].addEventListener("click", downloadTranslationData);
elements["load-translation-file-button"].addEventListener("click", () =>
  elements["translation-file"].click(),
);
elements["translation-file"].addEventListener("change", () =>
  loadTranslationFile(elements["translation-file"].files?.[0]),
);
elements["apply-translation-button"].addEventListener("click", () =>
  applyPastedTranslation(),
);
for (const eventName of ["dragenter", "dragover"]) {
  elements["translation-paste"].addEventListener(eventName, (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    elements["translation-paste"].classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements["translation-paste"].addEventListener(eventName, (event) => {
    if (eventName === "drop" || event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
    }
    elements["translation-paste"].classList.remove("dragging");
  });
}
elements["translation-paste"].addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadTranslationFile(file);
});
elements["download-button"].addEventListener("click", downloadPack);
elements["bedrock-output-mode"].addEventListener("change", (event) => {
  state.bedrockTranslationMode = event.target.value === "forced"
    ? "forced"
    : "localized";
  updateBedrockOutputMode();
});
elements["entry-search"].addEventListener("input", (event) => {
  state.search = event.target.value;
  state.visibleEntries = 100;
  renderEntries();
});
elements["entry-filter"].addEventListener("change", (event) => {
  state.filter = event.target.value;
  state.visibleEntries = 100;
  renderEntries();
});
elements["load-more-button"].addEventListener("click", () => {
  state.visibleEntries += 100;
  renderEntries();
});
elements["entry-list"].addEventListener("input", (event) => {
  const id = event.target.dataset.translationId;
  if (!id || !state.project) return;
  const entry = state.project.entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.translation = event.target.value;
  entry.status = "edited";
  entry.languageConfirmed = Boolean(entry.translation.trim());
  entry.translationBlocked =
    entry.languageConfidence === "ambiguous" && !entry.languageConfirmed;
  entry.warning =
    entry.translation.trim() && !placeholdersMatch(entry.source, entry.translation)
      ? t("placeholderWarning")
      : "";
  const row = event.target.closest(".entry-row");
  const previousWarning = row?.querySelector(".translation-warning");
  if (previousWarning) previousWarning.remove();
  if (entry.languageConfirmed) {
    row?.querySelector(".language-warning")?.remove();
  }
  if (entry.warning) {
    event.target.insertAdjacentHTML(
      "afterend",
      `<span class="entry-warning translation-warning">${icon("warning", 14)} ${escapeHtml(entry.warning)}</span>`,
    );
    row?.classList.add("has-warning");
  } else if (!languageNeedsReview(entry)) {
    row?.classList.remove("has-warning");
  }
  updateReviewChrome();
  updateProjectSummary();
});
elements["entry-list"].addEventListener("click", (event) => {
  const languageCheckbox = event.target.closest("[data-language-entry-id]");
  if (languageCheckbox) {
    const id = languageCheckbox.dataset.languageEntryId;
    const selectable = filteredEntries().filter((entry) => getEntryWorkflowState(entry) !== "excluded");
    if (event.shiftKey && state.lastSelectedEntryId) {
      const start = selectable.findIndex((entry) => entry.id === state.lastSelectedEntryId);
      const end = selectable.findIndex((entry) => entry.id === id);
      if (start >= 0 && end >= 0) {
        for (const entry of selectable.slice(Math.min(start, end), Math.max(start, end) + 1)) {
          state.selectedEntryIds.add(entry.id);
        }
      }
    } else if (languageCheckbox.checked) state.selectedEntryIds.add(id);
    else state.selectedEntryIds.delete(id);
    state.lastSelectedEntryId = id;
    renderEntries();
    return;
  }
  const id = event.target.closest("[data-ignore-id]")?.dataset.ignoreId;
  if (!id || !state.project) return;
  const entry = state.project.entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.ignored = !entry.ignored;
  renderEntries();
  updateProjectSummary();
});
elements["apply-bulk-source-language"].addEventListener("click", (event) => {
  event.preventDefault();
  setSelectedEntryLanguage();
});
elements["ignore-ambiguous-button"].addEventListener("click", () => {
  if (!state.project) return;
  for (const entry of state.project.entries) {
    if (getEntryWorkflowState(entry) === "ambiguous") entry.ignored = true;
  }
  renderEntries();
  updateProjectSummary();
});
elements["ignore-visible-button"].addEventListener("click", () => {
  if (!state.project) return;
  for (const entry of filteredEntries()) {
    const workflowState = getEntryWorkflowState(entry);
    if (!["ignored", "excluded"].includes(workflowState)) entry.ignored = true;
  }
  renderEntries();
  updateProjectSummary();
});

function updateAvailability() {
  const status = state.translatorStatus;
  const unsupportedLocales = pendingUnsupportedSourceLocales();
  const locallySupported = status.supported && unsupportedLocales.length === 0;
  const availabilityCopy = {
    available: t("availableNow"),
    readily: t("availableNow"),
    downloadable: localModelDownloadCopy(),
    downloading: t("modelDownloading"),
    unavailable: t("localUnavailable"),
  };
  elements["local-availability"].textContent =
    unsupportedLocales.length
      ? t("localUnsupportedSourceShort", { locales: unsupportedLocales.join(", ") })
      : availabilityCopy[status.availability] ||
        (status.supported ? t("availableNow") : t("localUnavailable"));
  elements["local-mode-card"].classList.toggle("unavailable", !locallySupported);
  const localRadio = elements["local-mode-card"].querySelector('input[value="local"]');
  localRadio.disabled = !locallySupported;
  elements["image-translation-toggle"].disabled = !locallySupported || state.mode !== "local";
  if (!locallySupported) {
    elements["image-translation-toggle"].checked = false;
    state.translateImages = false;
  }
  if (!locallySupported) selectMode("clipboard");
}

elements["glossary"].placeholder =
  state.targetLanguage === "ja" ? "Gear=歯車\nSteam=蒸気" : "Gear=...\nSteam=...";

Promise.resolve(getLocalTranslatorStatus()).then((status) => {
  state.translatorStatus = status;
  updateAvailability();
});
