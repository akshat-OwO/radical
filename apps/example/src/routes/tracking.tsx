import {
  useLocationPermission,
  useTrackingSession,
} from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

const LocationPermissionAction = () => {
  const permission = useLocationPermission();

  return (
    <>
      <p>
        Location permission: {permission.value?.state ?? "Check permission"}
      </p>
      <button
        type="button"
        onClick={() => {
          permission.request();
        }}
      >
        Request approximate location
      </button>
    </>
  );
};

const Tracking = () => {
  const tracking = useTrackingSession();

  const [preset, setPreset] = useState<"balanced" | "fitness" | "navigation">(
    "balanced"
  );

  const session = tracking.value;

  const active =
    session?.status.state === "running" ||
    session?.status.state === "suspended";

  return (
    <main>
      <h1>Tracking session</h1>
      <Link to="/">Home</Link>
      <p>Android and iOS shells. Leaving this screen does not stop tracking.</p>
      <LocationPermissionAction />
      <label>
        Preset
        <select
          value={preset}
          onChange={(event) => {
            const selected = event.target.value;

            if (
              selected === "balanced" ||
              selected === "fitness" ||
              selected === "navigation"
            ) {
              setPreset(selected);
            }
          }}
        >
          <option value="balanced">Balanced</option>
          <option value="fitness">Fitness</option>
          <option value="navigation">Navigation</option>
        </select>
      </label>
      <button
        type="button"
        disabled={tracking.loading || active}
        onClick={() => {
          tracking.start({ preset });
        }}
      >
        Start tracking
      </button>
      <button
        type="button"
        disabled={!session || !active}
        onClick={() => {
          if (session) {
            tracking.stop(session.id);
          }
        }}
      >
        Stop tracking
      </button>
      <button
        type="button"
        onClick={() => {
          tracking.refresh();
        }}
      >
        Refresh
      </button>
      <p>
        Status:{" "}
        {tracking.loading ? "Loading" : (session?.status.state ?? "No session")}
      </p>
      <pre aria-label="Session status">
        {JSON.stringify(session?.status ?? null, null, 2)}
      </pre>
      <p>Precision: {session?.permission.precision ?? "unknown"}</p>
      <pre aria-label="Latest location fix">
        {JSON.stringify(session?.latest ?? null, null, 2)}
      </pre>
      <pre aria-label="Last acquisition error">
        {JSON.stringify(session?.lastError ?? null, null, 2)}
      </pre>
      {tracking.error !== undefined && (
        <p role="alert">{JSON.stringify(tracking.error)}</p>
      )}
    </main>
  );
};

export const Route = createFileRoute("/tracking")({ component: Tracking });
