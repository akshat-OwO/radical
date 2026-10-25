import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { NavigationSchema } from "../../../src/capabilities/sections/sections.ts";
import {
  makeSections,
  sectionOwnership,
  sectionsLayer,
  selectSection,
  setSectionBadge,
} from "../../../src/capabilities/sections/sections.ts";
import { resolveBuildPlan } from "../../../src/vite/build-plan.ts";
import { validateConfig } from "../../../src/vite/config.ts";
import { PluginModules } from "../../../src/vite/plugins/plugin-plan.ts";

const icon = { ios: "house", android: "./home.svg" };

const sections = [
  { id: "home", title: "Home", route: "/home", icon },
  { id: "settings", title: "Settings", route: "/home/settings", icon },
  { id: "inbox", title: "Inbox", route: "/inbox", icon },
];

it.effect("matches the longest path prefix at segment boundaries", () =>
  Effect.sync(() => {
    const ownership = sectionOwnership(sections);

    for (const [url, id] of [
      ["/home", "home"],
      ["/home/a", "home"],
      ["/home/settings/profile", "settings"],
      ["/home/settings-extra", "home"],
      ["/inbox/", "inbox"],
      ["/inboxes", null],
      ["/login", null],
    ]) {
      assert.strictEqual(ownership(url ?? "")?.id ?? null, id);
    }

    const withRoot = [
      { id: "root", title: "Root", route: "/", icon },
      ...sections,
    ];

    const rootOwnership = sectionOwnership(withRoot);

    assert.strictEqual(rootOwnership("/anything")?.id, "root");

    assert.strictEqual(rootOwnership("/home/settings")?.id, "settings");
  })
);

it.effect(
  "remembers exact URLs, restores inactive sections and reselects to root",
  () =>
    Effect.gen(function* () {
      const destinations: string[] = [];

      const controller = yield* makeSections(
        sections,
        { href: "/home/details?q=1#anchor", pathname: "/home/details" },
        (url) =>
          Effect.sync(() => {
            destinations.push(url);
          })
      );

      yield* controller.select("inbox");

      assert.deepStrictEqual(destinations, ["/inbox"]);

      yield* controller.update({
        href: "/inbox/message?sort=new#reply",
        pathname: "/inbox/message",
      });

      yield* controller.select("home");

      assert.strictEqual(destinations.at(-1), "/home/details?q=1#anchor");

      yield* controller.update({
        href: "/home/details?q=1#anchor",
        pathname: "/home/details",
      });

      yield* controller.select("home");

      assert.strictEqual(destinations.at(-1), "/home");

      yield* controller.update({ href: "/home", pathname: "/home" });

      yield* controller.select("inbox");

      assert.strictEqual(destinations.at(-1), "/inbox/message?sort=new#reply");
    })
);

it.effect("reports no active section on hidden or unowned routes", () =>
  Effect.gen(function* () {
    const controller = yield* makeSections(
      sections,
      { href: "/home", pathname: "/home" },
      () => Effect.void
    );

    assert.strictEqual(controller.snapshot().active?.id, "home");

    yield* controller.update(
      { href: "/home/private", pathname: "/home/private" },
      true
    );

    assert.isNull(controller.snapshot().active);

    assert.isTrue(controller.snapshot().hidden);

    yield* controller.update({ href: "/login", pathname: "/login" });

    assert.isNull(controller.snapshot().active);

    assert.isTrue(controller.snapshot().hidden);

    yield* controller.update({
      href: "/inbox/message",
      pathname: "/inbox/message",
    });

    assert.strictEqual(controller.snapshot().active?.id, "inbox");

    assert.isFalse(controller.snapshot().hidden);
  })
);

