# 0021: Deep links

- Status: proposed
- Date: 2026-11-03

Shells only loaded the configured start URL, so a URL opened outside the app could not show a route. Radical supports two kinds of deep link: verified links on `origin`, and opt-in scheme links. Both open the same route the URL names, through the adapter, so offline snapshots, sections, and transitions behave as they do for in-app navigation.

## Decision

Deep links are off unless `deepLinks` is configured:

```ts
deepLinks: {
  ios?: { teamId: string },
  android?: { fingerprints: string[] },
  scheme?: string,
  exclude?: string[],
}
```

Verified links are enabled per platform when that platform's credentials are present. Only `origin` is associated; the allowlist and other domains are not. A verified link opens its own path, query, and hash unchanged. Generation fails with `InvalidConfig` when verified links are configured and `origin` is not `https` on the default port.

The build plan generates `apple-app-site-association` and `assetlinks.json` from the team ID, bundle ID, package ID, and fingerprints. The adapter serves them under `/.well-known/` on `origin`, in both remote and bundled mode. The files never list debug signing keys. `radical run` approves the domain on development installs instead: `pm set-app-links` on Android, and an associated domain in developer mode on iOS.

A scheme link joins host and path: `myapp://settings/billing?x=1` and `myapp:///settings/billing?x=1` both open `/settings/billing?x=1`. There is no default scheme.

Every path opens the app except `/.radical/*`, `/.well-known/*`, server function and API prefixes, and `deepLinks.exclude` patterns. The association files encode the same filter, so the OS opens excluded verified links in the browser. The shell opens an excluded scheme link's `origin` URL in the browser, so an excluded path behaves the same for both kinds.

On a cold start the shell loads the link URL as its start URL. On a warm start the shell sends the URL over the bridge, and the adapter opens it through the same internal step as notification taps: reject external URLs, apply the exclude filter, check the exact-URL snapshot when offline, then navigate. The shell keeps only the latest pending link until the adapter is ready, so the user lands on the last link they opened, not a replay of earlier ones.

The web app sees an ordinary navigation. Route guards handle authentication; radical offers no interception or "opened from a link" hook. Back follows ADR 0016 from wherever the link landed.

## Considered Options

- Scheme links only. Rejected as the default: any app can claim a scheme, and the link does not work on the web.
- Associating the allowlist or extra domains. Deferred: paths on other domains need a rewrite rule, and no use case requires one yet.
- Reloading the WebView for warm links. Rejected: it discards page state, transitions, and section memory.
- Serving debug fingerprints in dev builds. Rejected: Android verifies against the production origin, so the production file would trust debug keys.
- Queuing every pending link. Rejected: replaying stale links makes the app jump between screens.

## Consequences

- Android fingerprints must include the Play App Signing key, which cannot be read from the local keystore.
- iOS associated domains count toward the hostnames of app-bound domains (ADR 0002), but `origin` is already listed.
- An unknown path renders the app's 404. A cold offline start with no snapshot shows the offline fallback, whose retry link targets the deep-link URL.
