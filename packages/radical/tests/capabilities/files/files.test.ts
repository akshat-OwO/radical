import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  BrowserFiles,
  pickFiles,
} from "../../../src/capabilities/files/file-picker.ts";
import type { PickedFile } from "../../../src/capabilities/files/file-picker.ts";
import {
  BrowserIntents,
  NoHandler,
  openFile,
  openUrl,
} from "../../../src/capabilities/files/intents.ts";
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import { Cancelled, Unavailable } from "../../../src/core/errors.ts";
import {
  PluginModules,
  resolvePlugins,
} from "../../../src/vite/plugins/plugin-plan.ts";

const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));

const filesLayer = (overrides: Partial<BrowserFiles["Service"]> = {}) =>
  Layer.succeed(BrowserFiles, {
    pick: () => Effect.sync(() => assert.fail("Unexpected browser picker")),
    readNative: (uri) => Effect.succeed(new Blob([uri], { type: "" })),
    ...overrides,
  });

const intentsLayer = (overrides: Partial<BrowserIntents["Service"]> = {}) =>
  Layer.succeed(BrowserIntents, {
    openUrl: () => Effect.sync(() => assert.fail("Unexpected browser open")),
    ...overrides,
  });

const failed = (cause: unknown) =>
  new BridgeCallFailed({ plugin: "Test", method: "test", cause });

const strip = (files: readonly PickedFile[]) =>
  files.map(({ blob: _blob, ...file }) => file);

const androidIntents = (call: Parameters<typeof bridgeTestLayer>[1]) =>
  Layer.merge(bridgeTestLayer("android", call), intentsLayer());

const ids = (config: Partial<Parameters<typeof resolvePlugins>[0]>) =>
  resolvePlugins({ appId: "dev.test.app", ...config }).pipe(
    Effect.provideService(PluginModules, { load: unexpected }),
    Effect.map((plugins) => plugins.map(({ manifest }) => manifest.id))
  );

