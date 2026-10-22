import { Effect, FileSystem, PlatformError } from "effect";

export const metadataFile = "/app/.radical/native.json";

export const metadataMemory = (source?: string) => {
  const files = new Map<string, string>(
    source === undefined ? [] : [[metadataFile, source]]
  );

  const directories: string[] = [];

  const layer = FileSystem.layerNoop({
    makeDirectory: (directory) =>
      Effect.sync(() => {
        directories.push(directory);
      }),
    readFileString: (file) =>
      Effect.suspend(() => {
        const value = files.get(file);

        return value === undefined
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: file,
              })
            )
          : Effect.succeed(value);
      }),
    writeFileString: (file, content) =>
      Effect.sync(() => {
        files.set(file, content);
      }),
  });

  return { files, directories, layer };
};
