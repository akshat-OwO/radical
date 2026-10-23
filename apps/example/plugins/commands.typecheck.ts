import type { plugins } from "virtual:radical/plugins";

type Assert<T extends true> = T;

export type PlainResult = Assert<
  ReturnType<typeof plugins.echo.echo> extends Promise<{
    readonly text: string;
  }>
    ? true
    : false
>;

export type PlainArgs = Assert<
  Parameters<typeof plugins.echo.echo>[0] extends { readonly text: string }
    ? true
    : false
>;

export type EnabledCommands = Assert<
  keyof typeof plugins.echo extends "echo" ? true : false
>;

export type EnabledPlugins = Assert<
  "disabled" extends keyof typeof plugins ? false : true
>;
