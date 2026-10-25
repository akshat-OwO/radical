import type { Section, SectionOwnership } from "../sections/sections.ts";

/**
 * - `Pop` walks router history back one entry.
 * - `Select` replaces the current entry with a section's destination.
 * - `Exit` hands back to the platform, which leaves the app.
 */
export type BackDecision =
  | { readonly _tag: "Pop" }
  | { readonly _tag: "Select"; readonly id: string }
  | { readonly _tag: "Exit" };

const pop: BackDecision = { _tag: "Pop" };
const exit: BackDecision = { _tag: "Exit" };
const select = (id: string): BackDecision => ({ _tag: "Select", id });

export interface BackSections {
  readonly sections: readonly Section[];
  readonly ownership: SectionOwnership;
  /** The section root in the same coordinates as `ownership` pathnames. */
  readonly root: (section: Section) => string;
}

export interface BackLocation {
  /** Internal href with a decoded pathname, including search and hash. */
  readonly current: string;
  /** Previous internal href in the same coordinates, when known. */
  readonly previous: string | null;
  /** The current route hides section navigation. */
  readonly hidden: boolean;
}

const trimTrailing = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

const pathnameOf = (href: string) => href.split(/[?#]/u, 1)[0] ?? "";

/**
 * Within a section, back pops history entries that the section owns. At a
 * section root it selects the start section, and at the start section's root
 * it exits. Without sections, back follows router history only.
 */
export const decideBack = (
  location: BackLocation,
  sections: BackSections | null
): BackDecision => {
  const start = sections?.sections[0];

  if (sections === null || start === undefined) {
    return location.previous === null ? exit : pop;
  }

  const currentPathname = pathnameOf(location.current);

  const previousPathname =
    location.previous === null ? null : pathnameOf(location.previous);

  const owner = location.hidden ? null : sections.ownership(currentPathname);

  // Hidden and unowned routes retain their pathname-based history behaviour.
  if (owner === null) {
    return previousPathname !== null &&
      trimTrailing(previousPathname) !== trimTrailing(currentPathname)
      ? pop
      : select(start.id);
  }

  const changed =
    location.previous !== null && location.previous !== location.current;

  if (trimTrailing(currentPathname) === trimTrailing(sections.root(owner))) {
    if (previousPathname === currentPathname && changed) {
      return pop;
    }

    return owner.id === start.id ? exit : select(start.id);
  }

  return previousPathname !== null &&
    sections.ownership(previousPathname)?.id === owner.id &&
    changed
    ? pop
    : select(owner.id);
};
