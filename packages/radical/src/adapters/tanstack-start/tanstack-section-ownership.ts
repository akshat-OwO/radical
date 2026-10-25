import type { AnyRouter } from "@tanstack/react-router";

import { sectionForPathname } from "../../capabilities/sections/sections.ts";
import type { Section } from "../../capabilities/sections/sections.ts";

export const sectionDeclarations = new WeakMap<
  Pick<AnyRouter, "state">,
  readonly Section[]
>();

export const crossesSections = (
  router: Pick<AnyRouter, "state" | "options">,
  from: string,
  to: string
) => {
  const sections = sectionDeclarations.get(router);

  if (sections === undefined) {
    return false;
  }

  const previous = sectionForPathname(
    sections,
    from,
    router.options.caseSensitive ?? false
  );

  const next = sectionForPathname(
    sections,
    to,
    router.options.caseSensitive ?? false
  );

  return previous !== null && next !== null && previous.id !== next.id;
};
