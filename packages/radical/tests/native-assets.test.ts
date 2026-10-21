// oxlint-disable typescript/promise-function-async -- Sharp's Promise boundaries are owned by Effect.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/process";
import sharp from "sharp";

import {
  AssetGenerator,
  assetGeneratorLayer,
  assetOutputPaths,
  prepareNativeAssets,
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
    remove: (name) =>
      Effect.sync(() => {
        files.delete(name);
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

const project = fileURLToPath(new URL("../", import.meta.url));
const invocation: AssetGeneration = {
  project,
  platform: "ios",
  backgroundColor: "#123456",
  assets: [
    { file: "icon-only.png", bytes: new Uint8Array([1]) },
    { file: "splash.png", bytes: new Uint8Array([2]) },
  ],
};
const generatorMemory = (
  mode: "success" | "failure" | "missing",
  output: Uint8Array = new Uint8Array([3]),
  request: AssetGeneration = invocation
) => {
  const files = new Map<string, Uint8Array>();
  const commands: string[][] = [];
  files.set(
    path.join(project, "ios/App/App/Base.lproj/LaunchScreen.storyboard"),
    new TextEncoder().encode(
      '<resources><imageView image="Splash"/><image name="Splash" width="1366" height="1366"/></resources>'
    )
  );
  // Template files cannot disguise a CLI that exits successfully without generating anything.
  for (const file of assetOutputPaths(request)) {
    files.set(path.join(project, file), new Uint8Array([99]));
  }
  const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...ChildProcessSpawner.make(() => Effect.die("Unexpected spawn")),
    exitCode: (command) =>
      Effect.sync(() => {
        assert.strictEqual(command._tag, "StandardCommand");
        if (command._tag === "StandardCommand") {
          commands.push([...command.args]);
        }
        if (mode === "success") {
          for (const file of assetOutputPaths(request)) {
            files.set(path.join(project, file), output);
          }
        }
        return ChildProcessSpawner.ExitCode(mode === "failure" ? 1 : 0);
      }),
  });
  return {
    files,
    commands,
    layer: Layer.mergeAll(filesystem(files), spawner, assetGeneratorLayer),
  };
};

describe("asset generator command boundary", () => {
  it.effect(
    "runs the resolved assets CLI and bounds iOS splash allocations below the launch-image limit",
    () =>
      Effect.gen(function* () {
        const state = generatorMemory("success", yield* image(2732));
        yield* Effect.gen(function* () {
          const generator = yield* AssetGenerator;
          yield* generator.generate(invocation);
          assert.strictEqual(state.commands.length, 1);
          assert.isTrue(
            state.commands[0][0].endsWith(
              "@capacitor/assets/bin/capacitor-assets"
            )
          );
          assert.deepStrictEqual(state.commands[0].slice(1), [
            "generate",
            "--ios",
            "--assetPath",
            "assets",
            "--splashBackgroundColor",
            "#123456",
            "--splashBackgroundColorDark",
            "#123456",
          ]);
          assert.deepStrictEqual(
            state.files.get(path.join(project, "assets/icon-only.png")),
            new Uint8Array([1])
          );
          const splashes = [...state.files].filter(([name]) =>
            /\/RadicalSplash[a-f0-9]+\.imageset\//u.test(name)
          );
          assert.strictEqual(splashes.length, 6);
          for (const [, output] of splashes) {
            const dimensions = yield* Effect.promise(() =>
              sharp(output).metadata()
            );
            assert.strictEqual(dimensions.width, 2048);
            assert.strictEqual(dimensions.height, 2048);
          }
          const storyboard = new TextDecoder().decode(
            state.files.get(
              path.join(
                project,
                "ios/App/App/Base.lproj/LaunchScreen.storyboard"
              )
            )
          );
          assert.match(
            storyboard,
            /<image name="RadicalSplash[a-f0-9]+" width="1024" height="1024"\/>/u
          );
          assert.notInclude(storyboard, 'image="Splash"');
        }).pipe(Effect.provide(state.layer));
      })
  );

  it.effect(
    "generates a square Android system splash independently of portrait drawable variants",
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
        const request: AssetGeneration = {
          ...invocation,
          platform: "android",
          assets: [{ file: "splash.png", bytes: source }],
          backgroundColor: "#241044",
        };
        const state = generatorMemory(
          "success",
          yield* Effect.promise(() =>
            sharp(source).resize(320, 480, { fit: "cover" }).png().toBuffer()
          ),
          request
        );
        yield* Effect.gen(function* () {
          const generator = yield* AssetGenerator;
          yield* generator.generate(request);
          const output = state.files.get(
            path.join(
              project,
              "android/app/src/main/res/drawable-nodpi/radical_splash_icon.png"
            )
          );
          assert.isDefined(
            output,
            "Android system splash needs a dedicated square image"
          );
          const metadata = yield* Effect.promise(() =>
            sharp(output).metadata()
          );
          assert.strictEqual(metadata.width, 1024);
          assert.strictEqual(metadata.height, 1024);
          for (const [left, top, expected] of [
            [128, 512, [255, 0, 0, 255]],
            [640, 128, [0, 255, 0, 255]],
            [384, 512, [0x24, 0x10, 0x44, 255]],
            [896, 896, [0x24, 0x10, 0x44, 255]],
          ] as const) {
            const pixel = yield* Effect.promise(() =>
              sharp(output)
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
        }).pipe(Effect.provide(state.layer));
      })
  );

  it.effect(
    "reports nonzero exits and silent missing outputs as typed generation failures",
    () =>
      Effect.gen(function* () {
        for (const mode of ["failure", "missing"] as const) {
          const state = generatorMemory(mode);
          const error = yield* Effect.gen(function* () {
            const generator = yield* AssetGenerator;
            return yield* Effect.flip(generator.generate(invocation));
          }).pipe(Effect.provide(state.layer));
          assert.strictEqual(error._tag, "AssetGenerationFailed");
          assert.include(error.message, "Native asset generation failed");
          assert.include(
            error.message,
            mode === "failure" ? "exited with code 1" : "AppIcon-512@2x.png"
          );
        }
      })
  );
});
