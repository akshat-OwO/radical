import { Effect, Queue, Schema, Stream } from "effect";

import type { BridgeError } from "../../core/bridge/bridge.ts";
import {
  Bridge,
  BridgeUnavailable,
  BridgeDecodeError,
} from "../../core/bridge/bridge.ts";
import { Unavailable } from "../../core/errors.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import { trackingSessionPlugin } from "./tracking-plugin.ts";
import {
  TrackingOptionsSchema,
  InvalidTrackingOptions,
  TrackingSessionSchema,
} from "./tracking-schema.ts";
import type { TrackingOptions, TrackingSession } from "./tracking-schema.ts";

export type TrackingError = BridgeError | Unavailable;

const { commands } = trackingSessionPlugin;

const available = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error) => error instanceof BridgeUnavailable,
      () =>
        Effect.fail(
          new Unavailable({
            reason: "Tracking sessions require a supported native shell",
          })
        )
    )
  );

export const startTrackingSession = (options: TrackingOptions) =>
  Schema.decodeUnknownEffect(TrackingOptionsSchema)(options).pipe(
    Effect.mapError(
      (cause) => new InvalidTrackingOptions({ message: String(cause) })
    ),
    Effect.flatMap((decoded) =>
      available(
        callPlugin(
          trackingSessionPlugin.bridge,
          "startTrackingSession",
          commands.startTrackingSession,
          decoded
        )
      )
    )
  );

export const getTrackingSession = available(
  callPlugin(
    trackingSessionPlugin.bridge,
    "getTrackingSession",
    commands.getTrackingSession,
    {}
  )
).pipe(Effect.map((result) => result.session));

export const stopTrackingSession = (id: string) =>
  available(
    callPlugin(
      trackingSessionPlugin.bridge,
      "stopTrackingSession",
      commands.stopTrackingSession,
      { id }
    )
  );

/** Revisions are monotonic across session replacements in the native owner. */
export const newerTrackingSnapshot = (
  current: TrackingSession | null,
  incoming: TrackingSession
) =>
  current === null || incoming.revision > current.revision ? incoming : current;

export const watchTrackingSession = Stream.unwrap(
  Effect.gen(function* () {
    const bridge = yield* Bridge;

    return Stream.callback<
      Effect.Effect<TrackingSession | null, BridgeDecodeError>,
      TrackingError,
      Bridge
    >((queue) =>
      Effect.gen(function* () {
        if (!bridge.listen) {
          return yield* new Unavailable({
            reason: "Tracking events unavailable",
          });
        }

        yield* Effect.acquireRelease(
          available(
            bridge.listen(
              trackingSessionPlugin.bridge,
              "trackingSessionChange",
              (event) => {
                Queue.offerUnsafe(
                  queue,
                  Schema.decodeUnknownEffect(
                    Schema.Struct({
                      sessionId: Schema.String,
                      revision: Schema.Int,
                      session: TrackingSessionSchema,
                    })
                  )(event).pipe(
                    Effect.map((value) => value.session),
                    Effect.mapError(
                      (cause) =>
                        new BridgeDecodeError({
                          plugin: trackingSessionPlugin.bridge,
                          method: "trackingSessionChange",
                          cause,
                        })
                    )
                  )
                );
              }
            )
          ),
          (release) => release
        ).pipe(Effect.asVoid);
        const initial = yield* getTrackingSession;
        Queue.offerUnsafe(queue, Effect.succeed(initial));

        return yield* Effect.void;
      })
    ).pipe(
      Stream.mapEffect((value) => value),
      Stream.scan<TrackingSession | null, TrackingSession | null>(
        () => null,
        (current, incoming) =>
          incoming === null ? current : newerTrackingSnapshot(current, incoming)
      ),
      Stream.changes
    );
  })
);
