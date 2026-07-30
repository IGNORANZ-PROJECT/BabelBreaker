import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalTranslator,
  getLocalTranslatorStatus,
} from "../src/local-translator.js";

function supportedRuntime() {
  class Worker {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    postMessage({ id }) {
      queueMicrotask(() => {
        this.listeners.get("message")?.({
          data: { id, result: undefined },
        });
      });
    }

    terminate() {}
  }

  return {
    WebAssembly: {},
    Worker,
    Blob,
    Response,
    DecompressionStream,
    fetch: async () => {
      throw new Error("unexpected fetch");
    },
    crypto: {
      subtle: {
        digest: async () => new ArrayBuffer(32),
      },
    },
  };
}

test("local translator status detects required browser primitives", () => {
  assert.equal(getLocalTranslatorStatus(supportedRuntime()).supported, true);
  assert.equal(
    getLocalTranslatorStatus({
      ...supportedRuntime(),
      Worker: undefined,
    }).supported,
    false,
  );
  assert.equal(
    getLocalTranslatorStatus({
      ...supportedRuntime(),
      DecompressionStream: undefined,
    }).supported,
    false,
  );
});

test("local translator adapts Bergamot responses to the core interface", async () => {
  let deleted = false;
  const progress = [];

  class FakeBacking {
    constructor(options) {
      this.options = options;
    }

    async getModels({ from, to }) {
      return [{ from, to }];
    }

    async getTranslationModel() {
      return {};
    }

    async loadWorker() {
      return {
        worker: { terminate() {} },
        exports: {},
      };
    }
  }

  class FakeBatchTranslator {
    constructor() {
      this.workers = [];
    }

    async translate(request) {
      return { target: { text: `訳:${request.text}` } };
    }

    remove() {}

    async delete() {
      deleted = true;
    }
  }

  class FakeCancelledError extends Error {}

  const translator = await createLocalTranslator({
    runtime: supportedRuntime(),
    onModelProgress: (percent) => progress.push(percent),
    translatorModule: {
      TranslatorBacking: FakeBacking,
      BatchTranslator: FakeBatchTranslator,
      CancelledError: FakeCancelledError,
    },
  });

  assert.equal(await translator.translate("Arcane Forge"), "訳:Arcane Forge");
  assert.equal(progress[0], 1);
  assert.equal(progress.at(-1), 100);

  await translator.destroy();
  assert.equal(deleted, true);
});

test("local translator stops before initialization when cancelled", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    createLocalTranslator({
      runtime: supportedRuntime(),
      signal: controller.signal,
      translatorModule: {},
    }),
    (error) => error.name === "AbortError",
  );
});
