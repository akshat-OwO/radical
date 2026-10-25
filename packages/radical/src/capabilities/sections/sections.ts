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
        !value.split("/").some((part) => part === "." || part === "..")
    )
  ),
  icon: SectionIconSchema,
  selectedIcon: Schema.optional(SectionIconSchema),
});

export const NavigationSchema = Schema.Struct({
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

/** Prefixes match path segments; query strings and fragments do not affect ownership. */
export const sectionForURL = <S extends Section>(
  sections: readonly S[],
  url: string
): S | null => {
  const pathname = url.split(/[?#]/u)[0] ?? "";
  let owner: S | null = null;

  for (const section of sections) {
    if (
      (section.route === "/" ||
        pathname === section.route ||
        pathname.startsWith(`${section.route}/`)) &&
      (owner === null || section.route.length > owner.route.length)
    ) {
      owner = section;
    }
  }

  return owner;
};

export const makeSections = (
  sections: readonly Section[],
  initialURL: string,
  navigate: RadicalNavigation["navigate"],
  initialHidden = false
) =>
  Effect.sync(() => {
    const listeners = new Set<() => void>();
    const memory = new Map<string, string>();
    let url = initialURL;
    let hidden = initialHidden;

    let entries: readonly SectionState[] = sections.map((section) => ({
      ...section,
      badge: null,
    }));

    const read = (): SectionsSnapshot => {
      const active = hidden ? null : sectionForURL(entries, url);

      return { sections: entries, active, hidden: active === null };
    };

    let snapshot = read();

    const remember = () => {
      const owner = sectionForURL(entries, url);

      if (owner) {
        memory.set(owner.id, url);
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

    return {
      snapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
      update: (nextURL: string, nextHidden = false) =>
        Effect.sync(() => {
          url = nextURL;
          hidden = nextHidden;
          remember();
          publish();
        }),
      select: (id: string) =>
        Effect.gen(function* () {
          const section = entries.find((entry) => entry.id === id);

          if (!section) {
            return yield* new InvalidSection({
              message: `Unknown section id: ${id}`,
            });
          }

          return yield* navigate(
            snapshot.active?.id === id
              ? section.route
              : (memory.get(id) ?? section.route)
          );
        }),
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
