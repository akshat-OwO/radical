import { Effect, Option } from "effect";
import { optimize } from "svgo";
import type { XastChild, XastElement, XastRoot } from "svgo";

import { InvalidAsset } from "./errors.ts";

const invalid = (source: string, reason: string) =>
  new InvalidAsset({ message: `Section icon ${source}: ${reason}` });

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

const presentation = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
]);

const dimension = (value: string | undefined) =>
  value !== undefined && /^\d*\.?\d+(?:px)?$/u.test(value)
    ? Number(value.replace(/px$/u, ""))
    : Number.NaN;

const color = (value: string) => {
  const hex = value.slice(1);

  const expanded =
    hex.length <= 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;

  return `#${expanded.length === 8 ? expanded.slice(6) : "ff"}${expanded.slice(0, 6)}`.toUpperCase();
};

const length = (value: string | undefined) =>
  value !== undefined && /^-?\d*\.?\d+(?:px)?$/u.test(value)
    ? Number(value.replace(/px$/u, ""))
    : undefined;

/** SVGO leaves rounded rectangles alone, so trace them with SVG's rx/ry defaulting and clamping. */
const roundedRectPath = (attributes: Record<string, string>) => {
  const x = length(attributes.x ?? "0");
  const y = length(attributes.y ?? "0");
  const width = length(attributes.width);
  const height = length(attributes.height);
  const rxValue = length(attributes.rx);
  const ryValue = length(attributes.ry);

  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0 ||
    (rxValue === undefined && ryValue === undefined)
  ) {
    return Option.none<string>();
  }

  const rx = Math.min(Math.max(rxValue ?? ryValue ?? 0, 0), width / 2);
  const ry = Math.min(Math.max(ryValue ?? rxValue ?? 0, 0), height / 2);

  if (rx === 0 || ry === 0) {
    return Option.none<string>();
  }

  const arc = `A${rx} ${ry} 0 0 1`;

  return Option.some(
    [
      `M${x + rx} ${y}`,
      `H${x + width - rx}`,
      `${arc} ${x + width} ${y + ry}`,
      `V${y + height - ry}`,
      `${arc} ${x + width - rx} ${y + height}`,
      `H${x + rx}`,
      `${arc} ${x} ${y + height - ry}`,
      `V${y + ry}`,
      `${arc} ${x + rx} ${y}`,
      "Z",
    ].join("")
  );
};

const rectGeometry = new Set(["x", "y", "width", "height", "rx", "ry"]);

const parse = (input: string, source: string) =>
  Effect.try({
    try: () => {
      let tree: XastRoot | undefined;

      optimize(input.replaceAll("currentColor", "#000000"), {
        floatPrecision: 4,
        plugins: [
          "convertStyleToAttrs",
          {
            name: "convertColors",
            params: { shorthex: false, shortname: false, names2hex: true },
          },
          {
            name: "convertRoundedRects",
            fn: () => ({
              element: {
                enter: (node) => {
                  if (node.name !== "rect") {
                    return;
                  }

                  const traced = roundedRectPath(node.attributes);

                  if (Option.isNone(traced)) {
                    return;
                  }

                  node.name = "path";
                  node.attributes = {
                    ...Object.fromEntries(
                      Object.entries(node.attributes).filter(
                        ([name]) => !rectGeometry.has(name)
                      )
                    ),
                    d: traced.value,
                  };
                },
              },
            }),
          },
          { name: "convertShapeToPath", params: { convertArcs: true } },
          "moveGroupAttrsToElems",
          "convertPathData",
          // Keep groups so unsupported attributes cannot disappear during optimization.
          {
            name: "captureDrawableTree",
            fn: (ast) => {
              tree = ast;
            },
          },
        ],
      });

      return tree;
    },
    catch: (cause) => invalid(source, String(cause)),
  });

const viewport = (svg: XastElement, source: string) =>
  Effect.gen(function* () {
    const box = svg.attributes.viewBox
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number) ?? [
      0,
      0,
      dimension(svg.attributes.width),
      dimension(svg.attributes.height),
    ];

    if (
      box.length !== 4 ||
      box.some((value) => !Number.isFinite(value)) ||
      box[2] <= 0 ||
      box[3] <= 0
    ) {
      return yield* invalid(source, "Expected a finite, positive viewport");
    }

    const width =
      svg.attributes.width === undefined
        ? box[2]
        : dimension(svg.attributes.width);

    const height =
      svg.attributes.height === undefined
        ? box[3]
        : dimension(svg.attributes.height);

    if (!(width > 0 && height > 0)) {
      return yield* invalid(source, "Expected positive SVG dimensions");
    }

    return { box, width, height };
  });

const inheritedAttributes = (
  node: XastElement,
  inherited: ReadonlyMap<string, string>,
  source: string
) =>
  Effect.gen(function* () {
    const attrs = new Map(inherited);
    const ignored = new Set(["id", "xmlns"]);

    if (node.name === "svg") {
      for (const name of ["viewBox", "width", "height"]) {
        ignored.add(name);
      }
    }

    if (node.name === "path") {
      ignored.add("d");
      ignored.add("opacity");
    }

    for (const [name, value] of Object.entries(node.attributes)) {
      if (presentation.has(name)) {
        attrs.set(name, value);
      } else if (ignored.has(name)) {
        continue;
      } else if (name === "opacity" && value === "1") {
        continue;
      } else {
        return yield* invalid(
          source,
          `Unsupported attribute ${name} on ${node.name}`
        );
      }
    }

    return attrs;
  });

