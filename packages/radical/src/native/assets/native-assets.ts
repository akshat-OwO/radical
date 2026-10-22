import { createHash } from "node:crypto";
import path from "node:path";

import { Context, Effect, FileSystem, Layer, Predicate } from "effect";
import sharp from "sharp";

import type { RadicalConfig } from "../../vite/config.ts";
import { AssetGenerationFailed, InvalidAsset } from "./errors.ts";

export interface NativeAsset {
  readonly file: string;
  readonly bytes: Uint8Array;
}

/** Decode once before staging. Normalized PNGs give both projects the same pixels. */
export const prepareNativeAssets = (root: string, config: RadicalConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const assets: NativeAsset[] = [];
    const icon = Predicate.isString(config.icon)
      ? { image: config.icon }
      : config.icon;
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

/** Change UIKit's launch-image cache key whenever the prepared splash changes. */
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

/** The filesystem boundary lets tests inspect every encoded output in memory. */
export class AssetGenerator extends Context.Service<
  AssetGenerator,
  {
    readonly generate: (
      input: AssetGeneration
    ) => Effect.Effect<void, AssetGenerationFailed, FileSystem.FileSystem>;
  }
>()("radical/AssetGenerator") {}

interface ImageOutput {
  readonly files: readonly string[];
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly style?: "legacy" | "round" | "monochrome";
}

const androidRes = "android/app/src/main/res";
const iosCatalog = "ios/App/App/Assets.xcassets";
const densities = [
  { name: "ldpi", icon: 36, land: [320, 240], port: [240, 320] },
  { name: "mdpi", icon: 48, land: [480, 320], port: [320, 480] },
  { name: "hdpi", icon: 72, land: [800, 480], port: [480, 800] },
  { name: "xhdpi", icon: 96, land: [1280, 720], port: [720, 1280] },
  { name: "xxhdpi", icon: 144, land: [1600, 960], port: [960, 1600] },
  { name: "xxxhdpi", icon: 192, land: [1920, 1280], port: [1280, 1920] },
] as const;

const adaptiveIcon = (
  monochrome: boolean
) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/ic_launcher_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>${
      monochrome
        ? `
    <monochrome>
        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%" />
    </monochrome>`
        : ""
    }
</adaptive-icon>`;

/** One encode can supply several appearances or scales with identical pixels. */
const imageOutputs = (input: AssetGeneration): ImageOutput[] => {
  const outputs: ImageOutput[] = [];
  const icon = input.assets.some(({ file }) => file === "icon-only.png");
  const splash = input.assets.some(({ file }) => file === "splash.png");
  if (input.platform === "ios") {
    if (icon) {
      outputs.push({
        files: [`${iosCatalog}/AppIcon.appiconset/AppIcon-512@2x.png`],
        source: "icon-only.png",
        width: 1024,
        height: 1024,
      });
    }
    if (splash) {
      for (const theme of ["", "-dark"]) {
        outputs.push({
          files: [1, 2, 3].map(
            (scale) =>
              `${iosCatalog}/${iosSplashResourceName(input.assets)}.imageset/Default@${scale}x~universal~anyany${theme}.png`
          ),
          source: `splash${theme}.png`,
          // Keep decoded launch-image allocations below iOS's 25 MB limit.
          width: 2048,
          height: 2048,
        });
      }
    }
    return outputs;
  }
  if (icon) {
    for (const density of densities) {
      for (const [name, source, style] of [
        ["ic_launcher", "icon-only.png", "legacy"],
        ["ic_launcher_round", "icon-only.png", "round"],
        ["ic_launcher_foreground", "icon-foreground.png", undefined],
        ["ic_launcher_background", "icon-background.png", undefined],
        ["ic_launcher_monochrome", "icon-foreground.png", "monochrome"],
      ] as const) {
        outputs.push({
          files: [`${androidRes}/mipmap-${density.name}/${name}.png`],
          source,
          width: density.icon,
          height: density.icon,
          style,
        });
      }
    }
  }
  if (splash) {
    outputs.push({
      files: [`${androidRes}/drawable-nodpi/radical_splash_icon.png`],
      source: "splash.png",
      width: 1024,
      height: 1024,
    });
    for (const theme of ["", "-night"]) {
      const source = theme === "" ? "splash.png" : "splash-dark.png";
      outputs.push({
        files: [`${androidRes}/drawable${theme}/splash.png`],
        source,
        width: 320,
        height: theme === "" ? 480 : 240,
      });
      for (const orientation of ["land", "port"] as const) {
        for (const density of densities) {
          const [width, height] = density[orientation];
          outputs.push({
            files: [
              `${androidRes}/drawable-${orientation}${theme}-${density.name}/splash.png`,
            ],
            source,
            width,
            height,
          });
        }
      }
    }
  }
  return outputs;
};

const encodeImage = (bytes: Uint8Array, output: ImageOutput) =>
  Effect.gen(function* () {
    const { width, height, style } = output;
    if (style === "legacy") {
      // Preserve the baseline's eight-pixel transparent border at each density.
      return yield* Effect.tryPromise({
        try: () =>
          sharp(bytes)
            .resize(width - 16, height - 16)
            .extend({
              top: 8,
              bottom: 8,
              left: 8,
              right: 8,
              background: "#00000000",
            })
            .png()
            .toBuffer(),
        catch: (cause) =>
          new AssetGenerationFailed({
            message: `Cannot encode ${output.files[0]}: ${String(cause)}`,
          }),
      });
    }
    const resized = yield* Effect.tryPromise({
      try: () => sharp(bytes).resize(width, height).png().toBuffer(),
      catch: (cause) =>
        new AssetGenerationFailed({
          message: `Cannot resize ${output.files[0]}: ${String(cause)}`,
        }),
    });
    if (style === undefined) {
      return resized;
    }
    return yield* Effect.tryPromise({
      try: () =>
        style === "round"
          ? sharp(resized)
              .ensureAlpha()
              .composite([
                {
                  input: Buffer.from(
                    `<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}" fill="white"/></svg>`
                  ),
                  blend: "dest-in",
                },
              ])
              .png()
              .toBuffer()
          : sharp(resized)
              .ensureAlpha()
              .linear([0, 0, 0, 1], [0, 0, 0, 0])
              .png()
              .toBuffer(),
      catch: (cause) =>
        new AssetGenerationFailed({
          message: `Cannot mask ${output.files[0]}: ${String(cause)}`,
        }),
    });
  });

