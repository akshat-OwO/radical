import { Effect } from "effect";

import type { RadicalConfig } from "../../vite/config.ts";
import { nativeIdentity } from "../context/native-identity.ts";

const builtInExcludes = [
  "/.radical/*",
  "/.well-known/*",
  "/_serverFn",
  "/_serverFn/*",
  "/api",
  "/api/*",
];

class DeepLinkPathFilter {
  readonly patterns: readonly RegExp[];

  constructor(excludes: readonly string[]) {
    this.patterns = excludes.map(
      (pattern) =>
        new RegExp(
          `^${pattern
            .split("*")
            .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
            .join(".*")}$`,
          "u"
        )
    );
  }

  allows(path: string) {
    const { pathname } = new URL(path, "https://radical.invalid");

    return !this.patterns.some((pattern) => pattern.test(pathname));
  }
}

/** Path globs use * for zero or more characters. Query and fragment never participate. */
export const resolveDeepLinks = (config: RadicalConfig) => {
  const excludes = [
    ...new Set([...builtInExcludes, ...(config.deepLinks?.exclude ?? [])]),
  ];

  const components = [
    ...excludes.map((pattern) => ({ "/": pattern, exclude: true })),
    { "/": "/*" },
  ];

  const ios = config.deepLinks?.ios;
  const android = config.deepLinks?.android;

  return {
    ios: ios !== undefined,
    android: android !== undefined,
    scheme: config.deepLinks?.scheme,
    excludes,
    filter: new DeepLinkPathFilter(excludes),
    apple:
      ios === undefined
        ? undefined
        : {
            applinks: {
              details: [
                {
                  appIDs: [
                    `${ios.teamId}.${nativeIdentity(config, "ios").appId}`,
                  ],
                  components,
                },
              ],
            },
          },
    assetlinks:
      android === undefined
        ? undefined
        : [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: nativeIdentity(config, "android").appId,
                sha256_cert_fingerprints: android.fingerprints,
              },
              relation_extensions: {
                "delegate_permission/common.handle_all_urls": {
                  dynamic_app_link_components: components,
                },
              },
            },
          ],
  };
};

/** Association requests finish before routing, authentication, and update gates. */
export const associationResponse = (
  request: Request,
  plan: ReturnType<typeof resolveDeepLinks>
) =>
  Effect.sync((): Response | undefined => {
    const path = new URL(request.url).pathname;

    let response: Response | undefined;

    if (
      path !== "/.well-known/apple-app-site-association" &&
      path !== "/.well-known/assetlinks.json"
    ) {
      response = undefined;
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      response = new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    } else {
      const file = path.endsWith("assetlinks.json")
        ? plan.assetlinks
        : plan.apple;

      response = new Response(
        request.method === "HEAD" || file === undefined
          ? null
          : JSON.stringify(file),
        {
          status: file === undefined ? 404 : 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return response;
  });
