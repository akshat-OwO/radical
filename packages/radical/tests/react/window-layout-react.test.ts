// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { windowLayoutStyle } from "../../src/capabilities/window-layout/window-layout-style.ts";
import { Bridge } from "../../src/core/bridge/bridge.ts";
import type {
  NativeContext,
  WindowLayout,
} from "../../src/core/context/native-context.ts";
import { RadicalProvider, useWindowLayout } from "../../src/react/react.ts";

const render = (style: ReturnType<typeof windowLayoutStyle>) =>
  renderToString(createElement("html", { style }));

it.effect(
  "hydrates the server layout before applying the replayed live layout and cleans up",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initial: WindowLayout = {
          widthClass: "expanded",
          posture: "book",
          hinge: { x: 400, y: 0, width: 10, height: 800 },
        };

        const live: WindowLayout = {
          widthClass: "compact",
          posture: "flat",
          hinge: null,
        };

        const nativeContext: NativeContext = {
          platform: "android",
          shellVersion: "1",
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
          windowLayout: initial,
        };

        const commits: WindowLayout[] = [];
        const completed = yield* Deferred.make<boolean>();
        const removed = yield* Deferred.make<boolean>();

        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("android" as const),
          call: () => Effect.never,
          observe: (_event, receive) =>
            Effect.sync(() => {
              receive(live);

              return () => {
                Effect.runSync(Deferred.succeed(removed, true));
              };
            }),
        });

        const Probe = () => {
          const layout = useWindowLayout();
          useLayoutEffect(() => {
            commits.push(layout);

            if (layout === live) {
              Effect.runSync(Deferred.succeed(completed, true));
            }
          }, [layout]);

          return createElement("pre", null, JSON.stringify(layout));
        };

        const app = createElement(
          RadicalProvider,
          { layer, nativeContext },
          createElement(Probe)
        );

        const html = renderToString(app);
        const container = document.createElement("div");
        container.innerHTML = html;
        const errors: unknown[] = [];

        const root = hydrateRoot(container, app, {
          onRecoverableError: (error) => {
            errors.push(error);
          },
        });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );
        yield* Deferred.await(completed);
        assert.deepStrictEqual(commits[0], initial);
        assert.strictEqual(
          html,
          renderToString(createElement("pre", null, JSON.stringify(commits[0])))
        );
        assert.deepStrictEqual(commits.at(-1), live);
        assert.isEmpty(errors);
        flushSync(() => {
          root.unmount();
        });
        assert.isTrue(yield* Deferred.await(removed));
      })
    )
);

it.effect(
  "keeps bundled hinge CSS identical during prerender and first client render",
  () =>
    Effect.sync(() => {
      const context: NativeContext = {
        platform: "android",
        shellVersion: "1",
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        windowLayout: {
          widthClass: "expanded",
          posture: "book",
          hinge: { x: 400, y: 0, width: 10, height: 800 },
        },
      };

      assert.strictEqual(
        render(windowLayoutStyle(undefined, "bundled")),
        render(windowLayoutStyle(context, "bundled"))
      );
      assert.strictEqual(
        windowLayoutStyle(context)["--radical-hinge-x"],
        "400px"
      );
    })
);
