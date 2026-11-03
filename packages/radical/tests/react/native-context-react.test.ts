// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { browserContext } from "../../src/core/context/browser-context.ts";
import type { NativeContext } from "../../src/core/context/native-context.ts";
import { useNativeContext as useEffectContext } from "../../src/effect/react.ts";
import { RadicalProvider, useNativeContext } from "../../src/plain/react.ts";

it.effect(
  "hydrates prerendered /about with browser context before publishing shell context",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initial = browserContext();

        const live: NativeContext = {
          ...initial,
          platform: "ios",
          shellVersion: "1",
        };

        const target = window;

        const previous = new Map(
          ["__radicalNativeContext", "__radicalMounted"].map(
            (key) =>
              [key, Object.getOwnPropertyDescriptor(target, key)] as const
          )
        );

        const style = document.documentElement.style.cssText;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            document.documentElement.style.cssText = style;

            for (const key of [
              "__radicalNativeContext",
              "__radicalMounted",
            ] as const) {
              const descriptor = previous.get(key);

              if (descriptor === undefined) {
                Reflect.deleteProperty(target, key);
              } else {
                Object.defineProperty(target, key, descriptor);
              }
            }
          })
        );
        Object.defineProperty(target, "__radicalNativeContext", {
          value: live,
          configurable: true,
        });
        Object.defineProperty(target, "__radicalMounted", {
          value: false,
          writable: true,
          configurable: true,
        });
        const completed = yield* Deferred.make<boolean>();
        const commits: NativeContext[] = [];
        const errors: unknown[] = [];

        const Probe = () => {
          const context = useNativeContext();
          const effectContext = useEffectContext();
          assert.strictEqual(context, effectContext);
          useLayoutEffect(() => {
            commits.push(context);

            if (context.platform === "ios") {
              Effect.runSync(Deferred.succeed(completed, true));
            }
          }, [context]);

          return createElement("p", null, `/about: ${context.platform}`);
        };

        const app = createElement(
          RadicalProvider,
          {
            nativeContext: initial,
            mode: "bundled",
          },
          createElement(Probe)
        );

        const html = renderToString(app);
        assert.strictEqual(html, "<p>/about: browser</p>");
        const container = document.createElement("div");
        container.innerHTML = html;

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
        yield* Effect.yieldNow;
        assert.deepStrictEqual(commits[0], initial);
        assert.deepStrictEqual(commits.at(-1), live);
        assert.strictEqual(container.textContent, "/about: ios");
        assert.isEmpty(errors);
      })
    )
);
