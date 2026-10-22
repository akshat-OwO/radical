// oxlint-disable typescript/promise-function-async -- Sharp's Promise boundaries are owned by Effect.
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import sharp from "sharp";

import baseline from "../../../docs/verification/native-assets-baseline.json" with { type: "json" };
import {
  AssetGenerator,
  assetGeneratorLayer,
  prepareNativeAssets,
  iosSplashResourceName,
} from "../src/native-assets.ts";
import type { AssetGeneration } from "../src/native-assets.ts";
import { image } from "./fixtures/image.ts";

const missing = (name: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method: "readFile",
    pathOrDescriptor: name,
  });
const filesystem = (files: Map<string, Uint8Array>) =>
  FileSystem.layerNoop({
    readFile: (name) =>
      Effect.suspend(() => {
        const bytes = files.get(name);
        return bytes === undefined
          ? Effect.fail(missing(name))
          : Effect.succeed(bytes);
      }),
    readFileString: (name) =>
      Effect.suspend(() => {
        const bytes = files.get(name);
        return bytes === undefined
          ? Effect.fail(missing(name))
          : Effect.succeed(new TextDecoder().decode(bytes));
      }),
    writeFileString: (name, contents) =>
      Effect.sync(() => {
        files.set(name, new TextEncoder().encode(contents));
      }),
    writeFile: (name, bytes) =>
      Effect.sync(() => {
        files.set(name, bytes);
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        for (const [name, bytes] of files) {
          if (name.startsWith(`${from}/`)) {
            files.set(to + name.slice(from.length), bytes);
            files.delete(name);
          }
        }
      }),
    makeDirectory: () => Effect.void,
    exists: (name) =>
      Effect.sync(() =>
        [...files.keys()].some((file) => file.startsWith(`${name}/`))
      ),
    readDirectory: (name) =>
      Effect.sync(() => [
        ...new Set(
          [...files.keys()]
            .filter((file) => file.startsWith(`${name}/`))
            .map((file) => file.slice(name.length + 1).split("/")[0])
        ),
      ]),
    remove: (name) =>
      Effect.sync(() => {
        for (const file of files.keys()) {
          if (file === name || file.startsWith(`${name}/`)) {
            files.delete(file);
          }
        }
      }),
  });

