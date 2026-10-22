import { Context, Effect, Layer, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import type { BridgeError } from "../../core/bridge/bridge.ts";
import { Cancelled, Unavailable } from "../../core/errors.ts";
import { readNativeFile } from "../../core/native-file.ts";
import { filePickerPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import { browserFileInput } from "./browser-file-input.ts";

export interface PickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly lastModified?: number;
  /** File contents, read the same way in every runtime. */
  readonly blob: Blob;
  /** Native file URI, present only in a shell. Pass the file to `openFile` to open it externally. */
  readonly uri?: string;
}
export interface PickFilesOptions {
  /** MIME types or `type/*` patterns. All files when omitted. */
  readonly types?: readonly string[];
  readonly multiple?: boolean;
}
export type FilePickerError = Cancelled | Unavailable | BridgeError;

/** Browser resources are isolated so tests never need a device or network. */
export class BrowserFiles extends Context.Service<
  BrowserFiles,
  {
    readonly pick: (
      options: PickFilesOptions
    ) => Effect.Effect<readonly File[], Cancelled | Unavailable>;
    readonly readNative: (uri: string) => Effect.Effect<Blob, Unavailable>;
  }
>()("radical/BrowserFiles") {}

export const BrowserFilesLive = Layer.succeed(BrowserFiles, {
  pick: (options) =>
    Effect.suspend(
      (): Effect.Effect<readonly File[], Cancelled | Unavailable> =>
        typeof document === "undefined"
          ? Effect.fail(
              new Unavailable({ reason: "Files require a browser document" })
            )
          : browserFileInput(document, {
              accept: options.types?.join(","),
              multiple: options.multiple === true,
            })
    ),
  readNative: readNativeFile,
});

const fallbackType = "application/octet-stream";
/** Native pickers report unknown text fields as missing or empty. */
const present = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value;
const nameFromUri = (uri: string) =>
  uri.split(/[/?#]/u).findLast(Boolean) ?? "file";
// Capawesome rejects cancellation without a code; its message is the stable contract in 8.1.1.
const cancelled = "pickFiles canceled.";

const isCancelled = Schema.is(
  Schema.Struct({ message: Schema.Literal(cancelled) })
);
const nativeFiles = (options: PickFilesOptions) => {
  const args: NativeFileArgs = {
    limit: options.multiple === true ? 0 : 1,
    readData: false,
  };
  if (options.types !== undefined) {
    args.types = [...options.types];
  }
  return callPlugin(
    filePickerPlugin.bridge,
    "pickFiles",
    filePickerPlugin.commands.pickFiles,
    args
  ).pipe(
    Effect.catchTag(
      "BridgeCallFailed",
      (error): Effect.Effect<never, FilePickerError> =>
        isCancelled(error.cause)
          ? Effect.fail(new Cancelled({}))
          : Effect.fail(error)
    )
  );
};

/** Normalizes native and browser selections to one `PickedFile` shape. */
export const pickFiles = (options: PickFilesOptions = {}) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const browser = yield* BrowserFiles;
    if ((yield* bridge.runtime) === "browser") {
      const files = yield* browser.pick(options);
      return files.map((file): PickedFile => ({
        name: file.name,
        mimeType: file.type || fallbackType,
        size: file.size,
        lastModified: file.lastModified,
        blob: file,
      }));
    }
    const { files } = yield* nativeFiles(options);
    if (files.length === 0) {
      return yield* new Cancelled({});
    }
    return yield* Effect.all(
      files.map(({ path, ...file }) =>
        path === undefined || path === ""
          ? Effect.fail(
              new Unavailable({
                reason: `No path for picked file ${file.name ?? ""}`,
              })
            )
          : browser.readNative(path).pipe(
              Effect.map((blob): PickedFile => {
                const result: NativePickedFile = {
                  name: present(file.name) ?? nameFromUri(path),
                  mimeType:
                    present(file.mimeType) ??
                    present(blob.type) ??
                    fallbackType,
                  // The bytes read back are authoritative; native sizes may be unknown.
                  size: blob.size,
                  blob,
                  uri: path,
                };
                if (file.modifiedAt !== undefined && file.modifiedAt > 0) {
                  result.lastModified = file.modifiedAt;
                }
                return result;
              })
            )
      )
    );
  });

/** Default browser service for callers that only supply a Bridge layer. */
export const filesLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserFiles>
) => effect.pipe(Effect.provide(BrowserFilesLive));
interface NativePickedFile {
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  uri: string;
  lastModified?: number;
}
interface NativeFileArgs {
  types?: string[];
  limit: 0 | 1;
  readData: false;
}
