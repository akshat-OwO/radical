// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import {
  radicalFetch,
  RadicalFetchEnvironment,
} from "../../src/core/bundled/bundled-request.ts";
import { browserContext } from "../../src/core/context/browser-context.ts";
import {
  APP_UPDATE_HEADER,
  createAppUpdateStore,
} from "../../src/core/update/app-update.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import {
  AppUpdateBoundary,
  AppUpdateProvider,
  AppUpdateScreen,
  useAppUpdate,
} from "../../src/react/use-app-update.ts";

it.effect(
  "a bundled 426 updates useAppUpdate and replaces the route with an intents-powered screen",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = createAppUpdateStore();
        const target = document.createElement("div");
        const root = createRoot(target);
        let opened: string | undefined;
        let status: string | undefined;

        const layer = bridgeTestLayer("android", (plugin, method, args) =>
          Effect.sync(() => {
            assert.strictEqual(plugin, "AppLauncher");
            assert.strictEqual(method, "openUrl");
            opened = String(args.url);

            return { completed: true };
          })
        );

        const Probe = () => {
          const { status: nextStatus } = useAppUpdate(store);
          useLayoutEffect(() => {
            status = nextStatus;
          }, [nextStatus]);

          return createElement(
            AppUpdateBoundary,
            { store },
            createElement("p", null, "normal route")
          );
        };

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );
        flushSync(() => {
          root.render(
            createElement(RadicalProvider, { layer }, createElement(Probe))
          );
        });
        assert.strictEqual(status, "unknown");
        assert.include(target.textContent, "normal route");

        const storeUrl =
          "https://play.google.com/store/apps/details?id=dev.app.test";

        const transport = Layer.succeed(RadicalFetchEnvironment, {
          page: Effect.succeed("https://localhost/"),
          context: Effect.succeed(browserContext()),
          fetch: () =>
            Effect.succeed(
              Response.json(
                { status: "required", storeUrl },
                { status: 426, headers: { [APP_UPDATE_HEADER]: "1" } }
              )
            ),
        });

        yield* radicalFetch(
          { mode: "bundled", origin: "https://api.example" },
          "/api",
          undefined,
          store
        ).pipe(Effect.provide(transport));
        flushSync(() => {
          root.render(
            createElement(RadicalProvider, { layer }, createElement(Probe))
          );
        });
        assert.strictEqual(status, "required");
        assert.notInclude(target.textContent, "normal route");
        assert.include(target.textContent, "Update required");
        const button = target.querySelector("button");
        assert.isNotNull(button);
        flushSync(() => {
          button.click();
        });
        yield* Effect.yieldNow;
        assert.strictEqual(opened, storeUrl);
      })
    )
);

it.effect(
  "SSR uses request-scoped update state without leaking it to another request or the client store",
  () =>
    Effect.sync(() => {
      const layer = bridgeTestLayer("browser", () =>
        Effect.sync(() => assert.fail("SSR called the bridge"))
      );

      const store = createAppUpdateStore();

      const render = (status: "required" | "current") =>
        renderToString(
          createElement(
            RadicalProvider,
            { layer },
            createElement(
              AppUpdateProvider,
              { initialState: { status, storeUrl: null } },
              createElement(
                AppUpdateBoundary,
                { store },
                createElement("p", null, "normal route")
              )
            )
          )
        );

      assert.include(render("required"), "Update required");
      assert.include(render("current"), "normal route");
      assert.strictEqual(store.snapshot().status, "unknown");
      assert.include(
        renderToString(
          createElement(
            RadicalProvider,
            { layer },
            createElement(AppUpdateScreen, { store })
          )
        ),
        "Check the App Store"
      );
    })
);
