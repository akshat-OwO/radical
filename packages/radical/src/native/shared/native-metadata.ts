import path from "node:path";

import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import type { PlatformError } from "effect";

import { AdapterOutputsSchema } from "../../core/adapter/adapter.ts";
import type { AdapterOutputs } from "../../core/adapter/adapter.ts";
import {
  HttpOriginSchema,
  InvalidConfig,
  RadicalConfigSchema,
} from "../../vite/config.ts";
import type { RadicalConfig } from "../../vite/config.ts";

const file = (root: string) => path.join(root, ".radical/native.json");

const NativeMetadataSchema = Schema.Struct({
  config: RadicalConfigSchema,
  url: HttpOriginSchema,
  outputs: Schema.optional(AdapterOutputsSchema),
});

type Metadata = typeof NativeMetadataSchema.Type;

type MetadataError = InvalidConfig | PlatformError.PlatformError;

const decode = (source: string) =>
  Schema.decodeEffect(Schema.fromJsonString(NativeMetadataSchema))(source).pipe(
    Effect.mapError(
      (error) =>
        new InvalidConfig({
          message: `Invalid radical config: ${error.message}`,
        })
    )
  );

export class NativeMetadata extends Context.Service<
  NativeMetadata,
  {
    readonly read: (root: string) => Effect.Effect<Metadata, MetadataError>;
    readonly update: (
      root: string,
      config: RadicalConfig,
      listeningUrl?: string,
      outputs?: AdapterOutputs
    ) => Effect.Effect<void, MetadataError>;
  }
>()("radical/NativeMetadata") {}

export const nativeMetadataLayer = Layer.effect(
  NativeMetadata,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const read = (root: string) =>
      fs.readFileString(file(root)).pipe(Effect.flatMap(decode));

    return NativeMetadata.of({
      read,
      update: (root, config, listeningUrl, outputs) =>
        Effect.gen(function* () {
          // Config resolution can run before the dev server has selected a port.
          const selectedUrl = listeningUrl ?? config.origin;

          const previous =
            selectedUrl === undefined || outputs === undefined
              ? yield* read(root).pipe(
                  Effect.catchIf(
                    (error) =>
                      error._tag === "InvalidConfig" ||
                      (error._tag === "PlatformError" &&
                        error.reason._tag === "NotFound"),
                    () => Effect.void
                  )
                )
              : undefined;

          const url = selectedUrl ?? previous?.url;

          if (url === undefined) {
            return;
          }

          const source = JSON.stringify({
            config,
            url,
            outputs: outputs ?? previous?.outputs,
          });

          yield* decode(source);
          yield* fs.makeDirectory(path.dirname(file(root)), {
            recursive: true,
          });
          yield* fs.writeFileString(file(root), source);
        }),
    });
  })
);
