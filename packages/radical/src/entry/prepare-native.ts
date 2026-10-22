import { Effect } from "effect";

import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../native/shared/native-metadata.ts";
import { InvalidPlugin } from "../vite/plugins/errors.ts";

export const readCliMetadata = (root: string) =>
  NativeMetadata.pipe(
    Effect.flatMap((metadata) => metadata.read(root)),
    Effect.provide(nativeMetadataLayer)
  );

export const prepareNative = Effect.gen(function* () {
  const vite = yield* Effect.tryPromise({
    try: () => import("vite"),
    catch: (cause) => new InvalidPlugin({ message: String(cause) }),
  });
  yield* Effect.tryPromise({
    try: () => vite.resolveConfig({}, "build", "production", "production"),
    catch: (cause) => new InvalidPlugin({ message: String(cause) }),
  });
  const { config } = yield* readCliMetadata(process.cwd());
  if (config.mode === "bundled") {
    const builder = yield* Effect.tryPromise({
      try: () => vite.createBuilder({}),
      catch: (cause) => new InvalidPlugin({ message: String(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => builder.buildApp(),
      catch: (cause) =>
        new InvalidPlugin({
          message: `Cannot build bundled UI: ${String(cause)}`,
        }),
    });
  }
});
