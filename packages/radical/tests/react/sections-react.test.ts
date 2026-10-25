// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { makeSections } from "../../src/capabilities/sections/sections.ts";
import {
  SectionsProvider,
  useSections,
  useSectionsEffect,
} from "../../src/react/use-sections.ts";

const sections = [
  {
    id: "home",
    title: "Home",
    route: "/home",
    icon: { ios: "house", android: "home.svg" },
  },
  {
    id: "inbox",
    title: "Inbox",
    route: "/inbox",
    icon: { ios: "tray", android: "inbox.svg" },
  },
];

const EmptyProbe = () => {
  const { sections: entries, active, hidden } = useSections();

  return createElement(
    "pre",
    null,
    JSON.stringify({ sections: entries, active, hidden })
  );
};

it.effect(
  "renders unconfigured sections as hidden during server rendering",
  () =>
    Effect.sync(() => {
      assert.strictEqual(
        renderToString(createElement(EmptyProbe)),
        "<pre>{&quot;sections&quot;:[],&quot;active&quot;:null,&quot;hidden&quot;:true}</pre>"
      );
    })
);

it.effect(
  "hydrates shared section state and updates both plain and Effect hooks",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const controller = yield* makeSections(
          sections,
          "/inbox/message",
          () => Effect.void
        );

        const mounted = yield* Deferred.make<boolean>();

        const commits: string[] = [];

        const Probe = () => {
          const plain = useSections();

          const effect = useSectionsEffect();

          const text = `${plain.active?.id}:${plain.active?.badge}:${effect.active?.badge}:${plain.hidden}`;
          useLayoutEffect(() => {
            commits.push(text);
            Effect.runSync(Deferred.succeed(mounted, true));
          }, [text]);

          return createElement("pre", null, text);
        };

        const app = createElement(
          SectionsProvider,
          { controller },
          createElement(Probe)
        );

        const html = renderToString(app);

        const container = document.createElement("div");
        container.innerHTML = html;

        const errors: unknown[] = [];

        const root = flushSync(() =>
          hydrateRoot(container, app, {
            onRecoverableError: (error) => {
              errors.push(error);
            },
          })
        );

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            flushSync(() => {
              root.unmount();
            });
          })
        );

        yield* Deferred.await(mounted);

        assert.deepStrictEqual(commits, ["inbox:null:null:false"]);

        assert.strictEqual(container.innerHTML, html);

        flushSync(() => {
          Effect.runSync(controller.setBadge("inbox", "New"));
        });

        assert.strictEqual(container.textContent, "inbox:New:New:false");

        flushSync(() => {
          Effect.runSync(controller.update("/login"));
        });

        assert.strictEqual(
          container.textContent,
          "undefined:undefined:undefined:true"
        );

        assert.isEmpty(errors);
      })
    )
);
