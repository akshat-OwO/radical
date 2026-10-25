import { Context, Effect, Layer, Schema } from "effect";

import type { RadicalNavigation } from "../../core/adapter/adapter.ts";
import { InvalidSection } from "./errors.ts";

export { InvalidSection } from "./errors.ts";

const text = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0)
);

export const SectionIconSchema = Schema.Struct({
  ios: text,
  android: text.check(Schema.isPattern(/\.svg$/u)),
});

export const SectionSchema = Schema.Struct({
  id: text,
  title: text,
  route: Schema.String.check(
    Schema.makeFilter(
      (value) =>
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !/[?#\\\s]/u.test(value) &&
        !value.includes("//") &&
        (value === "/" || !value.endsWith("/")) &&
        !value.split("/").some((part) => {
          const segment = part.replaceAll(/%2e/giu, ".");

          return segment === "." || segment === "..";
        })
    )
  ),
  icon: SectionIconSchema,
  selectedIcon: Schema.optional(SectionIconSchema),
});

const hexColor = Schema.String.check(
  Schema.isPattern(/^#(?:[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/u)
);

export const SectionColorSchema = Schema.Union([
  hexColor,
  Schema.Struct({ light: hexColor, dark: hexColor }),
]);

const itemColors = Schema.Struct({
  selected: Schema.optional(SectionColorSchema),
  unselected: Schema.optional(SectionColorSchema),
});

export const NavigationSchema = Schema.Struct({
  bar: Schema.optional(
    Schema.Struct({
      ios: Schema.optional(Schema.Literals(["native", "web"])),
      android: Schema.optional(Schema.Literals(["native", "web"])),
    })
  ),
  android: Schema.optional(
    Schema.Struct({
      labels: Schema.optional(
        Schema.Literals(["labeled", "selected", "unlabeled"])
      ),
      colors: Schema.optional(
        Schema.Struct({
          container: Schema.optional(SectionColorSchema),
          indicator: Schema.optional(SectionColorSchema),
          badge: Schema.optional(SectionColorSchema),
          icon: Schema.optional(itemColors),
          label: Schema.optional(itemColors),
        })
      ),
    })
  ),
  sections: Schema.Array(SectionSchema).check(
    Schema.makeFilter(
      (sections) =>
        (sections.length >= 2 && sections.length <= 5) ||
        "navigation.sections must contain 2 to 5 sections"
    ),
    Schema.makeFilter(
      (sections) =>
        new Set(sections.map((section) => section.id)).size ===
          sections.length || "navigation.sections[].id must be unique"
    ),
    Schema.makeFilter(
      (sections) =>
        new Set(sections.map((section) => section.route)).size ===
          sections.length || "navigation.sections[].route must be unique"
    )
  ),
});

export const SectionBadgeSchema = Schema.Union([
  Schema.Finite,
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  Schema.Null,
]);

export type Section = typeof SectionSchema.Type;

export type SectionBadge = typeof SectionBadgeSchema.Type;

export interface SectionState extends Section {
  readonly badge: SectionBadge;
}

export interface SectionsSnapshot {
  readonly sections: readonly SectionState[];
  readonly active: SectionState | null;
  readonly hidden: boolean;
}

/** The adapter supplies its decoded pathname separately from the restorable URL. */
export interface SectionLocation {
  readonly href: string;
  readonly pathname: string;
}

const unchangedPathname = (route: string) => route;

export type SectionOwnership = (pathname: string) => Section | null;

/** Normalize declarations once; longest prefixes use the normalized path length. */
export const sectionOwnership = (
  sections: readonly Section[],
  caseSensitive = true,
  normalizePathname: (route: string) => string = unchangedPathname
): SectionOwnership => {
  const paths = sections
    .map((section) => {
      const pathname = normalizePathname(section.route);

      return {
        section,
        path: caseSensitive ? pathname : pathname.toLowerCase(),
      };
    })
    .toSorted((left, right) => right.path.length - left.path.length);

  return function ownerForPathname(pathname) {
    const path = caseSensitive ? pathname : pathname.toLowerCase();

    return (
      paths.find(
        (entry) =>
          entry.path === "/" ||
          path === entry.path ||
          path.startsWith(`${entry.path}/`)
      )?.section ?? null
    );
  };
};

export const makeSections = (
  sections: readonly Section[],
  initialLocation: SectionLocation,
  navigate: RadicalNavigation["navigate"],
  initialHidden = false,
  ownership: SectionOwnership = sectionOwnership(sections)
) =>
  Effect.sync(() => {
    const listeners = new Set<() => void>();
    const memory = new Map<string, string>();
    let location = initialLocation;
    let hidden = initialHidden;

    let entries: readonly SectionState[] = sections.map((section) => ({
      ...section,
      badge: null,
    }));

    const read = (): SectionsSnapshot => {
      const owner = hidden ? null : ownership(location.pathname);
      const active = entries.find((entry) => entry.id === owner?.id) ?? null;

      return { sections: entries, active, hidden: active === null };
    };

    let snapshot = read();

    const remember = () => {
      const owner = ownership(location.pathname);

      if (owner) {
        memory.set(owner.id, location.href);
      }
    };

    remember();

    const publish = () => {
      const next = read();

      if (
        next.sections === snapshot.sections &&
        next.active === snapshot.active &&
        next.hidden === snapshot.hidden
      ) {
        return;
      }

      snapshot = next;

      for (const listener of listeners) {
        listener();
      }
    };

    const destination = (id: string) =>
      Effect.gen(function* () {
        const section = entries.find((entry) => entry.id === id);

        if (!section) {
          return yield* new InvalidSection({
            message: `Unknown section id: ${id}`,
          });
        }

        return snapshot.active?.id === id
          ? section.route
          : (memory.get(id) ?? section.route);
      });

    return {
      snapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
      update: (nextLocation: SectionLocation, nextHidden = false) =>
        Effect.sync(() => {
          location = nextLocation;
          hidden = nextHidden;
          remember();
          publish();
        }),
      /** The active section returns to its root; others restore their last route. */
      destination,
      select: (id: string) =>
        destination(id).pipe(Effect.flatMap((to) => navigate(to))),
      setBadge: (id: string, value: SectionBadge) =>
        Effect.gen(function* () {
          if (!entries.some((entry) => entry.id === id)) {
            return yield* new InvalidSection({
              message: `Unknown section id: ${id}`,
            });
          }

          const badge = yield* Schema.decodeUnknownEffect(SectionBadgeSchema)(
            value
          ).pipe(
            Effect.mapError(
              (error) =>
                new InvalidSection({
                  message: `Invalid badge: ${error.message}`,
                })
            )
          );

          return yield* Effect.sync(() => {
            if (entries.find((entry) => entry.id === id)?.badge === badge) {
              return;
            }

            entries = entries.map((entry) =>
              entry.id === id ? { ...entry, badge } : entry
            );
            publish();
          });
        }),
    };
  });

export type SectionsController = Effect.Success<
  ReturnType<typeof makeSections>
>;

export class Sections extends Context.Service<Sections, SectionsController>()(
  "radical/Sections"
) {}

export const sectionsLayer = (controller: SectionsController) =>
  Layer.succeed(Sections, controller);

export const selectSection = (id: string) =>
  Sections.pipe(Effect.flatMap((sections) => sections.select(id)));

export const setSectionBadge = (id: string, value: SectionBadge) =>
  Sections.pipe(Effect.flatMap((sections) => sections.setBadge(id, value)));
