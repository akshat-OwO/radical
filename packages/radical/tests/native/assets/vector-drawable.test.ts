import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import about from "../../../../../apps/example/assets/about.svg?raw";
import home from "../../../../../apps/example/assets/home.svg?raw";
import { sectionVectorDrawable } from "../../../src/native/assets/native-assets.ts";

const document = (size: number, contents: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${size}dp" android:height="${size}dp" android:viewportWidth="${size}" android:viewportHeight="${size}">\n${contents}\n</vector>`;

describe("SVG conversion", () => {
  it.effect("emits exact paths and strokes for the example section icons", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* sectionVectorDrawable(home, "home.svg"),
        document(
          24,
          '    <path android:pathData="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" android:strokeColor="#FF000000" android:strokeWidth="2" />'
        )
      );
      assert.strictEqual(
        yield* sectionVectorDrawable(about, "about.svg"),
        document(
          24,
          '    <path android:pathData="M12 11v7m0-12v2m10 4a10 10 0 1 1-20 0 10 10 0 0 1 20 0" android:strokeColor="#FF000000" android:strokeWidth="2" />'
        )
      );
    })
  );

  it.effect("bakes nested group transforms into circle geometry", () =>
    Effect.gen(function* () {
      const xml = yield* sectionVectorDrawable(
        '<svg viewBox="0 0 32 32"><g fill="red" transform="translate(1 1)"><g transform="translate(1 1)"><circle cx="12" cy="12" r="8"/></g></g></svg>',
        "circle.svg"
      );

      assert.strictEqual(
        xml,
        document(
          32,
          '    <path android:pathData="M14 6a8 8 0 1 0 0 16 8 8 0 1 0 0-16" android:fillColor="#FFFF0000" />'
        )
      );
    })
  );

  it.effect(
    "inherits paints and preserves path opacity and stroke styles",
    () =>
      Effect.gen(function* () {
        const xml = yield* sectionVectorDrawable(
          '<svg viewBox="0 0 24 24" fill="#1234" fill-opacity="0.5" stroke="blue" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="3"><g fill-rule="evenodd"><path d="M0 0h12v12z" opacity="0.5" stroke-opacity="0.5"/></g></svg>',
          "paint.svg"
        );

        assert.strictEqual(
          xml,
          document(
            24,
            '    <path android:pathData="M0 0h12v12z" android:fillColor="#44112233" android:fillAlpha="0.25" android:strokeColor="#FF0000FF" android:strokeAlpha="0.25" android:fillType="evenOdd" android:strokeLineCap="round" android:strokeLineJoin="bevel" android:strokeWidth="2" android:strokeMiterLimit="3" />'
          )
        );
      })
  );

  it.effect(
    "translates a nonzero viewBox origin and preserves dimensions",
    () =>
      Effect.gen(function* () {
        const xml = yield* sectionVectorDrawable(
          '<svg viewBox="10 20 24 24" width="48px" height="48"><path d="M10 20h4v4z"/></svg>',
          "offset.svg"
        );

        assert.strictEqual(
          xml,
          '<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="24" android:viewportHeight="24">\n    <group android:translateX="-10" android:translateY="-20">\n    <path android:pathData="M10 20h4v4z" android:fillColor="#FF000000" />\n    </group>\n</vector>'
        );
      })
  );

  it.effect("normalizes rectangles and inline paint styles", () =>
    Effect.gen(function* () {
      const xml = yield* sectionVectorDrawable(
        '<svg width="24" height="24"><rect x="2" y="3" width="4" height="5" style="fill:none;stroke:#123456;stroke-width:2"/></svg>',
        "rectangle.svg"
      );

      assert.strictEqual(
        xml,
        document(
          24,
          '    <path android:pathData="M2 3h4v5H2z" android:strokeColor="#FF123456" android:strokeWidth="2" />'
        )
      );
    })
  );

  it.effect(
    "rejects unsupported rendering features and invalid viewports with typed errors",
    () =>
      Effect.gen(function* () {
        for (const svg of [
          '<svg viewBox="0 0 24 24"><path d="M0 0h4" stroke-dasharray="1 2"/></svg>',
          '<svg viewBox="0 0 24 24"><g opacity="0.5"><path d="M0 0h4"/></g></svg>',
          '<svg viewBox="0 0 24 24"><path d="M0 0h4" fill="url(#gradient)"/></svg>',
          '<svg viewBox="0 0 0 24"/>',
          '<svg width="100%" height="100%"/>',
        ]) {
          const error = yield* Effect.flip(
            sectionVectorDrawable(svg, "unsupported.svg")
          );

          assert.strictEqual(error._tag, "InvalidAsset");
          assert.include(error.message, "unsupported.svg");
        }
      })
  );
});
