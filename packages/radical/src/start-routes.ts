import type { RadicalRoute } from "./adapter.ts";

export interface StartRoute {
  readonly fullPath: string;
  readonly options: { readonly staticData?: { readonly offline?: boolean } };
  readonly children?: readonly StartRoute[] | Record<string, StartRoute>;
}

/** Read the initialized router, so pathless layouts and parameters use full paths. */
export const readRoutes = function readRoutes(
  route: StartRoute
): readonly RadicalRoute[] {
  return [
    {
      pattern: route.fullPath,
      offline: route.options.staticData?.offline === true,
    },
    ...Object.values(route.children ?? {}).flatMap(readRoutes),
  ];
};
