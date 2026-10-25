import type { AnyRouter } from "@tanstack/react-router";

import { sectionForURL } from "../../capabilities/sections/sections.ts";
import type { Section } from "../../capabilities/sections/sections.ts";

export const sectionDeclarations = new WeakMap<
  Pick<AnyRouter, "state">,
  readonly Section[]
>();

export const crossesSections = (
  router: Pick<AnyRouter, "state">,
  from: string,
  to: string
) => {
  const sections = sectionDeclarations.get(router);

  if (sections === undefined) {
    return false;
  }

  const previous = sectionForURL(sections, from);
  const next = sectionForURL(sections, to);

  return previous !== null && next !== null && previous.id !== next.id;
};