describe("native asset validation", () => {
  it.effect(
    "rejects missing, unsupported, corrupt, truncated and undersized source images",
    () =>
      Effect.gen(function* () {
        const files = new Map<string, Uint8Array>([
          ["/app/small.png", yield* image(1023)],
          ["/app/small-splash.png", yield* image(2731)],
          ["/app/corrupt.png", new Uint8Array([1, 2, 3])],
          ["/app/empty.png", new Uint8Array()],
          ["/app/truncated.png", (yield* image(1024)).subarray(0, 100)],
          [
            "/app/disguised.png",
            yield* Effect.promise(() =>
              sharp({
                create: {
                  width: 1024,
                  height: 1024,
                  channels: 4,
                  background: "red",
                },
              })
                .webp()
                .toBuffer()
            ),
          ],
          [
            "/app/rectangle.png",
            yield* Effect.promise(() =>
              sharp({
                create: {
                  width: 2048,
                  height: 1024,
                  channels: 4,
                  background: "red",
                },
              })
                .png()
                .toBuffer()
            ),
          ],
        ]);
        for (const [source, reason] of [
          ["missing.png", "cannot read file"],
          ["logo.svg", "unsupported format"],
          ["small.png", "1024×1024"],
          ["corrupt.png", "invalid image"],
          ["empty.png", "invalid image"],
          ["truncated.png", "image"],
          ["disguised.png", "unsupported image content"],
          ["rectangle.png", "must be square"],
        ]) {
          const error = yield* Effect.flip(
            prepareNativeAssets("/app", {
              appId: "dev.example.app",
              icon: source,
            }).pipe(Effect.provide(filesystem(files)))
          );
          assert.strictEqual(error._tag, "InvalidAsset");
          assert.include(error.message, source);
          assert.include(error.message, reason);
        }
        const error = yield* Effect.flip(
          prepareNativeAssets("/app", {
            appId: "dev.example.app",
            splash: { image: "small-splash.png", backgroundColor: "#123456" },
          }).pipe(Effect.provide(filesystem(files)))
        );
        assert.include(error.message, "2732×2732");
      })
  );

  it.effect(
    "preserves transparent icon foregrounds with uniform backgrounds and opaque icon-only images",
    () =>
      Effect.gen(function* () {
        const files = new Map([
          [
            "/app/icon.png",
            yield* Effect.promise(() =>
              sharp({
                create: {
                  width: 1024,
                  height: 1024,
                  channels: 4,
                  background: "#00000000",
                },
              })
                .composite([
                  {
                    input: {
                      create: {
                        width: 128,
                        height: 128,
                        channels: 4,
                        background: "#ff0000",
                      },
                    },
                    left: 256,
                    top: 256,
                  },
                ])
                .png()
                .toBuffer()
            ),
          ],
        ]);
        for (const icon of [
          "icon.png",
          { image: "icon.png", backgroundColor: "#123456" },
          { image: "icon.png" },
        ]) {
          const assets = yield* prepareNativeAssets("/app", {
            appId: "dev.example.app",
            icon,
          }).pipe(Effect.provide(filesystem(files)));
          const colour =
            typeof icon === "object" && icon.backgroundColor !== undefined
              ? [0x12, 0x34, 0x56]
              : [255, 255, 255];
          for (const asset of assets) {
            const { data, info } = yield* Effect.promise(() =>
              sharp(asset.bytes)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true })
            );
            const expected =
              asset.file === "icon-foreground.png"
                ? [0, 0, 0, 0]
                : [...colour, 255];
            assert.strictEqual(info.channels, 4);
            const stats = yield* Effect.promise(() =>
              sharp(data, { raw: info }).stats()
            );
            assert.deepStrictEqual(
              [...data.subarray(0, 4)],
              expected,
              asset.file
            );
            const glyphOffset = (300 * info.width + 300) * 4;
            assert.deepStrictEqual(
              [...data.subarray(glyphOffset, glyphOffset + 4)],
              asset.file === "icon-background.png"
                ? [...colour, 255]
                : [255, 0, 0, 255]
            );
            if (asset.file === "icon-background.png") {
              assert.deepStrictEqual(
                stats.channels.map(({ min, max }) => [min, max]),
                expected.map((value) => [value, value])
              );
            }
            if (asset.file === "icon-only.png") {
              assert.strictEqual(stats.channels[3].min, 255);
            }
          }
        }
      })
  );

  it.effect(
    "resolves paths from the app root, decodes JPEGs and flattens transparent splash pixels onto the configured colour",
    () =>
      Effect.gen(function* () {
        const files = new Map<string, Uint8Array>([
          [
            "/app/art/icon.jpg",
            yield* Effect.promise(() =>
              sharp({
                create: {
                  width: 1024,
                  height: 1024,
                  channels: 3,
                  background: "red",
                },
              })
                .jpeg()
                .toBuffer()
            ),
          ],
          ["/app/art/splash.png", yield* image(2732, "#00000000")],
        ]);
        const config = {
          appId: "dev.example.app",
          icon: "./art/icon.jpg",
          splash: { image: "art/splash.png", backgroundColor: "#123456" },
        };
        const first = yield* prepareNativeAssets("/app", config).pipe(
          Effect.provide(filesystem(files))
        );
        const second = yield* prepareNativeAssets("/app", config).pipe(
          Effect.provide(filesystem(files))
        );
        assert.deepStrictEqual(first, second);
        assert.deepStrictEqual(
          first.map(({ file }) => file),
          [
            "icon-only.png",
            "icon-foreground.png",
            "icon-background.png",
            "splash.png",
            "splash-dark.png",
          ]
        );
        const splash = first.find(({ file }) => file === "splash.png");
        assert.isDefined(splash);
        const pixel = yield* Effect.promise(() =>
          sharp(splash?.bytes)
            .extract({ left: 0, top: 0, width: 1, height: 1 })
            .raw()
            .toBuffer()
        );
        assert.deepStrictEqual([...pixel], [0x12, 0x34, 0x56]);
      })
  );
});

