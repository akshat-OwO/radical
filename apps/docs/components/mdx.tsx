import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultComponents from "fumadocs-ui/mdx";

import { FrameworkGrid } from "./framework-grid";
import { Mermaid } from "./mermaid";
import { ScreenshotRow } from "./screenshot-row";

export const mdxComponents = {
  ...defaultComponents,
  Callout,
  Card,
  Cards,
  File,
  Files,
  Folder,
  FrameworkGrid,
  Mermaid,
  ScreenshotRow,
  Step,
  Steps,
  Tab,
  Tabs,
  TypeTable,
};
