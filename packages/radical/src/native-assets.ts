import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { Context, Effect, FileSystem, Layer } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import sharp from "sharp";

import { AssetGenerationFailed } from "./asset-generation-failed.ts";
import type { RadicalConfig } from "./config.ts";
import { InvalidAsset } from "./invalid-asset.ts";
import { replaceAnchor } from "./native-template.ts";
import { execute } from "./shell.ts";

export interface NativeAsset {
  readonly file: string;
  readonly bytes: Uint8Array;
}

/** Decode once before staging. Normalized PNGs give both projects the same pixels. */
export const prepareNativeAssets = (root: string, config: RadicalConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const assets: NativeAsset[] = [];
    const icon =
      typeof config.icon === "string" ? { image: config.icon } : config.icon;
    for (const entry of [
      ...(icon === undefined
        ? []
        : [{ kind: "icon", source: icon.image, size: 1024 }]),
      ...(config.splash
        ? [{ kind: "splash", source: config.splash.image, size: 2732 }]
        : []),
    ]) {
      const source = path.resolve(root, entry.source);
      const invalid = (reason: string) =>
        new InvalidAsset({
          message: `${entry.kind} asset ${source}: ${reason}`,
        });
      if (!/\.(?:png|jpe?g)$/iu.test(source)) {
        return yield* invalid("unsupported format; use PNG or JPEG");
      }
      const input = yield* fs
        .readFile(source)
        .pipe(
          Effect.mapError((cause) =>
            invalid(`cannot read file: ${cause.message}`)
          )
        );
      const image = yield* Effect.try({
        try: () => sharp(input, { failOn: "warning" }),
        catch: (cause) => invalid(`invalid image: ${String(cause)}`),
      });
      const metadata = yield* Effect.tryPromise({
        try: () => image.metadata(),
        catch: (cause) => invalid(`invalid image: ${String(cause)}`),
      });
      if (metadata.format !== "png" && metadata.format !== "jpeg") {
        return yield* invalid("unsupported image content; use PNG or JPEG");
      }
      if (
        (metadata.width ?? 0) < entry.size ||
        (metadata.height ?? 0) < entry.size ||
        metadata.width !== metadata.height
      ) {
        return yield* invalid(
          `must be square and at least ${entry.size}×${entry.size}px; got ${metadata.width}×${metadata.height}px`
        );
      }
      const background =
        entry.kind === "splash"
          ? (config.splash?.backgroundColor ?? "#ffffff")
          : (icon?.backgroundColor ?? "#ffffff");
      const bytes = yield* Effect.tryPromise({
        try: () => image.clone().flatten({ background }).png().toBuffer(),
        catch: (cause) => invalid(`cannot decode image: ${String(cause)}`),
      });
      if (entry.kind === "icon") {
        const foreground = yield* Effect.tryPromise({
          try: () => image.clone().png().toBuffer(),
          catch: (cause) =>
            invalid(`cannot decode foreground: ${String(cause)}`),
        });
        const solid = yield* Effect.tryPromise({
          try: () =>
            sharp({
              create: {
                width: metadata.width,
                height: metadata.height,
                channels: 3,
                background,
              },
            })
              .png()
              .toBuffer(),
          catch: (cause) =>
            invalid(`cannot create background: ${String(cause)}`),
        });
        assets.push(
          { file: "icon-only.png", bytes },
          { file: "icon-foreground.png", bytes: foreground },
          { file: "icon-background.png", bytes: solid }
        );
      } else {
        assets.push(
          { file: "splash.png", bytes },
          { file: "splash-dark.png", bytes }
        );
      }
    }
    return assets;
  });

export const iosSplashResourceName = (assets: readonly NativeAsset[]) => {
  const splash = assets.find(({ file }) => file === "splash.png");
  return splash
    ? `RadicalSplash${createHash("sha256").update(splash.bytes).digest("hex").slice(0, 16)}`
    : "";
};

export interface AssetGeneration {
  readonly project: string;
  readonly platform: "android" | "ios";
  readonly assets: readonly NativeAsset[];
  readonly backgroundColor: string;
}

/** Unit tests replace the command boundary, never launch the external generator. */
export class AssetGenerator extends Context.Service<
  AssetGenerator,
  {
    readonly generate: (
      input: AssetGeneration
    ) => Effect.Effect<
      void,
      AssetGenerationFailed,
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >;
  }
>()("radical/AssetGenerator") {}

