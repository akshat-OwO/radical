# Safe area

`safeAreaStyle(context)` is exported by `radical/server` and `radical/client`. It returns four CSS custom properties, `--radical-safe-area-top`, `--radical-safe-area-right`, `--radical-safe-area-bottom`, and `--radical-safe-area-left`. Apply the result to the document root during SSR, then reuse the same serialized native context during hydration.

Shell values are CSS pixels. Browser values are `env(safe-area-inset-*, 0px)`, so CSS follows the browser's safe area without waiting for JavaScript. Include `viewport-fit=cover` in the viewport metadata. Apply the properties where your content needs padding. Backgrounds can extend to the window edges.

`RadicalProvider` accepts `nativeContext` alongside its existing bridge layer. `useSafeArea()` returns `{ top, right, bottom, left }` from that context during SSR and hydration. After mount, it uses the shared bridge hook helper to subscribe to updates. In a browser, it measures an invisible `env()` probe and remeasures when the probe or viewport resizes. Without a native context, SSR returns zeros. Keep a `useSafeArea()` subscription in a persistent root component so CSS stays current even on routes that do not display its value.

For other UI libraries, `syncSafeArea(receive)` from `radical/client` is a scoped Effect requiring `Bridge`. It updates shell CSS and calls `receive` with current insets. Keep its scope alive until unmount. `watchSafeArea(receive)` exposes the same subscription without updating CSS. The TanStack example wires the request context through a root loader. Neither core function imports TanStack or React.

## First request and updates

Android waits for window insets before enabling network loads. It reads the union of system bars and display cutout, divides physical pixels by display density, and replaces the template seed's safe area before setting the native cookie. The WebView occupies the full window with no system-bar padding.

iOS waits until its view belongs to a window and has completed layout. It reads `view.safeAreaInsets` in points, writes every native cookie through `WKHTTPCookieStore`, and starts Capacitor's navigation after all writes finish. If the insets change during those writes, it repeats with the latest layout. Both shells trade a short startup wait for a first server response with correct insets. They never display a provisional page with zero padding.

On changes, both shells refresh the HttpOnly cookie before publishing a `radicalSafeArea` event through the bridge. A document-start script retains the latest value so a subscription mounted after the event still receives it. The script never changes the document's styles before hydration. The client applies CSS only after React commits. Later requests use the updated cookie. Already cached offline HTML can contain an older context; offline snapshot refresh is outside this feature.

## Capacitor inset ownership

Capacitor 8's Android `SystemBars.injectSafeAreaCSS` changes the root element's inline style after page commit. React then sees attributes absent from SSR and reports a hydration mismatch. Generated shells set `plugins.SystemBars.insetsHandling` to `disable`, which disables that injection and Capacitor's inset padding. Radical owns both cookie values and CSS updates. The iOS SystemBars plugin does not inject safe-area styles. Radical also sets `contentInsetAdjustmentBehavior` to `never` so UIKit does not add scroll padding.