const project = "/project";
const invocation: AssetGeneration = {
  project,
  platform: "ios",
  backgroundColor: "#123456",
  assets: [],
};
const generate = (request: AssetGeneration) =>
  Effect.gen(function* () {
    const generator = yield* AssetGenerator;
    yield* generator.generate(request);
  });
const generatedAssets = Effect.gen(function* () {
  const files = new Map([
    ["/app/icon.png", yield* image(1024)],
    ["/app/splash.png", yield* image(2732)],
  ]);
  return yield* prepareNativeAssets("/app", {
    appId: "dev.example.app",
    icon: "icon.png",
    splash: { image: "splash.png", backgroundColor: "#123456" },
  }).pipe(Effect.provide(filesystem(files)));
});

describe("native asset outputs", () => {
  for (const platform of ["android", "ios"] as const) {
    it.effect(
      `writes the ${platform} baseline file set and sizes with complete catalogs and adaptive resources`,
      () =>
        Effect.gen(function* () {
          const assets = yield* generatedAssets;
          const files = new Map<string, Uint8Array>();
          yield* generate({ ...invocation, platform, assets }).pipe(
            Effect.provide(Layer.merge(filesystem(files), assetGeneratorLayer))
          );
          // Three unreferenced iOS template images are inherited, not generator writes.
          const expected = baseline.outputs
            .filter(
              (entry) =>
                entry.platform === platform &&
                !entry.canonical.includes("splash-2732x2732")
            )
            .map((entry) => ({
              ...entry,
              canonical: entry.canonical.replace(
                "/Splash.imageset/",
                `/${iosSplashResourceName(assets)}.imageset/`
              ),
            }));
          const additional = new Map<
            string,
            { width?: number; height?: number }
          >();
          if (platform === "android") {
            for (const entry of expected.filter(({ canonical }) =>
              /mipmap-[^-]+\/ic_launcher.*\.png$/u.test(canonical)
            )) {
              if (entry.canonical.endsWith("/ic_launcher_foreground.png")) {
                const monochrome = entry.canonical.replace(
                  "foreground",
                  "monochrome"
                );
                additional.set(monochrome, entry);
              }
            }
            for (const name of ["ic_launcher", "ic_launcher_round"]) {
              additional.set(
                `android/app/src/main/res/mipmap-anydpi-v33/${name}.xml`,
                {}
              );
            }
          }
          assert.deepStrictEqual(
            [...files.keys()].toSorted(),
            [
              ...expected.map(({ canonical }) => path.join(project, canonical)),
              ...[...additional.keys()].map((file) => path.join(project, file)),
            ].toSorted()
          );
          for (const entry of [
            ...expected.map((item) => [item.canonical, item] as const),
            ...additional,
          ]) {
            const [file, dimensions] = entry;
            const bytes = files.get(path.join(project, file));
            assert.isDefined(bytes, file);
            assert.isAbove(bytes?.length ?? 0, 0, file);
            if (file.endsWith(".png")) {
              const metadata = yield* Effect.promise(() =>
                sharp(bytes).metadata()
              );
              assert.strictEqual(metadata.width, dimensions.width, file);
              assert.strictEqual(metadata.height, dimensions.height, file);
              if (platform === "ios") {
                assert.isFalse(
                  metadata.hasAlpha,
                  "iOS icons and splashes are opaque RGB"
                );
              }
            }
          }
          for (const entry of expected.filter(({ canonical }) =>
            canonical.endsWith("Contents.json")
          )) {
            assert.deepStrictEqual(
              JSON.parse(
                new TextDecoder().decode(
                  files.get(path.join(project, entry.canonical))
                )
              ),
              JSON.parse(entry.contents ?? "{}")
            );
          }
          if (platform === "android") {
            assert.isFalse(
              [...files.keys()].some((file) => file.includes("/mipmap-night-")),
              "night rasters must not override adaptive XML"
            );
            const res = `${project}/android/app/src/main/res`;
            for (const version of [26, 33]) {
              for (const name of ["ic_launcher", "ic_launcher_round"]) {
                const xml = new TextDecoder().decode(
                  files.get(`${res}/mipmap-anydpi-v${version}/${name}.xml`)
                );
                assert.include(xml, "@mipmap/ic_launcher_foreground");
                assert.include(xml, "@mipmap/ic_launcher_background");
                assert.include(xml, 'android:inset="16.7%"');
                assert.strictEqual(
                  xml.includes("<monochrome>"),
                  version === 33
                );
                if (version === 33) {
                  assert.include(xml, "@mipmap/ic_launcher_monochrome");
                }
              }
            }
          }
        })
    );
  }

  it.effect(
    "changes the splash resource name only when prepared pixels change and removes stale hashed catalogs",
    () =>
      Effect.gen(function* () {
        const assets = yield* generatedAssets;
        const same = yield* generatedAssets;
        const changed = [
          { file: "splash.png", bytes: yield* image(2732, "#00ff00") },
        ];
        const first = iosSplashResourceName(assets);
        const second = iosSplashResourceName(changed);
        assert.match(first, /^RadicalSplash[0-9a-f]{16}$/u);
        assert.strictEqual(first, iosSplashResourceName(same));
        assert.notStrictEqual(first, second);
        assert.strictEqual(iosSplashResourceName([]), "");
        const files = new Map<string, Uint8Array>();
        const layer = Layer.merge(filesystem(files), assetGeneratorLayer);
        yield* generate({ ...invocation, assets }).pipe(Effect.provide(layer));
        const unrelated = `${project}/ios/App/App/Assets.xcassets/Other.imageset/Contents.json`;
        files.set(unrelated, new Uint8Array([99]));
        yield* generate({ ...invocation, assets: changed }).pipe(
          Effect.provide(layer)
        );
        assert.isFalse(
          [...files.keys()].some((file) => file.includes(`/${first}.imageset/`))
        );
        assert.isTrue(
          [...files.keys()].some((file) =>
            file.includes(`/${second}.imageset/`)
          )
        );
        assert.deepStrictEqual(files.get(unrelated), new Uint8Array([99]));
      })
  );

  it.effect(
    "writes only requested assets and leaves platform defaults alone when none are configured",
    () =>
      Effect.gen(function* () {
        const assets = yield* generatedAssets;
        for (const platform of ["android", "ios"] as const) {
          for (const kind of ["icon", "splash", "none"]) {
            const sentinel = "/project/default";
            const files = new Map([[sentinel, new Uint8Array([99])]]);
            const selected =
              kind === "none"
                ? []
                : assets.filter(({ file }) => file.startsWith(kind));
            yield* generate({ ...invocation, platform, assets: selected }).pipe(
              Effect.provide(
                Layer.merge(filesystem(files), assetGeneratorLayer)
              )
            );
            assert.deepStrictEqual(files.get(sentinel), new Uint8Array([99]));
            const paths = [...files.keys()].filter((file) => file !== sentinel);
            if (kind === "none") {
              assert.isEmpty(paths);
            } else {
              assert.isNotEmpty(paths);
              assert.isTrue(
                paths.every((file) =>
                  kind === "icon"
                    ? /ic_launcher|AppIcon/u.test(file)
                    : /splash/iu.test(file)
                )
              );
            }
          }
        }
      })
  );

  it.effect("preserves legacy padding, round masks and monochrome alpha", () =>
    Effect.gen(function* () {
      const files = new Map<string, Uint8Array>();
      const assets = yield* prepareNativeAssets("/app", {
        appId: "dev.example.app",
        icon: "icon.png",
      }).pipe(
        Effect.provide(
          filesystem(
            new Map([["/app/icon.png", yield* image(1024, "#ff000080")]])
          )
        )
      );
      yield* generate({ ...invocation, platform: "android", assets }).pipe(
        Effect.provide(Layer.merge(filesystem(files), assetGeneratorLayer))
      );
      const readPixel = (name: string, left: number, top: number) =>
        Effect.promise(() =>
          sharp(
            files.get(
              `${project}/android/app/src/main/res/mipmap-mdpi/${name}.png`
            )
          )
            .ensureAlpha()
            .extract({ left, top, width: 1, height: 1 })
            .raw()
            .toBuffer()
        );
      assert.deepStrictEqual(
        [...(yield* readPixel("ic_launcher", 0, 24))],
        [0, 0, 0, 0]
      );
      assert.strictEqual((yield* readPixel("ic_launcher", 8, 24))[3], 255);
      assert.strictEqual((yield* readPixel("ic_launcher_round", 0, 0))[3], 0);
      assert.strictEqual(
        (yield* readPixel("ic_launcher_round", 24, 24))[3],
        255
      );
      assert.deepStrictEqual(
        [...(yield* readPixel("ic_launcher_monochrome", 24, 24))],
        [0, 0, 0, 128]
      );
      assert.deepStrictEqual(
        [...(yield* readPixel("ic_launcher_foreground", 24, 24))],
        [255, 0, 0, 128]
      );
    })
  );

  it.effect(
    "keeps Android system splash artwork square and dark artwork separate",
    () =>
      Effect.gen(function* () {
        const source = yield* Effect.promise(() =>
          sharp({
            create: {
              width: 2732,
              height: 2732,
              channels: 4,
              background: "#241044",
            },
          })
            .composite([
              {
                input: {
                  create: {
                    width: 683,
                    height: 1366,
                    channels: 4,
                    background: "#ff0000",
                  },
                },
                left: 0,
                top: 683,
              },
              {
                input: {
                  create: {
                    width: 683,
                    height: 683,
                    channels: 4,
                    background: "#00ff00",
                  },
                },
                left: 1366,
                top: 0,
              },
            ])
            .png()
            .toBuffer()
        );
        const files = new Map<string, Uint8Array>();
        yield* generate({
          ...invocation,
          platform: "android",
          assets: [
            { file: "splash.png", bytes: source },
            { file: "splash-dark.png", bytes: yield* image(2732, "#123456") },
          ],
        }).pipe(
          Effect.provide(Layer.merge(filesystem(files), assetGeneratorLayer))
        );
        const square = files.get(
          `${project}/android/app/src/main/res/drawable-nodpi/radical_splash_icon.png`
        );
        for (const [left, top, expected] of [
          [128, 512, [255, 0, 0, 255]],
          [640, 128, [0, 255, 0, 255]],
          [384, 512, [0x24, 0x10, 0x44, 255]],
          [896, 896, [0x24, 0x10, 0x44, 255]],
        ] as const) {
          const pixel = yield* Effect.promise(() =>
            sharp(square)
              .ensureAlpha()
              .extract({ left, top, width: 1, height: 1 })
              .raw()
              .toBuffer()
          );
          assert.deepStrictEqual(
            [...pixel],
            [...expected],
            `square artwork at ${left},${top}`
          );
        }
        for (const orientation of ["land", "port"]) {
          const dark = files.get(
            `${project}/android/app/src/main/res/drawable-${orientation}-night-mdpi/splash.png`
          );
          const pixel = yield* Effect.promise(() =>
            sharp(dark)
              .ensureAlpha()
              .extract({ left: 0, top: 0, width: 1, height: 1 })
              .raw()
              .toBuffer()
          );
          assert.deepStrictEqual([...pixel], [0x12, 0x34, 0x56, 255]);
        }
      })
  );

  it.effect(
    "reports corrupt image sources, missing foregrounds and filesystem failures as typed errors",
    () =>
      Effect.gen(function* () {
        const valid = yield* image(1024);
        const failureFs = FileSystem.layerNoop({
          makeDirectory: () => Effect.fail(missing("/project")),
        });
        for (const [assets, fs, message] of [
          [
            [{ file: "icon-only.png", bytes: new Uint8Array([1]) }],
            filesystem(new Map()),
            "Cannot resize",
          ],
          [
            [{ file: "icon-only.png", bytes: valid }],
            filesystem(new Map()),
            "Missing native asset source icon-foreground.png",
          ],
          [
            [{ file: "icon-only.png", bytes: valid }],
            failureFs,
            "Native asset generation failed",
          ],
        ] as const) {
          const error = yield* generate({
            ...invocation,
            platform: message.startsWith("Missing") ? "android" : "ios",
            assets,
          }).pipe(
            Effect.provide(Layer.merge(fs, assetGeneratorLayer)),
            Effect.flip
          );
          assert.strictEqual(error._tag, "AssetGenerationFailed");
          assert.include(error.message, message);
        }
      })
  );
});
