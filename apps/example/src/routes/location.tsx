import {
  Unavailable,
  openAppSettings,
  openLocationServicesSettings,
} from "@akshatowo/radical/client";
import {
  useLocation,
  useLocationPermission,
  useLocationWatch,
  useRadicalRuntime,
} from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

const Location = () => {
  const location = useLocation();
  const permission = useLocationPermission();
  const watch = useLocationWatch();
  const runtime = useRadicalRuntime();
  const fix = watch.value ?? location.value;
  const [navigatorResult, setNavigatorResult] = useState<string>();
  const [navigatorPermission, setNavigatorPermission] = useState<string>();

  return (
    <main>
      <h1>Location</h1>
      <Link to="/">Home</Link>
      <p>
        Permission:{" "}
        {permission.value?.state ?? permission.error?._tag ?? "Checking..."};
        precision: {permission.value?.precision ?? "unknown"}
      </p>
      <button
        type="button"
        onClick={() => {
          permission.check();
        }}
      >
        Check permission
      </button>
      <button
        type="button"
        onClick={() => {
          permission.request();
        }}
      >
        Request approximate
      </button>
      <button
        type="button"
        onClick={() => {
          permission.request({ precise: "navigation" });
        }}
      >
        Request precise
      </button>
      <button
        type="button"
        onClick={() => {
          location.getCurrent();
        }}
        disabled={location.loading}
      >
        Get current location
      </button>
      <button
        type="button"
        onClick={() => {
          setNavigatorResult("Waiting...");
          navigator.geolocation.getCurrentPosition(
            (position) => {
              setNavigatorResult(JSON.stringify(position.toJSON(), null, 2));
            },
            (failure) => {
              setNavigatorResult(`Error ${failure.code}: ${failure.message}`);
            }
          );
        }}
      >
        Navigator getCurrentPosition
      </button>
      <button
        type="button"
        onClick={() => {
          setNavigatorPermission("Checking...");
          Effect.runFork(
            Effect.tryPromise({
              try: async () =>
                await navigator.permissions.query({ name: "geolocation" }),
              catch: (cause) => new Unavailable({ reason: String(cause) }),
            }).pipe(
              Effect.match({
                onSuccess: (status) => {
                  setNavigatorPermission(status.state);
                },
                onFailure: (error) => {
                  setNavigatorPermission(error.reason);
                },
              })
            )
          );
        }}
      >
        Navigator permissions.query
      </button>
      {navigatorResult !== undefined && (
        <pre aria-label="Navigator location result">{navigatorResult}</pre>
      )}
      {navigatorPermission !== undefined && (
        <p>Navigator permission: {navigatorPermission}</p>
      )}
      <button
        type="button"
        onClick={() => {
          watch.start();
        }}
        disabled={watch.running}
      >
        Start watch
      </button>
      <button
        type="button"
        onClick={() => {
          watch.stop();
        }}
        disabled={!watch.running}
      >
        Stop watch
      </button>
      <button
        type="button"
        onClick={() => {
          void openAppSettings(runtime);
        }}
      >
        App settings
      </button>
      <button
        type="button"
        onClick={() => {
          void openLocationServicesSettings(runtime);
        }}
      >
        Location services settings
      </button>
      <p>
        {watch.running ? "Watching" : "Stopped"}{" "}
        {watch.error?._tag ?? location.error?._tag}
      </p>
      {fix && <pre>{JSON.stringify(fix, null, 2)}</pre>}
    </main>
  );
};

export const Route = createFileRoute("/location")({ component: Location });
