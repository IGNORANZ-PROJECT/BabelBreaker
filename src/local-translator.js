const MODEL_REGISTRY_URL = "/model-registry.json";
const MODEL_CACHE_NAME = "babel-breaker-translation-models-v1";

function emitProgress(callback, percent) {
  callback(Math.max(0, Math.min(100, Math.round(percent))));
}

async function sha256Hex(buffer, runtime) {
  const digest = await runtime.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function openModelCache(runtime) {
  if (!runtime.caches?.open) return null;
  try {
    return await runtime.caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

function createMozillaBackingClass(TranslatorBacking, runtime) {
  return class MozillaModelBacking extends TranslatorBacking {
    constructor(options) {
      const {
        onModelProgress,
        signal,
        ...workerOptions
      } = options;
      super(workerOptions);
      this.onModelProgress = onModelProgress || (() => {});
      this.signal = signal;
    }

    async loadWorker() {
      const worker = new runtime.Worker("/bergamot/translator-worker.js");
      let serial = 0;
      const pending = new Map();

      const call = (name, ...args) =>
        new Promise((resolve, reject) => {
          const id = ++serial;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, name, args });
        });

      worker.addEventListener("message", ({ data: { id, result, error } }) => {
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        if (error) {
          request.reject(
            Object.assign(new Error(error.message), {
              name: error.name || "Error",
              stack: error.stack,
            }),
          );
        } else {
          request.resolve(result);
        }
      });

      worker.addEventListener("error", (event) => {
        const error = new Error(
          event.message || "端末内翻訳エンジンを初期化できませんでした。",
        );
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        worker.terminate();
      });

      await call("initialize", this.options);
      return {
        worker,
        exports: new Proxy(
          {},
          {
            get(_target, name) {
              if (name !== "then") return (...args) => call(name, ...args);
              return undefined;
            },
          },
        ),
      };
    }

    async loadModelRegistery() {
      await Promise.resolve();
      emitProgress(this.onModelProgress, 3);
      const response = await runtime.fetch(MODEL_REGISTRY_URL, {
        credentials: "omit",
        signal: this.signal,
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`翻訳モデル一覧を取得できませんでした (${response.status})`);
      }
      const registry = await response.json();
      if (!Array.isArray(registry.models)) {
        throw new Error("翻訳モデル一覧の形式が正しくありません");
      }
      this.expectedModelSizes = new Map(
        registry.models.flatMap((model) =>
          Object.values(model.files || {})
            .filter((file) => file?.name && Number.isSafeInteger(file.size))
            .map((file) => [file.name, file.size]),
        ),
      );
      emitProgress(this.onModelProgress, 8);
      return registry.models;
    }

    async fetch(url, expectedHash, extra) {
      const cache = await openModelCache(runtime);
      let response = cache ? await cache.match(url) : null;
      const fromCache = Boolean(response);
      if (!response) {
        response = await runtime.fetch(url, {
          credentials: "omit",
          signal: extra?.signal || this.signal,
        });
        if (!response.ok) {
          throw new Error(`翻訳モデルを取得できませんでした (${response.status})`);
        }
      }

      const cacheCandidate = !fromCache && cache ? response.clone() : null;
      const buffer = await response.arrayBuffer();
      const expectedSize = this.expectedModelSizes?.get(url);

      if (expectedSize !== undefined && buffer.byteLength !== expectedSize) {
        if (cache) await cache.delete(url).catch(() => {});
        throw new Error("翻訳モデルの容量を確認できませんでした");
      }

      if (expectedHash) {
        const actualHash = await sha256Hex(buffer, runtime);
        if (actualHash !== expectedHash.toLowerCase()) {
          if (cache) await cache.delete(url).catch(() => {});
          throw new Error("翻訳モデルの整合性を確認できませんでした");
        }
      }
      if (cacheCandidate) {
        await cache.put(url, cacheCandidate).catch(() => {});
      }

      this.modelFileCompleted = (this.modelFileCompleted || 0) + 1;
      const total = Math.max(this.modelFileTotal || 1, 1);
      emitProgress(
        this.onModelProgress,
        8 + (this.modelFileCompleted / total) * 82,
      );
      return buffer;
    }
  };
}

export function getLocalTranslatorStatus(runtime = globalThis) {
  const supported =
    typeof runtime.WebAssembly === "object" &&
    typeof runtime.Worker === "function" &&
    typeof runtime.fetch === "function" &&
    typeof runtime.crypto?.subtle?.digest === "function";
  return {
    supported,
    availability: supported ? "downloadable" : "unavailable",
  };
}

export async function createLocalTranslator({
  sourceLanguage = "en",
  targetLanguage = "ja",
  signal,
  onModelProgress = () => {},
  runtime = globalThis,
  translatorModule,
} = {}) {
  const status = getLocalTranslatorStatus(runtime);
  if (!status.supported) {
    throw new Error(
      "このブラウザは端末内翻訳に必要なWebAssemblyまたはWeb Workerに対応していません。",
    );
  }
  if (signal?.aborted) {
    throw new DOMException("翻訳を中止しました。", "AbortError");
  }

  emitProgress(onModelProgress, 1);
  const module =
    translatorModule ||
    (await import("@browsermt/bergamot-translator/translator.js"));
  const Backing = createMozillaBackingClass(module.TranslatorBacking, runtime);
  const options = {
    sourceLanguage,
    targetLanguage,
    pivotLanguage: "en",
    workers: 1,
    batchSize: 8,
    cacheSize: 16_384,
    downloadTimeout: 300_000,
    signal,
    onModelProgress,
  };
  const backing = new Backing(options);
  const engine = new module.BatchTranslator(options, backing);
  const models = await backing.getModels({
    from: sourceLanguage,
    to: targetLanguage,
  });
  backing.modelFileTotal = models.reduce(
    (total, model) =>
      total + Object.values(model.files || {}).filter((file) => file?.name).length,
    0,
  );
  backing.modelFileCompleted = 0;
  await Promise.all(
    models.map(({ from, to }) =>
      backing.getTranslationModel({ from, to }, { signal }),
    ),
  );
  const worker = await backing.loadWorker();
  engine.workers.push({ ...worker, idle: true });
  emitProgress(onModelProgress, 100);

  const abortQueuedWork = () => engine.remove(() => true);
  signal?.addEventListener("abort", abortQueuedWork);

  return {
    async translate(text) {
      if (signal?.aborted) {
        throw new DOMException("翻訳を中止しました。", "AbortError");
      }
      try {
        const response = await engine.translate({
          from: sourceLanguage,
          to: targetLanguage,
          text: String(text),
          html: false,
        });
        if (signal?.aborted) {
          throw new DOMException("翻訳を中止しました。", "AbortError");
        }
        return response.target.text;
      } catch (error) {
        if (signal?.aborted || error instanceof module.CancelledError) {
          throw new DOMException("翻訳を中止しました。", "AbortError");
        }
        throw error;
      }
    },
    async destroy() {
      signal?.removeEventListener("abort", abortQueuedWork);
      await engine.delete();
    },
  };
}

export const LOCAL_MODEL_REGISTRY_URL = MODEL_REGISTRY_URL;