describe("file picker", () => {
  it.effect(
    "picks native files in both shells and reads them through their URIs",
    () =>
      Effect.gen(function* () {
        for (const runtime of ["ios", "android"] as const) {
          const calls: unknown[] = [];
          const read: string[] = [];

          const files = yield* pickFiles({
            types: ["application/pdf", "image/*"],
            multiple: true,
          }).pipe(
            Effect.provide(
              Layer.merge(
                bridgeTestLayer(runtime, (plugin, method, options) =>
                  Effect.sync(() => {
                    calls.push({ plugin, method, options });

                    return {
                      files: [
                        {
                          name: "a.pdf",
                          mimeType: "application/pdf",
                          size: 3,
                          path: "content://docs/a.pdf",
                          modifiedAt: 7,
                          duration: 0,
                        },
                        {
                          name: "b.bin",
                          mimeType: "",
                          size: 1,
                          path: "file:///tmp/b.bin",
                        },
                      ],
                    };
                  })
                ),
                filesLayer({
                  readNative: (uri) =>
                    Effect.sync(() => {
                      read.push(uri);

                      return new Blob(["x"]);
                    }),
                })
              )
            )
          );

          assert.deepStrictEqual(calls, [
            {
              plugin: "FilePicker",
              method: "pickFiles",
              options: {
                types: ["application/pdf", "image/*"],
                limit: 0,
                readData: false,
              },
            },
          ]);
          assert.deepStrictEqual(read, [
            "content://docs/a.pdf",
            "file:///tmp/b.bin",
          ]);
          assert.deepStrictEqual(strip(files), [
            {
              name: "a.pdf",
              mimeType: "application/pdf",
              size: 1,
              lastModified: 7,
              uri: "content://docs/a.pdf",
            },
            {
              name: "b.bin",
              mimeType: "application/octet-stream",
              size: 1,
              uri: "file:///tmp/b.bin",
            },
          ]);
          assert.instanceOf(files[0]?.blob, Blob);
        }
      })
  );

  it.effect(
    "keeps a multi-select when the provider omits a type or name, or reports unknown size and date",
    () =>
      Effect.gen(function* () {
        const files = yield* pickFiles({ multiple: true }).pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("android", () =>
                Effect.succeed({
                  files: [
                    { size: 4, path: "content://docs/document%2F42" },
                    {
                      name: "c.txt",
                      mimeType: "text/plain",
                      size: -1,
                      modifiedAt: 0,
                      path: "file:///tmp/c.txt",
                    },
                  ],
                })
              ),
              filesLayer({
                readNative: (uri) =>
                  Effect.succeed(
                    new Blob([uri.endsWith("42") ? "four" : "seven!!"], {
                      type: "",
                    })
                  ),
              })
            )
          )
        );

        assert.deepStrictEqual(strip(files), [
          {
            name: "document%2F42",
            mimeType: "application/octet-stream",
            size: 4,
            uri: "content://docs/document%2F42",
          },
          {
            name: "c.txt",
            mimeType: "text/plain",
            size: 7,
            uri: "file:///tmp/c.txt",
          },
        ]);
      })
  );

  it.effect("limits a single native pick to one file", () =>
    Effect.gen(function* () {
      let options: unknown;
      yield* pickFiles().pipe(
        Effect.provide(
          Layer.merge(
            bridgeTestLayer("android", (_plugin, _method, received) =>
              Effect.sync(() => {
                options = received;

                return {
                  files: [
                    { name: "a", mimeType: "text/plain", size: 1, path: "p" },
                  ],
                };
              })
            ),
            filesLayer()
          )
        )
      );
      assert.deepStrictEqual(options, { limit: 1, readData: false });
    })
  );

  it.effect(
    "returns the same shape from the browser without a URI or bridge call",
    () =>
      Effect.gen(function* () {
        const file = new File(["hi"], "note.txt", {
          type: "text/plain",
          lastModified: 5,
        });

        const untyped = new File(["?"], "raw", { lastModified: 6 });
        let received: unknown;

        const files = yield* pickFiles({ types: ["text/plain"] }).pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("browser", unexpected),
              filesLayer({
                pick: (options) =>
                  Effect.sync(() => {
                    received = options;

                    return [file, untyped];
                  }),
                readNative: () =>
                  Effect.sync(() => assert.fail("Unexpected native read")),
              })
            )
          )
        );

        assert.deepStrictEqual(received, { types: ["text/plain"] });
        assert.deepStrictEqual(strip(files), [
          {
            name: "note.txt",
            mimeType: "text/plain",
            size: 2,
            lastModified: 5,
          },
          {
            name: "raw",
            mimeType: "application/octet-stream",
            size: 1,
            lastModified: 6,
          },
        ]);
        assert.strictEqual(files[0]?.blob, file);
      })
  );

  it.effect(
    "maps native and browser cancellation and preserves other failures",
    () =>
      Effect.gen(function* () {
        const native = (call: () => Effect.Effect<unknown, BridgeCallFailed>) =>
          pickFiles().pipe(
            Effect.provide(
              Layer.merge(bridgeTestLayer("ios", call), filesLayer())
            ),
            Effect.flip
          );

        assert.instanceOf(
          yield* native(() =>
            Effect.fail(failed({ message: "pickFiles canceled." }))
          ),
          Cancelled
        );
        assert.instanceOf(
          yield* native(() => Effect.succeed({ files: [] })),
          Cancelled
        );
        assert.strictEqual(
          (yield* native(() => Effect.fail(failed({ message: "boom" }))))._tag,
          "BridgeCallFailed"
        );
        assert.instanceOf(
          yield* native(() =>
            Effect.succeed({
              files: [{ name: "x", mimeType: "text/plain", size: 1 }],
            })
          ),
          Unavailable
        );
        assert.instanceOf(
          yield* pickFiles().pipe(
            Effect.provide(
              Layer.merge(
                bridgeTestLayer("browser", unexpected),
                filesLayer({ pick: () => Effect.fail(new Cancelled({})) })
              )
            ),
            Effect.flip
          ),
          Cancelled
        );
      })
  );

  it.effect("interrupts a pending browser pick and releases its input", () =>
    Effect.gen(function* () {
      let released = false;

      const fiber = yield* pickFiles().pipe(
        Effect.provide(
          Layer.merge(
            bridgeTestLayer("browser", unexpected),
            filesLayer({
              pick: () =>
                Effect.sleep("1 minute").pipe(
                  Effect.as([]),
                  Effect.ensuring(
                    Effect.sync(() => {
                      released = true;
                    })
                  )
                ),
            })
          )
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust("30 seconds");
      yield* Fiber.interrupt(fiber);
      assert.isTrue(released);
    })
  );
});

