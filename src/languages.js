export const DEFAULT_TARGET_LANGUAGE = "ja";

export const TARGET_LANGUAGES = [
  {
    id: "en",
    locale: "en-US",
    minecraftLocale: "en_us",
    nativeName: "English",
    englishName: "English",
    modelSizeMb: 0,
    reverseModelSizeMb: 0,
  },
  {
    id: "ja",
    locale: "ja-JP",
    minecraftLocale: "ja_jp",
    nativeName: "日本語",
    englishName: "Japanese",
    modelSizeMb: 48,
    reverseModelSizeMb: 71,
  },
  {
    id: "ko",
    locale: "ko-KR",
    minecraftLocale: "ko_kr",
    nativeName: "한국어",
    englishName: "Korean",
    modelSizeMb: 65,
    reverseModelSizeMb: 70,
  },
  {
    id: "zh-Hans",
    locale: "zh-CN",
    minecraftLocale: "zh_cn",
    nativeName: "简体中文",
    englishName: "Simplified Chinese",
    modelSizeMb: 50,
    reverseModelSizeMb: 71,
  },
  {
    id: "zh-Hant",
    locale: "zh-TW",
    minecraftLocale: "zh_tw",
    nativeName: "繁體中文",
    englishName: "Traditional Chinese",
    modelSizeMb: 48,
    reverseModelSizeMb: 50,
  },
  {
    id: "de",
    locale: "de-DE",
    minecraftLocale: "de_de",
    nativeName: "Deutsch",
    englishName: "German",
    modelSizeMb: 36,
    reverseModelSizeMb: 36,
  },
  {
    id: "es",
    locale: "es-ES",
    minecraftLocale: "es_es",
    nativeName: "Español",
    englishName: "Spanish",
    modelSizeMb: 36,
    reverseModelSizeMb: 36,
  },
  {
    id: "fr",
    locale: "fr-FR",
    minecraftLocale: "fr_fr",
    nativeName: "Français",
    englishName: "French",
    modelSizeMb: 36,
    reverseModelSizeMb: 36,
  },
  {
    id: "pt",
    locale: "pt-BR",
    minecraftLocale: "pt_br",
    nativeName: "Português (Brasil)",
    englishName: "Portuguese (Brazil)",
    modelSizeMb: 36,
    reverseModelSizeMb: 36,
  },
  {
    id: "ru",
    locale: "ru-RU",
    minecraftLocale: "ru_ru",
    nativeName: "Русский",
    englishName: "Russian",
    modelSizeMb: 45,
    reverseModelSizeMb: 22,
  },
  {
    id: "it",
    locale: "it-IT",
    minecraftLocale: "it_it",
    nativeName: "Italiano",
    englishName: "Italian",
    modelSizeMb: 36,
    reverseModelSizeMb: 36,
  },
];

export const SOURCE_LANGUAGES = TARGET_LANGUAGES;

export function getTargetLanguage(id = DEFAULT_TARGET_LANGUAGE) {
  return (
    TARGET_LANGUAGES.find((language) => language.id === id) ||
    TARGET_LANGUAGES.find((language) => language.id === DEFAULT_TARGET_LANGUAGE)
  );
}

export function getSourceLanguage(id) {
  return SOURCE_LANGUAGES.find((language) => language.id === id) || null;
}

export function languageFromMinecraftLocale(locale) {
  const normalized = String(locale || "").trim().toLowerCase().replaceAll("-", "_");
  if (!normalized) return null;
  if (normalized.startsWith("zh_tw") || normalized.startsWith("zh_hk")) {
    return "zh-Hant";
  }
  if (normalized.startsWith("zh_cn") || normalized.startsWith("zh_sg")) {
    return "zh-Hans";
  }
  const language = normalized.split("_")[0];
  return SOURCE_LANGUAGES.some((candidate) => candidate.id === language)
    ? language
    : null;
}

export function estimateLocalModelSizeMb(project, targetLanguage) {
  const target = getTargetLanguage(targetLanguage || project?.targetLanguage);
  const pendingSources = new Set(
    (project?.entries || [])
      .filter(
        (entry) =>
          !entry.ignored &&
          (entry.source == null || String(entry.source).trim()) &&
          !entry.translation?.trim() &&
          !entry.translationBlocked,
      )
      .map((entry) => entry.sourceLanguage)
      .filter(Boolean),
  );
  if (!pendingSources.size) return 0;

  let size = [...pendingSources].some((sourceLanguage) => sourceLanguage !== target.id)
    ? target.modelSizeMb
    : 0;
  for (const sourceLanguage of pendingSources) {
    if (sourceLanguage !== "en") {
      if (sourceLanguage !== target.id) {
        size += getSourceLanguage(sourceLanguage)?.reverseModelSizeMb || 0;
      }
    }
  }
  return Math.max(0, size);
}

function matchTargetLanguage(language) {
  const normalized = String(language || "").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-Hant";
  if (normalized.startsWith("zh")) return "zh-Hans";
  const exact = TARGET_LANGUAGES.find((item) =>
    normalized.startsWith(item.id.toLowerCase()),
  );
  return exact?.id || null;
}

export function detectTargetLanguage(language = globalThis.navigator?.language) {
  return matchTargetLanguage(language) || DEFAULT_TARGET_LANGUAGE;
}

export function getDefaultTargetLanguage(
  uiLocale,
  preferredLanguages = globalThis.navigator?.languages || [
    globalThis.navigator?.language,
  ],
) {
  const interfaceMatch = matchTargetLanguage(uiLocale);
  if (interfaceMatch) return interfaceMatch;

  for (const language of preferredLanguages || []) {
    const preferredMatch = matchTargetLanguage(language);
    if (preferredMatch) return preferredMatch;
  }
  return DEFAULT_TARGET_LANGUAGE;
}
