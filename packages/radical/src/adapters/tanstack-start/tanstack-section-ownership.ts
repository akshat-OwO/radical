import type { AnyRouter } from "@tanstack/react-router";

import type { BackSections } from "../../capabilities/back/back.ts";
import type { SectionsController } from "../../capabilities/sections/sections.ts";

export interface SectionBinding extends BackSections {
  readonly controller: SectionsController;
}

type RouterKey = Pick<AnyRouter, "state">;

export const sectionBindings = new WeakMap<RouterKey, SectionBinding>();

const bindingListeners = new WeakMap<RouterKey, Set<() => void>>();

export const bindSections = (router: RouterKey, binding: SectionBinding) => {
  sectionBindings.set(router, binding);

  for (const listener of bindingListeners.get(router) ?? []) {
    listener();
  }
};

/** Sections may bind after the router installs its native integrations. */
export const watchSectionBinding = (
  router: RouterKey,
  listener: () => void
) => {
  const listeners = bindingListeners.get(router) ?? new Set<() => void>();
  listeners.add(listener);
  bindingListeners.set(router, listeners);

  return () => {
    listeners.delete(listener);
  };
};

export const routeHidden = (
  router: Pick<AnyRouter, "matchRoutes">,
  pathname: string
) =>
  router
    .matchRoutes(pathname)
    .some((match) => match.staticData.radical?.navigation === "hidden");

export const crossesSections = (
  router: Pick<AnyRouter, "state">,
  from: string,
  to: string
) => {
  const binding = sectionBindings.get(router);

  if (binding === undefined) {
    return false;
  }

  const previous = binding.ownership(from);
  const next = binding.ownership(to);

  return previous !== null && next !== null && previous.id !== next.id;
};
