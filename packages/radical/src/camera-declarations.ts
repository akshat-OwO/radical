import { Effect, Schema } from "effect";

import { CameraConfigSchema } from "./camera-schema.ts";
import type { RadicalConfig } from "./config.ts";
import { InvalidConfig } from "./config.ts";

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Validate even callers that construct config directly, before modifying a project. */
export const cameraDeclarations = (config: RadicalConfig) =>
  Effect.gen(function* () {
    if (
      config.internalPlugins?.camera !== true &&
      config.internalPlugins?.videoStream !== true
    ) {
      return { android: "", ios: "" };
    }
    const video =
      config.internalPlugins?.videoStream === true
        ? yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              usageDescription: CameraConfigSchema.fields.usageDescription,
            })
          )(config.pluginOptions?.VideoStream).pipe(
            Effect.mapError(
              (error) =>
                new InvalidConfig({ message: `VideoStream: ${error.message}` })
            )
          )
        : undefined;
    const camera =
      config.internalPlugins?.camera === true
        ? yield* Schema.decodeUnknownEffect(CameraConfigSchema)(
            config.pluginOptions?.Camera
          ).pipe(
            Effect.mapError(
              (error) =>
                new InvalidConfig({ message: `Camera: ${error.message}` })
            )
          )
        : undefined;
    return {
      android:
        '<uses-permission android:name="android.permission.CAMERA" /><uses-feature android:name="android.hardware.camera" android:required="false" />',
      ios: `<key>NSCameraUsageDescription</key><string>${escape(video?.usageDescription ?? camera?.usageDescription ?? "")}</string>${camera ? `<key>NSPhotoLibraryUsageDescription</key><string>${escape(camera.photoLibraryUsageDescription)}</string>` : ""}`,
    };
  });
