import { Effect, Queue } from "effect";
import type { Layer } from "effect";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Bridge } from "./bridge.ts";
import { Unavailable } from "./camera-schema.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import { BridgeContext } from "./use-bridge-effect.ts";
import { startVideoStream, videoStreamLive } from "./video-stream.ts";
import type {
  CameraFacing,
  VideoStreamError,
  VideoStreamInfo,
  VideoStreamSession,
} from "./video-stream.ts";

type Control =
  | { readonly kind: "switch" }
  | { readonly kind: "zoom"; readonly level: number }
  | { readonly kind: "torch"; readonly enabled: boolean };
export interface VideoStreamState {
  readonly running: boolean;
  readonly loading: boolean;
  readonly value: VideoStreamInfo | undefined;
  readonly error: VideoStreamError | undefined;
  readonly start: () => void;
  readonly stop: () => void;
  readonly switchCamera: () => void;
  readonly setZoom: (level: number) => void;
  readonly setTorch: (enabled: boolean) => void;
}
const controlEffect = (session: VideoStreamSession, command: Control) => {
  if (command.kind === "switch") {
    return session.switchCamera;
  }
  if (command.kind === "zoom") {
    return session.setZoom(command.level);
  }
  return session.setTorch(command.enabled);
};
interface HookOptions {
  readonly viewfinder: RefObject<HTMLElement | null>;
  readonly facing?: CameraFacing;
  readonly onDetect?: (value: string) => void;
}
interface Owner {
  readonly layer: Layer.Layer<Bridge>;
  live: boolean;
  queue: Queue.Queue<Control> | null;
}
const streamAction = (
  callbacks: RefObject<HookOptions>,
  owner: Owner,
  setValue: (value: VideoStreamInfo | undefined) => void,
  setControlError: (error: VideoStreamError | undefined) => void
) =>
  videoStreamLive(
    Effect.scoped(
      Effect.gen(function* () {
        const viewfinder = callbacks.current.viewfinder.current;
        if (!viewfinder) {
          return yield* new Unavailable({
            reason: "Mount the viewfinder before starting",
          });
        }
        const queue = yield* Queue.unbounded<Control>();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            owner.queue = null;
            if (owner.live) {
              setValue(undefined);
              setControlError(undefined);
            }
          })
        );
        const session = yield* startVideoStream({
          viewfinder,
          facing: callbacks.current.facing,
          onDetect: (code) => {
            if (owner.live) {
              callbacks.current.onDetect?.(code);
            }
          },
        });
        owner.queue = queue;
        yield* session.info.pipe(
          Effect.tap((info) =>
            Effect.sync(() => {
              if (owner.live) {
                setValue(info);
                setControlError(undefined);
              }
            })
          )
        );
        return yield* Effect.forever(
          Queue.take(queue).pipe(
            Effect.flatMap((command) => controlEffect(session, command)),
            Effect.andThen(session.info),
            Effect.match({
              onSuccess: (info) => {
                if (owner.live) {
                  setValue(info);
                  setControlError(undefined);
                }
              },
              onFailure: (failure) => {
                if (owner.live) {
                  setControlError(failure);
                }
              },
            })
          )
        );
      })
    )
  );
export const useVideoStream = (options: HookOptions): VideoStreamState => {
  const layer = useContext(BridgeContext);
  const active = useRef<Owner>({ layer, live: false, queue: null });
  useEffect(() => {
    const owner: Owner = { layer, live: true, queue: null };
    active.current = owner;
    return () => {
      owner.live = false;
      owner.queue = null;
    };
  }, [layer]);
  const { run, cancel, loading, error } = useBridgeAction<
    undefined,
    VideoStreamError
  >();
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  }, [options]);
  const [snapshot, setSnapshot] = useState<{
    layer: Layer.Layer<Bridge>;
    value: VideoStreamInfo | undefined;
    error: VideoStreamError | undefined;
  }>({ layer, value: undefined, error: undefined });
  const value = snapshot.layer === layer ? snapshot.value : undefined;
  const controlError = snapshot.layer === layer ? snapshot.error : undefined;
  const start = useCallback(() => {
    const owner = active.current;
    run(
      streamAction(
        callbacks,
        owner,
        (info) => {
          setSnapshot((previous) => ({
            layer,
            value: info,
            error: previous.layer === layer ? previous.error : undefined,
          }));
        },
        (failure) => {
          setSnapshot((previous) => ({
            layer,
            value: previous.layer === layer ? previous.value : undefined,
            error: failure,
          }));
        }
      )
    );
  }, [run, layer]);
  const send = useCallback(
    (command: Control) => {
      const owner = active.current;
      if (owner.live && owner.layer === layer && owner.queue) {
        Effect.runSync(Queue.offer(owner.queue, command));
      }
    },
    [layer]
  );
  return {
    running: value !== undefined,
    loading: loading && value === undefined,
    value,
    error: error ?? controlError,
    start,
    stop: cancel,
    switchCamera: useCallback(() => {
      send({ kind: "switch" });
    }, [send]),
    setZoom: useCallback(
      (level) => {
        send({ kind: "zoom", level });
      },
      [send]
    ),
    setTorch: useCallback(
      (enabled) => {
        send({ kind: "torch", enabled });
      },
      [send]
    ),
  };
};