/** Output contract for the pinned @capacitor/assets version, including adaptive and dark assets. */
export const assetOutputPaths = (input: AssetGeneration) => {
  const icon = input.assets.some(({ file }) => file === "icon-only.png");
  const splash = input.assets.some(({ file }) => file === "splash.png");
  if (input.platform === "ios") {
    return [
      ...(icon
        ? ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"]
        : []),
      ...(splash
        ? [1, 2, 3].flatMap((scale) =>
            ["", "-dark"].map(
              (theme) =>
                `ios/App/App/Assets.xcassets/Splash.imageset/Default@${scale}x~universal~anyany${theme}.png`
            )
          )
        : []),
    ];
  }
  const res = "android/app/src/main/res";
  const densities = ["ldpi", "mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
  return [
    ...(icon
      ? densities.flatMap((density) =>
          [
            "ic_launcher",
            "ic_launcher_round",
            "ic_launcher_foreground",
            "ic_launcher_background",
          ].map((name) => `${res}/mipmap-${density}/${name}.png`)
        )
      : []),
    ...(icon
      ? ["ic_launcher", "ic_launcher_round"].map(
          (name) => `${res}/mipmap-anydpi-v26/${name}.xml`
        )
      : []),
    ...(splash
      ? [
          "drawable",
          "drawable-night",
          ...["land", "port"].flatMap((orientation) =>
            ["", "-night"].flatMap((theme) =>
              densities.map(
                (density) => `drawable-${orientation}${theme}-${density}`
              )
            )
          ),
        ].map((dir) => `${res}/${dir}/splash.png`)
      : []),
  ];
};

export const assetGeneratorLayer = Layer.succeed(AssetGenerator, {
  generate: (input) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const assetPath = path.join(input.project, "assets");
      yield* fs.makeDirectory(assetPath, { recursive: true });
      for (const asset of input.assets) {
        yield* fs.writeFile(path.join(assetPath, asset.file), asset.bytes);
      }
      const cli = yield* Effect.try({
        try: () =>
          createRequire(path.join(input.project, "package.json")).resolve(
            "@capacitor/assets/bin/capacitor-assets"
          ),
        catch: (cause) =>
          new AssetGenerationFailed({
            message: `Cannot resolve @capacitor/assets: ${String(cause)}`,
          }),
      });
      const outputs = assetOutputPaths(input);
      for (const file of outputs) {
        yield* fs.remove(path.join(input.project, file), { force: true });
      }
      // Custom mode preserves the separate splash image. Flattening above applies its colour.
      yield* execute(
        process.execPath,
        [
          cli,
          "generate",
          `--${input.platform}`,
          "--assetPath",
          "assets",
          "--splashBackgroundColor",
          input.backgroundColor,
          "--splashBackgroundColorDark",
          input.backgroundColor,
        ],
        input.project
      );
      for (const file of outputs) {
        const output = yield* fs.readFile(path.join(input.project, file));
        if (output.length === 0) {
          return yield* new AssetGenerationFailed({
            message: `@capacitor/assets produced an empty ${file}`,
          });
        }
      }
      const splash = input.assets.find(({ file }) => file === "splash.png");
      if (input.platform === "android" && splash) {
        // Android 12 fits this drawable into a square system icon. Portrait/landscape
        // splash resources would stretch its contents when used in that slot.
        const directory = path.join(
          input.project,
          "android/app/src/main/res/drawable-nodpi"
        );
        const icon = yield* Effect.tryPromise({
          try: () => sharp(splash.bytes).resize(1024, 1024).png().toBuffer(),
          catch: (cause) =>
            new AssetGenerationFailed({
              message: `Cannot generate Android system splash: ${String(cause)}`,
            }),
        });
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFile(
          path.join(directory, "radical_splash_icon.png"),
          icon
        );
      }
      // iOS rejects launch images whose decoded allocation exceeds 25 MB.
      // The tool emits 2732px RGBA splashes (~30 MB). Bound them to 2048px (~16 MB).
      if (input.platform === "ios" && splash) {
        for (const file of outputs.filter((name) =>
          name.includes("/Splash.imageset/")
        )) {
          const filename = path.join(input.project, file);
          const source = yield* fs.readFile(filename);
          const optimized = yield* Effect.tryPromise({
            try: () =>
              sharp(source)
                .resize({
                  width: 2048,
                  height: 2048,
                  fit: "inside",
                  withoutEnlargement: true,
                })
                .png()
                .toBuffer(),
            catch: (cause) =>
              new AssetGenerationFailed({
                message: `Cannot optimize iOS launch image ${file}: ${String(cause)}`,
              }),
          });
          yield* fs.writeFile(filename, optimized);
        }
        // SplashBoard estimates allocation from the storyboard's declared @2x size too.
        const storyboard = path.join(
          input.project,
          "ios/App/App/Base.lproj/LaunchScreen.storyboard"
        );
        const splashName = iosSplashResourceName(input.assets);
        const contents = yield* replaceAnchor(
          storyboard,
          yield* fs.readFileString(storyboard),
          /<image name="Splash" width="[^"]+" height="[^"]+"\/>/u,
          `<image name="${splashName}" width="1024" height="1024"/>`
        );
        yield* fs.writeFileString(
          storyboard,
          yield* replaceAnchor(
            storyboard,
            contents,
            'image="Splash"',
            `image="${splashName}"`
          )
        );
        // UIKit caches decoded named images across same-version app reinstalls.
        // Content-derived names make regeneration invalidate that cache deterministically.
        const catalog = path.join(input.project, "ios/App/App/Assets.xcassets");
        yield* fs.rename(
          path.join(catalog, "Splash.imageset"),
          path.join(catalog, `${splashName}.imageset`)
        );
      }
      return yield* Effect.void;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AssetGenerationFailed({
            message: `Native asset generation failed: ${cause.message}`,
          })
      )
    ),
});