const paintAttributes = (
  paint: "fill" | "stroke",
  attrs: ReadonlyMap<string, string>,
  opacity: number,
  source: string
) =>
  Effect.gen(function* () {
    const value = attrs.get(paint) ?? (paint === "fill" ? "#000000" : "none");

    if (value === "none") {
      return [];
    }

    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value)) {
      return yield* invalid(source, `Unsupported ${paint} color ${value}`);
    }

    const alpha = Number(attrs.get(`${paint}-opacity`) ?? 1) * opacity;

    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      return yield* invalid(source, `Invalid ${paint} opacity`);
    }

    return [
      `android:${paint}Color="${color(value)}"`,
      ...(alpha === 1 ? [] : [`android:${paint}Alpha="${alpha}"`]),
    ];
  });

const enumAttributes = (attrs: ReadonlyMap<string, string>, source: string) =>
  Effect.gen(function* () {
    const output: string[] = [];

    const enums: readonly (readonly [
      string,
      string,
      ReadonlyMap<string, string>,
    ])[] = [
      [
        "fill-rule",
        "fillType",
        new Map([
          ["nonzero", "nonZero"],
          ["evenodd", "evenOdd"],
        ]),
      ],
      [
        "stroke-linecap",
        "strokeLineCap",
        new Map(["butt", "round", "square"].map((value) => [value, value])),
      ],
      [
        "stroke-linejoin",
        "strokeLineJoin",
        new Map(["miter", "round", "bevel"].map((value) => [value, value])),
      ],
    ];

    for (const [svgName, androidName, allowed] of enums) {
      const value = attrs.get(svgName);

      if (value !== undefined) {
        const mapped = allowed.get(value);

        if (mapped === undefined) {
          return yield* invalid(source, `Invalid ${svgName}`);
        }

        output.push(`android:${androidName}="${mapped}"`);
      }
    }

    return output;
  });

const pathXml = (
  node: XastElement,
  attrs: ReadonlyMap<string, string>,
  source: string
) =>
  Effect.gen(function* () {
    if (!node.attributes.d) {
      return yield* invalid(source, "Path has no geometry");
    }

    const opacity = Number(node.attributes.opacity ?? 1);

    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      return yield* invalid(source, "Invalid path opacity");
    }

    const output = [
      `android:pathData="${escapeXml(node.attributes.d)}"`,
      ...(yield* paintAttributes("fill", attrs, opacity, source)),
      ...(yield* paintAttributes("stroke", attrs, opacity, source)),
      ...(yield* enumAttributes(attrs, source)),
    ];

    for (const name of ["stroke-width", "stroke-miterlimit"]) {
      const value = attrs.get(name);

      if (
        value !== undefined &&
        (!Number.isFinite(Number(value)) || Number(value) < 0)
      ) {
        return yield* invalid(source, `Invalid ${name}`);
      }
    }

    if (attrs.get("stroke") !== undefined && attrs.get("stroke") !== "none") {
      output.push(
        `android:strokeWidth="${escapeXml(attrs.get("stroke-width") ?? "1")}"`
      );
    }

    const miter = attrs.get("stroke-miterlimit");

    if (miter !== undefined) {
      output.push(`android:strokeMiterLimit="${escapeXml(miter)}"`);
    }

    return `    <path ${output.join(" ")} />`;
  });

const drawablePaths = (
  node: XastChild,
  inherited: ReadonlyMap<string, string>,
  source: string
): Effect.Effect<string[], InvalidAsset> =>
  Effect.gen(function* () {
    if (node.type === "comment" || node.type === "instruction") {
      return [];
    }

    if (node.type === "text" && node.value.trim() === "") {
      return [];
    }

    if (node.type !== "element") {
      return yield* invalid(source, `Unsupported XML node ${node.type}`);
    }

    if (["title", "desc", "metadata"].includes(node.name)) {
      return [];
    }

    // Nested viewports need their own transform and clip, which Android cannot express here.
    if (node.name !== "g" && node.name !== "path") {
      return yield* invalid(source, `Unsupported element ${node.name}`);
    }

    const attrs = yield* inheritedAttributes(node, inherited, source);

    if (node.name === "path") {
      return [yield* pathXml(node, attrs, source)];
    }

    const children: string[] = [];

    for (const child of node.children) {
      children.push(...(yield* drawablePaths(child, attrs, source)));
    }

    return children;
  });

/** Parse once, normalize geometry, and reject features Android cannot represent. */
export const svgToVectorDrawable = (input: string, source: string) =>
  Effect.gen(function* () {
    const root = yield* parse(input, source);

    const svg = root?.children.find(
      (node): node is XastElement =>
        node.type === "element" && node.name === "svg"
    );

    if (svg === undefined) {
      return yield* invalid(source, "Expected an SVG root");
    }

    const { box, width, height } = yield* viewport(svg, source);
    const attrs = yield* inheritedAttributes(svg, new Map(), source);
    const paths: string[] = [];

    for (const child of svg.children) {
      paths.push(...(yield* drawablePaths(child, attrs, source)));
    }

    const contents = paths.join("\n");

    const translated =
      box[0] !== 0 || box[1] !== 0
        ? `    <group android:translateX="${-box[0]}" android:translateY="${-box[1]}">\n${contents}\n    </group>`
        : contents;

    return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${width}dp" android:height="${height}dp" android:viewportWidth="${box[2]}" android:viewportHeight="${box[3]}">\n${translated}\n</vector>`;
  });
