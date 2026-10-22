import { Data, Effect, Schema } from "effect";
import { valid, validRange } from "semver";

export class InvalidReleaseVersion extends Data.TaggedError(
  "InvalidReleaseVersion"
)<{
  readonly input: string;
}> {}

interface ReleaseMetadata {
  readonly version: string;
  readonly tag: string;
  readonly dist_tag: string;
  readonly is_prerelease: boolean;
  readonly make_latest: boolean;
}

export const resolveRelease = (
  input: string
): Effect.Effect<ReleaseMetadata, InvalidReleaseVersion> => {
  const candidate = input.replace(/^v/u, "");
  const version = valid(candidate);

  const channel = candidate.includes("-")
    ? candidate.slice(candidate.indexOf("-") + 1).split(".")[0]
    : undefined;

  if (
    version === null ||
    version !== candidate ||
    candidate.includes("+") ||
    (channel !== undefined &&
      (channel === "latest" ||
        validRange(channel) !== null ||
        !/^[a-zA-Z][a-zA-Z0-9-]*$/u.test(channel)))
  ) {
    return Effect.fail(new InvalidReleaseVersion({ input }));
  }

  return Effect.succeed({
    version,
    tag: `v${version}`,
    dist_tag: channel ?? "latest",
    is_prerelease: channel !== undefined,
    make_latest: channel === undefined,
  });
};

const Manifest = Schema.Struct({
  name: Schema.Literal("@akshatowo/radical"),
  version: Schema.String,
});

/** Preserve dependencies and package metadata while validating the release target. */
export const stampManifest = (source: string, input: string) =>
  Effect.gen(function* () {
    const release = yield* resolveRelease(input);

    const manifest = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
    )(source);

    yield* Schema.decodeUnknownEffect(Manifest)(manifest);

    return `${JSON.stringify({ ...manifest, version: release.version }, null, 2)}\n`;
  });