export const assetGeneratorLayer = Layer.succeed(AssetGenerator, {
  generate: (input) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const write = (file: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const destination = path.join(input.project, file);
          yield* fs.makeDirectory(path.dirname(destination), {
            recursive: true,
          });
          yield* fs.writeFile(destination, bytes);
        });
      const text = (file: string, contents: string) =>
        write(file, new TextEncoder().encode(contents));
      const icon = input.assets.some(({ file }) => file === "icon-only.png");
      const splash = input.assets.some(({ file }) => file === "splash.png");
      if (input.platform === "ios" && splash) {
        const catalog = path.join(input.project, iosCatalog);
        if (yield* fs.exists(catalog)) {
          const current = `${iosSplashResourceName(input.assets)}.imageset`;
          for (const name of yield* fs.readDirectory(catalog)) {
            if (
              /^RadicalSplash[0-9a-f]+\.imageset$/u.test(name) &&
              name !== current
            ) {
              yield* fs.remove(path.join(catalog, name), { recursive: true });
            }
          }
        }
      }
      yield* Effect.forEach(
        imageOutputs(input),
        (output) =>
          Effect.gen(function* () {
            const source =
              input.assets.find(({ file }) => file === output.source) ??
              input.assets.find(
                ({ file }) =>
                  file === "splash.png" && output.source === "splash-dark.png"
              );
            if (!source) {
              return yield* new AssetGenerationFailed({
                message: `Missing native asset source ${output.source}`,
              });
            }
            const bytes = yield* encodeImage(source.bytes, output);
            yield* Effect.forEach(output.files, (file) => write(file, bytes), {
              discard: true,
            });
            return yield* Effect.void;
          }),
        { concurrency: 4, discard: true }
      );
      if (input.platform === "android" && icon) {
        for (const version of [26, 33]) {
          for (const name of ["ic_launcher", "ic_launcher_round"]) {
            yield* text(
              `${androidRes}/mipmap-anydpi-v${version}/${name}.xml`,
              adaptiveIcon(version === 33)
            );
          }
        }
      }
      if (input.platform === "ios") {
        const info = { author: "xcode", version: 1 };
        if (icon) {
          yield* text(
            `${iosCatalog}/AppIcon.appiconset/Contents.json`,
            JSON.stringify({
              images: [
                {
                  idiom: "universal",
                  size: "1024x1024",
                  filename: "AppIcon-512@2x.png",
                  platform: "ios",
                },
              ],
              info,
            })
          );
        }
        if (splash) {
          yield* text(
            `${iosCatalog}/${iosSplashResourceName(input.assets)}.imageset/Contents.json`,
            JSON.stringify({
              images: ["", "-dark"].flatMap((theme) =>
                [1, 2, 3].map((scale) => {
                  const image: SplashImage = {
                    idiom: "universal",
                    filename: `Default@${scale}x~universal~anyany${theme}.png`,
                    scale: `${scale}x`,
                  };
                  if (theme) {
                    image.appearances = [
                      { appearance: "luminosity", value: "dark" },
                    ];
                  }
                  return image;
                })
              ),
              info,
            })
          );
        }
      }
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AssetGenerationFailed({
            message: `Native asset generation failed: ${cause.message}`,
          })
      )
    ),
});
interface SplashImage {
  idiom: string;
  filename: string;
  scale: string;
  appearances?: { appearance: string; value: string }[];
}
