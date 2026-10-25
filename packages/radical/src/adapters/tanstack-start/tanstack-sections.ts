import { trimPathRight } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";
import { Effect, Fiber, Schema } from "effect";
import { createElement, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import {
  makeSections,
  sectionOwnership,
} from "../../capabilities/sections/sections.ts";
import type { Section } from "../../capabilities/sections/sections.ts";
import { Bridge } from "../../core/bridge/bridge.ts";
import { BridgeContext } from "../../react/use-bridge-effect.ts";
import { SectionsProvider } from "../../react/use-sections.ts";
import { tanstackNavigation } from "./tanstack-navigation.ts";
import { sectionOwnerships } from "./tanstack-section-ownership.ts";

const selection = Schema.is(Schema.Struct({ id: Schema.String }));

const routeHidden = (router: AnyRouter, pathname: string) =>
  router
    .matchRoutes(pathname)
    .some((match) => match.staticData.radical?.navigation === "hidden");

/** Construct once per router. No subscriptions or bridge calls until mounted. */
export const tanstackSections = (
  router: AnyRouter,
  sections: readonly Section[]
) => {
  const ownership = sectionOwnership(
    sections,
    router.options.caseSensitive ?? false,
    // `to` is internal; history parsing would apply input rewrites again.
    (route) => trimPathRight(router.buildLocation({ to: route }).pathname)
  );

  sectionOwnerships.set(router, ownership);

  const controller = Effect.runSync(
    makeSections(
      sections,
      router.state.location,
      (to) =>
        tanstackNavigation(router).navigate(to, { viewTransition: false }),
      routeHidden(router, router.state.location.pathname),
      ownership
    )
  );

  const mount = Effect.gen(function* () {
    const bridge = yield* Bridge;

    const update = () => {
      Effect.runSync(
        controller.update(
          router.state.location,
          routeHidden(router, router.state.location.pathname)
        )
      );
    };

    const removeRoute = router.subscribe("onResolved", update);
    update();
    const native = (yield* bridge.runtime) !== "browser";

    const send = () => {
      if (native) {
        Effect.runFork(
          bridge
            .call("RadicalNavigation", "update", { ...controller.snapshot() })
            .pipe(Effect.ignore)
        );
      }
    };

    const removeState = controller.subscribe(send);
    send();

    const removeSelection = native
      ? yield* bridge.observe("radicalSectionSelect", (value) => {
          if (selection(value)) {
            Effect.runFork(controller.select(value.id).pipe(Effect.ignore));
          }
        })
      : () => {
          /* Browser controls call select directly. */
        };

    return () => {
      removeRoute();
      removeState();
      removeSelection();
    };
  });

  return { controller, mount };
};

/** Place under RadicalProvider, once around the route outlet. */
export const TanStackSections = ({
  router,
  sections,
  children,
}: {
  readonly router: AnyRouter;
  readonly sections: readonly Section[];
  readonly children?: ReactNode;
}) => {
  const binding = useMemo(
    () => tanstackSections(router, sections),
    [router, sections]
  );

  const bridge = useContext(BridgeContext);
  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.acquireRelease(binding.mount, (remove) =>
          Effect.sync(remove)
        ).pipe(Effect.andThen(Effect.never), Effect.provide(bridge))
      )
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [binding, bridge]);

  return createElement(
    SectionsProvider,
    { controller: binding.controller },
    children
  );
};
