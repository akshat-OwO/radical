import { Effect } from "effect";

import { composeSettings } from "../../vite/build-plan.ts";
import { InvalidConfig } from "../../vite/config.ts";
import { escapeXml } from "../../vite/native-contributions.ts";
import {
  NativeTemplateMismatch,
  replaceAnchor,
} from "../shared/native-template.ts";

/** Application contributions compose with the template instead of shadowing it. */
export const applyAndroidApplication = (
  manifest: string,
  attributes: Readonly<Record<string, string>>,
  children: readonly string[]
) =>
  Effect.gen(function* () {
    const opening = /<application\b[^>]*>/u.exec(manifest)?.[0];

    if (opening === undefined) {
      return yield* new NativeTemplateMismatch({
        file: "AndroidManifest.xml",
        anchor: "<application",
      });
    }

    const existing: Record<string, string> = {};

    for (const match of opening.matchAll(
      /(?<name>[\w:.-]+)\s*=\s*(?<quote>["'])(?<value>.*?)\k<quote>/gu
    )) {
      const { name, value } = match.groups ?? {};

      if (name !== undefined && value !== undefined) {
        if (Object.hasOwn(existing, name)) {
          return yield* new InvalidConfig({
            message: `Duplicate Android application attribute ${name}`,
          });
        }

        existing[name] = value;
      }
    }

    const combined = yield* composeSettings("Android application attribute", [
      existing,
      { "android:enableOnBackInvokedCallback": "true" },
      attributes,
    ]);

    const additions = Object.entries(combined)
      .filter(([key]) => !Object.hasOwn(existing, key))
      .map(
        ([key, value]) =>
          ` ${key}="${escapeXml(value).replaceAll('"', "&quot;")}"`
      )
      .join("");

    const withAttributes = yield* replaceAnchor(
      "AndroidManifest.xml",
      manifest,
      opening,
      opening.replace("<application", `<application${additions}`)
    );

    return yield* replaceAnchor(
      "AndroidManifest.xml",
      withAttributes,
      "</application>",
      `${children.join("")}</application>`
    );
  });