describe("intents", () => {
  it.effect(
    "opens URLs natively in both shells and reports a missing handler",
    () =>
      Effect.gen(function* () {
        for (const runtime of ["ios", "android"] as const) {
          const calls: unknown[] = [];

          for (const completed of [true, false]) {
            const result = yield* openUrl("mailto:a@b.test").pipe(
              Effect.provide(
                Layer.merge(
                  bridgeTestLayer(runtime, (plugin, method, options) =>
                    Effect.sync(() => {
                      calls.push({ plugin, method, options });

                      return { completed };
                    })
                  ),
                  intentsLayer()
                )
              ),
              Effect.flip,
              Effect.option
            );

            if (completed) {
              assert.isTrue(result._tag === "None");
            } else {
              assert.instanceOf(
                result._tag === "Some" ? result.value : undefined,
                NoHandler
              );
            }
          }

          assert.deepStrictEqual(calls, [
            {
              plugin: "AppLauncher",
              method: "openUrl",
              options: { url: "mailto:a@b.test" },
            },
            {
              plugin: "AppLauncher",
              method: "openUrl",
              options: { url: "mailto:a@b.test" },
            },
          ]);
        }
      })
  );

  it.effect(
    "opens browser URLs through the browser service and rejects invalid URLs",
    () =>
      Effect.gen(function* () {
        const opened: string[] = [];
        yield* openUrl("https://example.test/a").pipe(
          Effect.provide(
            Layer.merge(
              bridgeTestLayer("browser", unexpected),
              intentsLayer({
                openUrl: (url) =>
                  Effect.sync(() => {
                    opened.push(url);
                  }),
              })
            )
          )
        );
        assert.deepStrictEqual(opened, ["https://example.test/a"]);
        assert.instanceOf(
          yield* openUrl("not a url").pipe(
            Effect.provide(
              Layer.merge(
                bridgeTestLayer("android", unexpected),
                intentsLayer()
              )
            ),
            Effect.flip
          ),
          Unavailable
        );
      })
  );

  it.effect("validates URLs in WebViews without URL.canParse", () =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const canParse = Object.getOwnPropertyDescriptor(URL, "canParse");
          Reflect.deleteProperty(URL, "canParse");

          return canParse;
        }),
        (canParse) =>
          Effect.sync(() => {
            if (canParse !== undefined) {
              Object.defineProperty(URL, "canParse", canParse);
            }
          })
      );

      const layer = Layer.merge(
        bridgeTestLayer("android", (_plugin, _method, options) =>
          Effect.succeed({ completed: true, options })
        ),
        intentsLayer()
      );

      yield* openUrl("https://apps.apple.com/app/id1").pipe(
        Effect.provide(layer)
      );
      assert.isFalse("canParse" in URL);
      assert.instanceOf(
        yield* openUrl("not a url").pipe(Effect.provide(layer), Effect.flip),
        Unavailable
      );
    }).pipe(Effect.scoped)
  );

  it.effect(
    "opens native files with the default handler or chooser and maps opener codes",
    () =>
      Effect.gen(function* () {
        const calls: unknown[] = [];

        const record = androidIntents((plugin, method, options) =>
          Effect.sync(() => {
            calls.push({ plugin, method, options });

            return {};
          })
        );

        const file = {
          uri: "content://docs/a.pdf",
          mimeType: "application/pdf",
        };

        yield* openFile(file).pipe(Effect.provide(record));
        yield* openFile({ uri: "file:///tmp/b" }, { chooser: true }).pipe(
          Effect.provide(record)
        );
        assert.deepStrictEqual(calls, [
          {
            plugin: "FileOpener",
            method: "open",
            options: {
              filePath: "content://docs/a.pdf",
              contentType: "application/pdf",
              openWithDefault: true,
            },
          },
          {
            plugin: "FileOpener",
            method: "open",
            options: { filePath: "file:///tmp/b", openWithDefault: false },
          },
        ]);

        for (const [code, tag] of [
          ["8", "NoHandler"],
          ["9", "Unavailable"],
          ["1", "BridgeCallFailed"],
        ]) {
          const error = yield* openFile(file).pipe(
            Effect.provide(androidIntents(() => Effect.fail(failed({ code })))),
            Effect.flip
          );

          assert.strictEqual(error._tag, tag);
        }
      })
  );

  it.effect("rejects opening files without a native URI", () =>
    Effect.gen(function* () {
      for (const [runtime, file] of [
        ["browser", { uri: "file:///tmp/a" }],
        ["ios", {}],
      ] as const) {
        assert.instanceOf(
          yield* openFile(file).pipe(
            Effect.provide(
              Layer.merge(bridgeTestLayer(runtime, unexpected), intentsLayer())
            ),
            Effect.flip
          ),
          Unavailable
        );
      }
    })
  );
});

describe("file and intent enablement", () => {
  it.effect("adds only the enabled plugins and their pinned packages", () =>
    Effect.gen(function* () {
      const none = yield* ids({});
      assert.notInclude(none, "filePicker");
      assert.notInclude(none, "appLauncher");
      assert.notInclude(none, "fileOpener");
      const picker = yield* ids({ internalPlugins: { filePicker: true } });
      assert.include(picker, "filePicker");
      assert.notInclude(picker, "appLauncher");
      const intents = yield* ids({ internalPlugins: { intents: true } });
      assert.include(intents, "appLauncher");
      assert.include(intents, "fileOpener");
      assert.notInclude(intents, "filePicker");

      const plugins = yield* resolvePlugins({
        appId: "dev.test.app",
        internalPlugins: { filePicker: true, intents: true },
      }).pipe(Effect.provideService(PluginModules, { load: unexpected }));

      assert.deepStrictEqual(
        Object.assign(
          {},
          ...plugins
            .filter(({ manifest }) =>
              ["filePicker", "appLauncher", "fileOpener"].includes(manifest.id)
            )
            .map(({ manifest }) => manifest.dependencies)
        ),
        {
          "@capawesome/capacitor-file-picker": "8.1.1",
          "@capacitor/app-launcher": "8.0.1",
          "@capacitor-community/file-opener": "8.0.1",
        }
      );
    })
  );
});
