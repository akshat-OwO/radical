import type { AnyRouter } from "@tanstack/react-router";

import type { SectionOwnership } from "../../capabilities/sections/sections.ts";

export const sectionOwnerships = new WeakMap<
  Pick<AnyRouter, "state">,
  SectionOwnership
>();

export const crossesSections = (
  router: Pick<AnyRouter, "state">,
  from: string,
  to: string
) => {
  const ownership = sectionOwnerships.get(router);

  if (ownership === undefined) {
    return false;
  }

  const previous = ownership(from);
  const next = ownership(to);

  return previous !== null && next !== null && previous.id !== next.id;
};