it.effect(
  "publishes ephemeral badges through the Effect service and releases subscribers",
  () =>
    Effect.gen(function* () {
      const controller = yield* makeSections(
        sections,
        { href: "/home", pathname: "/home" },
        () => Effect.void
      );

      const snapshots: unknown[] = [];

      const remove = controller.subscribe(() => {
        snapshots.push(controller.snapshot());
      });

      const layer = sectionsLayer(controller);

      for (const value of [12, "New", null]) {
        yield* setSectionBadge("home", value).pipe(Effect.provide(layer));

        assert.strictEqual(controller.snapshot().active?.badge, value);
      }

      assert.lengthOf(snapshots, 3);

      remove();

      yield* controller.setBadge("home", 1);

      assert.lengthOf(snapshots, 3);

      yield* selectSection("inbox").pipe(Effect.provide(layer));

      const fresh = yield* makeSections(
        sections,
        { href: "/home", pathname: "/home" },
        () => Effect.void
      );

      assert.isNull(fresh.snapshot().active?.badge);

      for (const value of ["12345", "", Infinity, Number.NaN]) {
        const error = yield* Effect.flip(controller.setBadge("home", value));

        assert.strictEqual(error._tag, "InvalidSection");
      }

      assert.strictEqual(
        (yield* Effect.flip(controller.select("missing")))._tag,
        "InvalidSection"
      );

      assert.strictEqual(
        (yield* Effect.flip(controller.setBadge("missing", 1)))._tag,
        "InvalidSection"
      );
    })
);

it.effect(
  "validates section counts, unique ids and routes, and names invalid fields",
  () =>
    Effect.gen(function* () {
      for (const count of [2, 3, 4, 5]) {
        const entries = Array.from({ length: count }, (_, i) => ({
          id: `s${i}`,
          title: `Section ${i}`,
          route: `/s${i}`,
          icon,
          selectedIcon: icon,
        }));

        const navigation = { sections: entries };

        assert.deepStrictEqual(
          (yield* validateConfig({ appId: "dev.test.app", navigation }))
            .navigation,
          navigation
        );
      }

      for (const entries of [
        [],
        sections.slice(0, 1),
        [...sections, ...sections],
        [sections[0], sections[0]],
      ]) {
        const error = yield* Effect.flip(
          validateConfig({
            appId: "dev.test.app",
            navigation: { sections: entries },
          })
        );

        assert.include(error.message, "sections");
      }

      for (const [field, patch] of [
        ["id", { id: " " }],
        ["title", { title: "" }],
        ["route", { route: "https://example.com" }],
        ["route", { route: "/home?x=1" }],
        ["route", { route: "/home/" }],
        ["route", { route: "/home//item" }],
        ["route", { route: "/home/." }],
        ["route", { route: "/home/../item" }],
        ["route", { route: "/home/%2e" }],
        ["route", { route: "/home/.%2E/item" }],
        ["ios", { icon: { ios: "", android: "home.svg" } }],
        ["android", { icon: { ios: "house", android: "home.png" } }],
        ["selectedIcon", { selectedIcon: { ios: "house.fill" } }],
      ] as const) {
        const error = yield* Effect.flip(
          validateConfig({
            appId: "dev.test.app",
            navigation: {
              sections: [{ ...sections[0], ...patch }, sections[2]],
            },
          })
        );

        assert.include(error.message, field);
      }

      const duplicateRoute = yield* Effect.flip(
        validateConfig({
          appId: "dev.test.app",
          navigation: {
            sections: [sections[0], { ...sections[1], route: "/home" }],
          },
        })
      );

      assert.include(duplicateRoute.message, "route");
    })
);

it.effect("exposes ordered section declarations in the build plan", () =>
  Effect.gen(function* () {
    const plan = yield* resolveBuildPlan({
      appId: "dev.test.app",
      navigation: { sections },
    }).pipe(
      Effect.provide(
        Layer.succeed(PluginModules, {
          load: () =>
            Effect.sync(() => assert.fail("Unexpected manifest load")),
        })
      )
    );

    assert.deepStrictEqual(plan.navigation, { sections });

    assert.strictEqual(plan.navigation?.sections[0]?.id, "home");
  })
);

it.effect(
  "updates route memory without notifying unchanged navigation state",
  () =>
    Effect.gen(function* () {
      const destinations: string[] = [];

      const controller = yield* makeSections(
        sections,
        { href: "/home", pathname: "/home" },
        (url) =>
          Effect.sync(() => {
            destinations.push(url);
          })
      );

      const initial = controller.snapshot();
      let notifications = 0;

      const remove = controller.subscribe(() => {
        notifications += 1;
      });

      yield* controller.update({
        href: "/home/details?last=1#anchor",
        pathname: "/home/details",
      });
      yield* controller.setBadge("home", null);
      assert.strictEqual(controller.snapshot(), initial);
      assert.strictEqual(notifications, 0);
      yield* controller.update({ href: "/inbox", pathname: "/inbox" });
      assert.strictEqual(notifications, 1);
      yield* controller.select("home");
      assert.deepStrictEqual(destinations, ["/home/details?last=1#anchor"]);
      remove();
    })
);

