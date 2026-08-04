import "./styles.css";
import {
  MAX_LANG_TEXT_LENGTH,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MINECRAFT_VERSIONS,
  SUPPORTED_ARTIFACTS,
  SUPPORTED_GAMES,
  analyzeArchive,
  applyClipboardTranslation,
  buildClipboardPayload,
  buildTranslationRequest,
  combineProjects,
  buildResourcePack,
  getEntryWorkflowState,
  getLocalTranslatorStatus,
  getProjectStats,
  placeholdersMatch,
  sanitizeFileName,
  translateProject,
} from "./core.js";
import {
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
        <input id="mod-file" type="file" accept=".jar,.zip,.mrpack,.mcpack,.mcaddon,.mcworld,application/java-archive,application/zip" multiple hidden />
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
          <div class="review-actions">
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
        </div>
        <div class="review-bulk-actions">
          <button class="text-button" id="ignore-ambiguous-button" type="button">${t("ignoreAmbiguous")}</button>
          <button class="text-button" id="ignore-visible-button" type="button">${t("ignoreVisible")}</button>
        </div>
        <div class="entry-list" id="entry-list"></div>
        <button class="quiet-button load-more" id="load-more-button" type="button" hidden>${t("loadMore")}</button>
        <div class="download-row">
          <div>
            <strong id="ready-title">${t("readyTitle")}</strong>
            <span id="ready-copy">${t("readyCopy")}</span>
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
    "entry-search",
    "entry-filter",
    "ignore-ambiguous-button",
    "ignore-visible-button",
    "entry-list",
    "load-more-button",
    "ready-title",
    "ready-copy",
    "download-button",
    "download-label",
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
  updateStartLabel();
}

function updateStartLabel() {
  const complete = state.project && getProjectStats(state.project).pending === 0;
  elements["start-label"].textContent = complete
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
            const keyLabel = entryKeyLabel(entry);
            return `
            <article class="entry-row ${entry.warning || languageNeedsReview(entry) ? "has-warning" : ""} ${workflowState === "ignored" ? "is-ignored" : ""}" data-entry-id="${entry.id}">
              <div class="entry-key">
                <div class="entry-meta">
                  <span>${escapeHtml(entry.modName ? `${entry.modName} · ${entry.namespace}` : entry.namespace)}</span>
                  <span class="status-pill status-${workflowState}">${escapeHtml(workflowStateLabel(entry))}</span>
                </div>
                <code title="${escapeHtml(keyLabel)}">${escapeHtml(keyLabel)}</code>
                ${workflowState !== "excluded" ? `<button class="entry-ignore-button" type="button" data-ignore-id="${entry.id}">${t(workflowState === "ignored" ? "restoreEntry" : "ignoreEntry")}</button>` : ""}
              </div>
              <div class="entry-source">
                <small>${t("source")} · ${escapeHtml(sourceLanguageLabel(entry))}</small>
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
  elements["review-panel"].scrollIntoView({ behavior: "smooth", block: "start" });
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
          await analyzeArchive(file, {
            targetLanguage: state.targetLanguage,
            targetLocale: currentTarget().minecraftLocale,
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
  if (!stats.pending) {
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
    await translateProject(state.project, {
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
  setBusy(true);
  clearNotice();
  try {
    if ((state.project.game || "minecraft") === "minecraft" && state.project.edition !== "bedrock") {
      state.project.minecraftVersion = elements["minecraft-version"].value;
    }
    const { archive, filename } = await buildResourcePack(
      state.project,
      state.project.minecraftVersion,
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
    renderEntries();
  }
}

function resetWorkspace() {
  if (state.busy) return;
  state.project = null;
  state.sourceFiles = [];
  state.filter = "warning";
  state.search = "";
  elements.workspace.hidden = true;
  elements["ui-language"].disabled = false;
  elements["ui-language"].removeAttribute("title");
  elements["translation-paste"].value = "";
  elements["translation-file"].value = "";
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
  const id = event.target.closest("[data-ignore-id]")?.dataset.ignoreId;
  if (!id || !state.project) return;
  const entry = state.project.entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.ignored = !entry.ignored;
  renderEntries();
  updateProjectSummary();
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
  if (!locallySupported) selectMode("clipboard");
}

elements["glossary"].placeholder =
  state.targetLanguage === "ja" ? "Gear=歯車\nSteam=蒸気" : "Gear=...\nSteam=...";

Promise.resolve(getLocalTranslatorStatus()).then((status) => {
  state.translatorStatus = status;
  updateAvailability();
});
