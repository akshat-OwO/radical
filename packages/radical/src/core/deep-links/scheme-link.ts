/** Strip the scheme delimiter and the optional slash before a path-only link. */
export const schemeLinkPrefix = "^[^:]+:///?";

export const schemeLinkRoute = (link: string) =>
  link.replace(new RegExp(schemeLinkPrefix, "u"), "/");
