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
  /** Decoded internal pathname of the current entry. */
  readonly current: string;
  /** Pathname of the history entry below the current one, when known. */
  readonly previous: string | null;
  /** The current route hides section navigation. */
  readonly hidden: boolean;
}

const trimTrailing = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

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

  const owner = location.hidden ? null : sections.ownership(location.current);

  // Selecting a section replaces its entry, which can leave the same page below.
  if (
    location.previous !== null &&
    trimTrailing(location.previous) !== trimTrailing(location.current)
  ) {
    const previousOwner = sections.ownership(location.previous);

    // Hidden and unowned routes pop wherever history leads.
    if (owner === null || previousOwner?.id === owner.id) {
      return pop;
    }
  }

  if (owner === null) {
    return select(start.id);
  }

  if (trimTrailing(location.current) !== trimTrailing(sections.root(owner))) {
    return select(owner.id);
  }

  return owner.id === start.id ? exit : select(start.id);
};
