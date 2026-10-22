import path from "node:path";

import { Effect } from "effect";
import semver from "semver";

import { InvalidPlugin, PluginDependencyConflict } from "./errors.ts";
import type { EnabledPlugin } from "./plugin-plan.ts";

export const swiftPackageIdentity = (url: string) =>
  path
    .basename(new URL(url).pathname.replace(/\/$/u, ""))
    .replace(/\.git$/iu, "")
    .toLowerCase();

/** Resolve one version satisfying every enabled manifest, including disjoint unions. */
export const resolvePluginDependencies = (plugins: readonly EnabledPlugin[]) =>
  Effect.gen(function* () {
    const swiftPackages = new Map<string, { id: string; url: string }>();
    const requirements = new Map<string, { id: string; range: string }[]>();
    for (const { manifest } of plugins) {
      for (const { url } of manifest.ios?.dependencies ?? []) {
        const identity = swiftPackageIdentity(url);
        if (identity === "capacitor-swift-pm") {
          return yield* new InvalidPlugin({
            message: `Plugin ${manifest.id}: SPM package capacitor-swift-pm is managed by the shell`,
          });
        }
        const previous = swiftPackages.get(identity);
        if (previous && previous.url !== url) {
          return yield* new PluginDependencyConflict({
            message: `Conflicting SPM package ${identity}: ${previous.id} requires ${previous.url}, ${manifest.id} requires ${url}`,
          });
        }
        swiftPackages.set(identity, { id: manifest.id, url });
      }
      const groups = [
        Object.entries(manifest.dependencies).map(([name, range]) => ({
          name: `npm:${name}`,
          range,
        })),
        Object.entries(manifest.android?.dependencies ?? {}).map(
          ([name, range]) => ({ name: `gradle:${name}`, range })
        ),
        (manifest.ios?.dependencies ?? []).map(({ url, version }) => ({
          name: `spm:${url}`,
          range: version,
        })),
      ];
      for (const { name, range } of groups.flat()) {
        if (semver.validRange(range) === null) {
          return yield* new InvalidPlugin({
            message: `Plugin ${manifest.id}: invalid dependency range ${name}@${range}`,
          });
        }
        requirements.set(name, [
          ...(requirements.get(name) ?? []),
          { id: manifest.id, range },
        ]);
      }
    }
    const versions = new Map<string, string>();
    for (const [name, entries] of requirements) {
      let combinations = [""];
      for (const { range } of entries) {
        combinations = combinations
          .flatMap((previous) =>
            new semver.Range(range).set.map(
              (set) => `${previous} ${set.map(String).join(" ")}`
            )
          )
          .filter((combined) => semver.minVersion(combined) !== null);
      }
      const candidates = combinations
        .flatMap((combined) => {
          const minimum = semver.minVersion(combined);
          return minimum === null ? [] : [minimum.version];
        })
        .toSorted(semver.compare);
      const [version] = candidates;
      if (!version) {
        return yield* new PluginDependencyConflict({
          message: `Conflicting dependency ${name}: ${entries.map(({ id, range }) => `${id} requires ${range}`).join(", ")}`,
        });
      }
      versions.set(name, version);
    }
    return versions;
  });
