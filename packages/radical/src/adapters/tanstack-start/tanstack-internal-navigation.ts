import { defaultParseSearch } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";

/** Internal URLs use `to`; `href` would apply the input rewrite again. */
export const internalNavigationOptions = (
  router: Pick<AnyRouter, "options">,
  to: string
) => {
  const hashIndex = to.indexOf("#");
  const path = hashIndex === -1 ? to : to.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : to.slice(hashIndex + 1);
  const searchIndex = path.indexOf("?");
  const pathname = searchIndex === -1 ? path : path.slice(0, searchIndex);
  const query = searchIndex === -1 ? "" : path.slice(searchIndex);

  return {
    to: pathname,
    search: (router.options.parseSearch ?? defaultParseSearch)(query),
    hash,
  };
};