it.effect(
  "normalizes declarations once and retains original roots and restoration URLs",
  () =>
    Effect.gen(function* () {
      const declarations = [
        { id: "cafe", title: "Cafe", route: "/caf%C3%A9", icon },
        { id: "item", title: "Item", route: "/café/item", icon },
      ];

      const normalized: string[] = [];

      const ownership = sectionOwnership(declarations, false, (route) => {
        normalized.push(route);

        return route === "/caf%C3%A9" ? "/café" : route;
      });

      const destinations: string[] = [];

      const controller = yield* makeSections(
        declarations,
        { href: "/caf%C3%A9?q=1#anchor", pathname: "/café" },
        (url) =>
          Effect.sync(() => {
            destinations.push(url);
          }),
        false,
        ownership
      );

      assert.strictEqual(ownership("/CAFÉ/item/detail")?.id, "item");
      yield* controller.select("cafe");
      assert.deepStrictEqual(destinations, ["/caf%C3%A9"]);
      yield* controller.update({
        href: "/caf%C3%A9/item?q=2#last",
        pathname: "/café/item",
      });
      assert.strictEqual(controller.snapshot().active?.id, "item");
      yield* controller.select("cafe");
      assert.strictEqual(destinations.at(-1), "/caf%C3%A9?q=1#anchor");
      assert.deepStrictEqual(
        normalized,
        declarations.map((section) => section.route)
      );
    })
);

it.effect(
  "accepts platform bar choices, label modes and day/night ARGB colors",
  () =>
    Effect.gen(function* () {
      for (const labels of ["labeled", "selected", "unlabeled"] as const) {
        const navigation: typeof NavigationSchema.Type = {
          sections,
          bar: { ios: "web", android: "native" },
          android: {
            labels,
            colors: {
              container: "#aBcDeF",
              indicator: "#80123456",
              badge: { light: "#123456", dark: "#FFabcdef" },
              icon: {
                selected: "#123456",
                unselected: { light: "#123456", dark: "#654321" },
              },
              label: { selected: "#123456", unselected: "#654321" },
            },
          },
        };

        assert.deepStrictEqual(
          (yield* validateConfig({ appId: "dev.test.app", navigation }))
            .navigation,
          navigation
        );
      }

      const navigation: typeof NavigationSchema.Type = {
        sections,
        bar: { ios: "native", android: "web" },
      };

      assert.deepStrictEqual(
        (yield* validateConfig({ appId: "dev.test.app", navigation }))
          .navigation,
        navigation
      );
    })
);

it.effect("rejects invalid bar, labels and colors with their field path", () =>
  Effect.gen(function* () {
    const invalid: readonly (readonly [object, readonly string[]])[] = [
      [{ bar: { ios: "auto" } }, ["bar", "ios"]],
      [{ bar: { android: false } }, ["bar", "android"]],
      [{ android: { labels: "labelled" } }, ["android", "labels"]],
      ...[
        "red",
        "#123",
        "#12345G",
        "#1234567",
        "#123456789",
        "#123456\n",
        42,
      ].map(
        (container) =>
          [
            { android: { colors: { container } } },
            ["colors", "container"],
          ] as const
      ),
      [
        { android: { colors: { badge: { light: "#123456" } } } },
        ["badge", "dark"],
      ],
      [
        {
          android: {
            colors: { indicator: { light: "invalid", dark: "#123456" } },
          },
        },
        ["indicator", "light"],
      ],
      [
        { android: { colors: { icon: { selected: "#gggggg" } } } },
        ["icon", "selected"],
      ],
      [
        { android: { colors: { label: { unselected: "#123" } } } },
        ["label", "unselected"],
      ],
    ];

    for (const [options, path] of invalid) {
      const error = yield* Effect.flip(
        validateConfig({
          appId: "dev.test.app",
          navigation: { sections, ...options },
        })
      );

      assert.strictEqual(error._tag, "InvalidConfig");
      assert.include(error.message, "navigation");

      for (const field of path) {
        assert.include(error.message, field);
      }
    }
  })
);
