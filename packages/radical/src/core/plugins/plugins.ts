import { Effect, Option, Schema } from "effect";

import type { BridgeError } from "../bridge/bridge.ts";
import { Bridge, BridgeDecodeError } from "../bridge/bridge.ts";

const identifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/u)
);

const codec = Schema.declare<Schema.Codec<unknown, unknown>>(
  (u): u is Schema.Codec<unknown, unknown> => Schema.isSchema(u)
);

const dependency = Schema.Record(
  Schema.String.check(
    Schema.isPattern(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_][a-z0-9_.-]*$/u)
  ),
  Schema.NonEmptyString
);

const gradleDependencies = Schema.Record(
  Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/u)),
  Schema.NonEmptyString
);

const source = Schema.Struct({
  file: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
});

export const CommandSchema = Schema.Struct({
  args: codec,
  result: codec,
  errors: Schema.Record(identifier, codec),
});

export const PluginManifestSchema = Schema.Struct({
  id: identifier,
  bridge: identifier,
  dependencies: dependency,
  commands: Schema.Record(identifier, CommandSchema),
  config: Schema.optional(
    Schema.Struct({ selector: Schema.NonEmptyString, schema: codec })
  ),
  android: Schema.optional(
    Schema.Struct({
      className: Schema.String.check(
        Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/u)
      ),
      sources: Schema.Array(source),
      dependencies: gradleDependencies,
    })
  ),
  ios: Schema.optional(
    Schema.Struct({
      className: identifier,
      sources: Schema.Array(source),
      dependencies: Schema.Array(
        Schema.Struct({
          url: Schema.String.check(
            Schema.makeFilter((url) => URL.canParse(url)),
            Schema.isPattern(/^https:\/\/[^\s"\\]+$/u)
          ),
          version: Schema.String,
          product: identifier,
        })
      ),
    })
  ),
});

export type PluginManifest = typeof PluginManifestSchema.Type;

/** Preserve concrete command codecs for client inference. Validation happens before generation. */
export const definePlugin = <const M extends PluginManifest>(manifest: M): M =>
  manifest;

type Command = typeof CommandSchema.Type;

type ClientCommand<C extends Command> = (
  args: C["args"]["Type"]
) => Effect.Effect<
  C["result"]["Type"],
  C["errors"][keyof C["errors"]]["Type"] | BridgeError,
  Bridge
>;

export type PluginClient<M extends PluginManifest> = {
  readonly [K in keyof M["commands"]]: ClientCommand<M["commands"][K]>;
};

const decodeRejection = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.String,
    data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  })
);

export const callPlugin = <C extends Command>(
  plugin: string,
  method: string,
  command: C,
  args: C["args"]["Type"]
): ReturnType<ClientCommand<C>> =>
  Effect.gen(function* () {
    const options = yield* Schema.encodeUnknownEffect(command.args)(args).pipe(
      Effect.mapError(
        (cause) => new BridgeDecodeError({ plugin, method, cause })
      )
    );

    const bridge = yield* Bridge;

    const result = yield* bridge
      .call(
        plugin,
        method,
        yield* Schema.decodeUnknownEffect(
          Schema.Record(Schema.String, Schema.Unknown)
        )(options).pipe(
          Effect.mapError(
            (cause) => new BridgeDecodeError({ plugin, method, cause })
          )
        )
      )
      .pipe(
        Effect.catchTag("BridgeCallFailed", (error) => {
          const envelope = decodeRejection(error.cause);

          if (Option.isNone(envelope)) {
            return Effect.fail(error);
          }

          const { code, data = {} } = envelope.value;

          const schema = Object.hasOwn(command.errors, code)
            ? command.errors[code]
            : undefined;

          if (!schema) {
            return Effect.fail(error);
          }

          return Schema.decodeUnknownEffect(schema)({
            ...data,
            _tag: code,
          }).pipe(
            Effect.matchEffect({
              onFailure: () => Effect.fail(error),
              onSuccess: (declared) => Effect.fail(declared),
            })
          );
        })
      );

    return yield* Schema.decodeUnknownEffect(command.result)(result).pipe(
      Effect.mapError(
        (cause) => new BridgeDecodeError({ plugin, method, cause })
      )
    );
  });

// SAFETY: Every command key maps to a closure with its original args, result and error codecs.
// oxlint-disable typescript/no-unsafe-type-assertion -- Object entries preserve command keys and their codecs.
export const createPluginClient = <M extends PluginManifest>(
  manifest: M
): PluginClient<M> =>
  Object.fromEntries(
    Object.entries(manifest.commands).map(([name, command]) => [
      name,
      (args: typeof command.args.Type) =>
        callPlugin(manifest.bridge, name, command, args),
    ])
  ) as PluginClient<M>;
