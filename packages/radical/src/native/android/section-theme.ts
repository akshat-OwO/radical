import { Schema } from "effect";

import type {
  NavigationSchema,
  SectionColorSchema,
} from "../../capabilities/sections/sections.ts";

const resource = (name: string) =>
  `androidx.core.content.ContextCompat.getColor(activity, R.color.radical_section_${name})`;

const isHexColor = Schema.is(Schema.String);

const colorValue = (
  value: typeof SectionColorSchema.Type,
  mode: "light" | "dark"
) => (isHexColor(value) ? value : value[mode]);

type AndroidColors = NonNullable<
  typeof NavigationSchema.Type.android
>["colors"];

const colorEntries = (colors: AndroidColors) => {
  const entries: readonly (readonly [
    string,
    typeof SectionColorSchema.Type | undefined,
  ])[] = [
    ["container", colors?.container],
    ["indicator", colors?.indicator],
    ["badge", colors?.badge],
    ["icon_selected", colors?.icon?.selected],
    ["icon_unselected", colors?.icon?.unselected],
    ["label_selected", colors?.label?.selected],
    ["label_unselected", colors?.label?.unselected],
  ];

  return entries;
};

/** Only declared colors get resources; omitted channels retain Material defaults. */
export const sectionTheme = (android: typeof NavigationSchema.Type.android) => {
  const colors = android?.colors;

  const entries = colorEntries(colors);

  const tint = (name: "icon" | "label", setter: string) => {
    if (colors?.[name] === undefined) {
      return "";
    }

    const selected =
      colors[name].selected === undefined
        ? `defaults.getColorForState(new int[] { android.R.attr.state_checked }, defaults.getDefaultColor())`
        : resource(`${name}_selected`);

    const unselected =
      colors[name].unselected === undefined
        ? "defaults.getDefaultColor()"
        : resource(`${name}_unselected`);

    // Fills an omitted state from the Material defaults of the freshly built bar.
    const defaults =
      colors[name].selected === undefined ||
      colors[name].unselected === undefined
        ? `android.content.res.ColorStateList defaults = androidx.appcompat.content.res.AppCompatResources.getColorStateList(bar.getContext(), bar == bottom ? com.google.android.material.R.color.m3_navigation_bar_item_with_indicator_${name}_tint : com.google.android.material.R.color.m3_navigation_rail_item_with_indicator_${name}_tint);`
        : "";

    return `{ ${defaults} bar.${setter}(new android.content.res.ColorStateList(new int[][] { new int[] { android.R.attr.state_checked }, new int[0] }, new int[] { ${selected}, ${unselected} })); }`;
  };

  return {
    resources: (["light", "dark"] as const).map((mode) => ({
      directory: mode === "light" ? "values" : "values-night",
      source: `<resources>\n${entries.flatMap(([name, value]) => (value === undefined ? [] : [`<color name="radical_section_${name}">${colorValue(value, mode)}</color>`])).join("\n")}\n</resources>\n`,
    })),
    setup: [
      `bar.setLabelVisibilityMode(NavigationBarView.LABEL_VISIBILITY_${(android?.labels ?? "labeled").toUpperCase()});`,
      colors?.container === undefined
        ? ""
        : `bar.setBackgroundTintList(android.content.res.ColorStateList.valueOf(${resource("container")}));`,
      colors?.indicator === undefined
        ? ""
        : `bar.setItemActiveIndicatorColor(android.content.res.ColorStateList.valueOf(${resource("indicator")}));`,
      tint("icon", "setItemIconTintList"),
      tint("label", "setItemTextColor"),
    ].join("\n"),
    badge:
      colors?.badge === undefined
        ? ""
        : `drawable.setBackgroundColor(${resource("badge")});`,
  };
};
