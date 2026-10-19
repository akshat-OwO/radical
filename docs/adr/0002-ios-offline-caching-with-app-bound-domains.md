# 0002: iOS offline caching with App-Bound Domains

- Status: accepted
- Date: 2026-10-19

## Context

[ADR 0001](0001-framework-agnostic-native-shell-plugin.md) leaves iOS offline caching open because `WKURLSchemeHandler` cannot intercept HTTPS requests. Remote mode needs to keep the server's HTTPS origin, cookies, and server rendering while allowing a service worker to serve snapshots offline.

[Issue #2](https://github.com/akshat-OwO/radical/issues/2) tested whether App-Bound Domains enable this in an ordinary WKWebView shell without a service-worker entitlement. The prototype was a standalone UIKit app built in `/tmp/radical-sw-spike`, outside the repository. No prototype, certificate, server, or native project is included in this change.

## Decision

Use a service worker via App-Bound Domains for iOS remote mode. Generate `WKAppBoundDomains` in Info.plist and set `WKWebViewConfiguration.limitsNavigationsToAppBoundDomains = true` before creating the shell's WebView. Use the persistent `WKWebsiteDataStore.default()`.

Keep one worker at a stable URL and scope per app origin. Version its caches by manifest build id instead of creating a worker registration for each build. Share the service-worker implementation with browsers and Android. This spike establishes the iOS mechanism; it does not implement radical's generated worker or validate the full cache policy.

Do not introduce a custom-scheme proxy for remote mode. It would change the page origin and require separate cookie, request, and caching behavior. Bundled mode remains a separate asset-loading path and was not tested here.

## Evidence

### Environment and method

Tested on 2026-10-19 with Xcode 27.1, build `27A9275`, at `/Applications/Xcode.app`. The only booted device was the iPhone Duo simulator running iOS 27.1, runtime build `24A94425`. The app also logged `UIDevice.current.systemVersion` as `27.1`. No physical device was available.

A Python HTTPS server listened only on `127.0.0.1:8443`. The WebView loaded `https://127.0.0.1.sslip.io:8443/`, so the test used an HTTPS origin with a non-localhost hostname without external hosting. A temporary local CA signed the server certificate, including a wildcard SAN for the test subdomains. Its root was trusted with `xcrun simctl keychain booted add-root-cert`. The app used normal TLS validation, without a trust-challenge bypass or an ATS exception.

The page logged secure-context status, service-worker availability, registration, activation, and controller changes through a `WKScriptMessageHandler`. Native logs also captured `evaluateJavaScript` results and navigation errors. The worker precached `/`, claimed clients, and handled navigation fetches with network-first loading and a Cache Storage fallback. Only its fallback changed the HTML marker from `NETWORK HTML` to `SW CACHED HTML`. Server responses used `Cache-Control: no-store` to distinguish worker caching from the HTTP cache.

The app was compiled with `xcrun --sdk iphonesimulator swiftc -parse-as-library`, installed with `xcrun simctl install booted`, and launched with `xcrun simctl launch booted`. Separate bundle identifiers isolated the configuration comparisons. Offline runs stopped the server; a connection attempt confirmed port 8443 refused connections. Logs were retained outside the repository. All spike servers were stopped and `xcrun simctl shutdown all` ran after testing.

### Observed results

| Test | Result on iOS 27.1 simulator |
| --- | --- |
| App-Bound Domains enabled | `isSecureContext` and service-worker availability were true. Registration resolved, `ready` resolved, and `controllerchange` reported control. |
| Online reload after activation | Navigation completed with `navigator.serviceWorker.controller` present. |
| Server stopped, same URL reloaded | Navigation completed with `SW CACHED HTML` and an active controller. The marker proves the worker intercepted the navigation and served cached HTML. |
| App terminated and relaunched while server remained stopped | The initial navigation again returned `SW CACHED HTML`, demonstrating persistence across an app process restart. |
| App-Bound Domains disabled, with no plist key and flag false | The HTTPS page remained a secure context, but `navigator.serviceWorker` was absent. JS injection and the bridge worked. Offline reload failed with `NSURLErrorDomain` code `-1004`, connection refused. |
| Plist key present, flag false | Page navigation completed, but no bridge messages arrived. Native JS evaluation failed with `WKErrorDomain` code `14`, targeting a frame outside an app-bound domain. |
| Real host at position 10 after nine distinct dummy domains | Navigation, injection, registration, and worker activation succeeded. |
| Real host at position 11 after ten distinct dummy domains | Navigation failed with `WKErrorDomain` code `13`. The eleventh entry did not grant access. |
| Top-level navigation to `https://example.invalid:8443/` | The bound WebView rejected navigation with `WKErrorDomain` code `13`. |
| Four origins in one bound domain | Workers registered at the base host and subdomains `a` and `b`. Subdomain `c` loaded with working injection and bridge access, but registration rejected with `TypeError: Job rejected for non app-bound domain`. Updating the base host's existing registration at that point succeeded. |
| `WKUserScript` at document start | The page and native JS evaluation read the injected `user-script-ok` value, including offline. |
| `evaluateJavaScript` and message handlers | Native evaluation returned values without error. Page-to-native messages arrived during online and offline loads. |
| First-party cookies | Secure JS and server-set HttpOnly cookies worked. `document.cookie` omitted the HttpOnly cookie. `WKHTTPCookieStore.setCookie` and `getAllCookies` returned JS, server, and native cookies; server logs confirmed cookies on subsequent requests. |
| Persistent web storage | `localStorage` read back a stored value after app termination and relaunch. Cache Storage supplied the offline HTML. |
| Snapshot API | `WKWebView.takeSnapshot` returned an image without error. |
| Web data removal | `WKWebsiteDataStore.removeData` with all website data types completed. Subsequent JS queries reported zero worker registrations and zero Cache Storage names. |

## Limits and consequences

- Support starts with the iOS 14 App-Bound Domains APIs according to [WebKit's announcement](https://webkit.org/blog/10882/app-bound-domains/). Execution here covers only iOS 27.1 simulator; earlier supported iOS versions remain unverified.
- Generate at most ten app-bound domains and fail configuration validation if that limit is exceeded. The count is separate from the service-worker limit. Do not assume that an origin accepted for navigation can always register another worker.
- Treat three worker origins across the tested persistent store as the observed ceiling, consistent with [WebKit's explanation of its worker limit](https://bugs.webkit.org/show_bug.cgi?id=227531#c3). The spike did not establish every combination of stores, scopes, ports, or domains. Use one app origin rather than allocating workers per tenant subdomain.
- App-bound navigation checks accepted subdomains of the listed test host. They rejected an unrelated top-level host. This is a WebKit boundary, not a replacement for radical's URL allowlist or bridge authorization.
- External links and authentication redirects outside the bound set cannot navigate in the shell's bound WebView. Route them through an appropriate system browser or authentication session. Adding the plist key also restricts APIs in other WebViews in the same app, so configure those deliberately. [WebKit documents these restrictions and authentication options](https://webkit.org/blog/10882/app-bound-domains/).
- First-party cookie behavior passed. Third-party cookies, identity-provider flows, cross-site tracking policy, and session restoration after process termination were not validated. Preserving the HTTPS origin avoids the origin change of a custom scheme; it does not override WebKit cookie policy.
- The tested WebView APIs support the bridge, snapshot transitions, persistent storage, and web data clearing. This was a minimal shell, not a Capacitor integration test. Individual native plugins, permission prompts, media, push notifications, and bundled-mode scheme handlers remain unverified. [Capacitor exposes the same navigation flag](https://capacitorjs.com/docs/config), but its configuration alone is not evidence that every plugin works.
- Offline service-worker caching requires a successful online visit and worker activation first. It cannot guarantee a first launch without network access. Bundled assets must cover that requirement. Cache eviction, storage pressure, OS termination of WebKit processes, background execution, and long-term retention on a physical device remain unverified.
- Before release, repeat the offline reload, process-restart, authentication, and plugin checks on physical devices and the oldest supported iOS version. Simulator success establishes feasibility, not durability guarantees or App Store acceptance.

## Alternatives considered

- **Custom-scheme proxy.** Rejected for remote mode because the tested HTTPS worker path preserves the server origin and already provides navigation interception and offline HTML. A proxy would add native networking and cookie behavior to maintain. Revisit only if a required deployment cannot satisfy the domain or worker limits.
- **Unrestricted WKWebView.** Rejected for this offline mechanism. With App-Bound Domains absent, the simulator did not expose the Service Worker API.
