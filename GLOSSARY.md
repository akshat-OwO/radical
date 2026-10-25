# radical

A Vite plugin and runtime that runs a web app inside native Android and iOS apps, which host its UI in a WebView.

## Language

### Apps and frameworks

**Host framework**:\
The meta-framework that owns routing, rendering, data loading, and the server, such as TanStack Start.\
_Avoid_: Base framework, underlying framework

**Adapter**:\
The framework-specific entry point, such as `radical/tanstack-start`, that connects the core to one host framework.\
_Avoid_: Integration, binding, driver

**Core**:\
The framework-agnostic part of radical, built only on web standards and the Vite build.\
_Avoid_: Engine, runtime (when meaning the whole core)

**Plain API**:\
The default public API, whose functions and hooks return values, Promises, React state, and callbacks without exposing Effect types.\
_Avoid_: Simple API, Promise API

**Effect API**:\
The public API under `effect/` subpaths that exposes radical's Effects, layers, and services.\
_Avoid_: Advanced API, core API

### Native

**App identity**:\
The names, platform identifiers, launcher icon, and splash screen that identify an app on a device.\
_Avoid_: Branding config, app metadata

**Shell**:\
The native Android or iOS app that hosts the web app in a WebView.\
_Avoid_: Wrapper, container, native app (when meaning the host)

**Bridge**:\
The channel through which web code calls native capabilities in the shell.\
_Avoid_: Interface, JSI, IPC

**Capability hook**:\
A UI hook that exposes one native capability and its browser fallback.\
_Avoid_: Native hook, device hook

**Data protection**:\
A shell policy that limits screen capture and obscures sensitive content when the app is inactive.\
_Avoid_: Screenshot guarantee, DRM

**Web data clearing**:\
Deletion of stored web content and shell caches within the platform's accessible scope.\
_Avoid_: Factory reset, server logout

**Network status**:\
Whether a local network connection is active and which connection type it uses.\
_Avoid_: Internet reachability, server health

**Video stream**:\
A live camera session with a preview and optional QR detection.\
_Avoid_: Video recording, capture session

**Viewfinder cut-out**:\
The transparent area of the app UI through which the camera preview is visible.\
_Avoid_: Camera modal, scanner screen

**Notification topic membership**:\
The installation's record of notification topics whose subscription or unsubscription succeeded.\
_Avoid_: Server subscription list, audience

**Haptic feedback**:\
Touch feedback for an impact, notification, or selection change.\
_Avoid_: Buzz, rumble

**Location**:\
The native capability that reports where the device is and whether the app may know it.\
_Avoid_: Geolocation, position, GPS

**Location fix**:\
One reading of the device's location: coordinates, accuracy, and the time it was measured.\
_Avoid_: Position, coordinates, ping

**Location precision**:\
Whether the app may read precise location fixes or only approximate ones.\
_Avoid_: Accuracy (the error radius of one fix), fine/coarse

**Location services**:\
The device-wide switch that allows any app to read location, separate from each app's permission.\
_Avoid_: GPS setting, location toggle

**Google sign-in**:\
A request for Google to identify a user and issue an identity token to the app.\
_Avoid_: Google session, Google authorization

**Intent**:\
A request to hand a URL or file to another app on the device.\
_Avoid_: Share, deep link

**Native plugin**:\
A unit of native capability that exposes commands over the bridge.\
_Avoid_: Extension, module

**Plugin manifest**:\
The declaration of a native plugin's identity, commands, configuration, dependencies, and platform sources.\
_Avoid_: Build manifest, plugin config

**Build plan**:\
The resolved app configuration, enabled capabilities, and native project contributions used to generate a shell.\
_Avoid_: Resolved config, generation config

**Native context**:\
Request-time facts about the shell, such as platform and safe-area insets, available to the web app and its server.\
_Avoid_: Device context, client hints

### Loading and offline

**Remote mode**:\
The shell loads the web app from a live server origin, with server rendering.\
_Avoid_: Server URL mode, online mode

**Bundled mode**:\
The shell loads a prebuilt SPA shell from assets packaged in the app, with server functions and data calls served by a remote origin.\
_Avoid_: Static mode, local mode, export mode

**Manifest**:\
The build output `radical-manifest.json` that the service worker and shells read: build id, offline routes, transitions, cache patterns, and allowlist.\
_Avoid_: Config (the input), route manifest

**Offline route**:\
A route marked `offline: true`, whose visited URLs are kept as snapshots.\
_Avoid_: Cached route, PWA route

**Snapshot**:\
The stored HTML of one offline-route URL, keyed by its exact URL including the query string.\
_Avoid_: Cache entry, page cache

**Offline fallback**:\
The page shown when a navigation cannot reach the server and has no stored snapshot.\
_Avoid_: Error page, cached route

**Transition**:\
An animated navigation between routes (slide or fade), shown as a native snapshot overlay in shells and as a view transition in browsers.\
_Avoid_: Animation, page animation

**Transition overlay**:\
The shell's captured image of the outgoing screen, retained while the destination appears during a transition.\
_Avoid_: Snapshot, screen cache

### Navigation

**Section**:\
A top-level destination with its own routes and last-visited URL.\
_Avoid_: Tab, destination, root route

**Native navigation**:\
Section and back controls drawn by the native shell.\
_Avoid_: Native tabs, nav chrome, tab bar (when meaning the whole system)

**Window layout**:\
The app window's width class, fold posture, and hinge bounds.\
_Avoid_: Device type, screen size, form factor
