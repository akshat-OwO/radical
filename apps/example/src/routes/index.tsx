import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { BridgeLive } from "radical/client";
import { useDeviceInfo, useSafeArea } from "radical/react";
import { useEffect, useState } from "react";
import { plugins } from "virtual:radical/plugins";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const Home = () => {
  const [echo, setEcho] = useState("Ready");
  const runEcho = (text: string) => {
    Effect.runFork(
      plugins.echo.echo({ text }).pipe(
        Effect.provide(BridgeLive),
        Effect.match({
          onFailure: (error) =>
            error._tag === "EchoRejected"
              ? `EchoRejected: ${error.reason}`
              : error._tag,
          onSuccess: (result) => result.text,
        }),
        Effect.tap((value) =>
          Effect.sync(() => {
            setEcho(value);
          })
        )
      )
    );
  };
  const device = useDeviceInfo();
  const safeArea = useSafeArea();
  const [nativeContext, setNativeContext] = useState("Not requested");
  const callServer = () => {
    Effect.runFork(
      Effect.tryPromise(async () => await readNativeContext()).pipe(
        Effect.match({
          onSuccess: (value) => JSON.stringify(value, null, 2),
          onFailure: () => "Server unavailable",
        }),
        Effect.tap((value) =>
          Effect.sync(() => {
            setNativeContext(value);
          })
        )
      )
    );
  };
  const [css, setCSS] = useState("");
  useEffect(() => {
    const readCSS = () => {
      const style = getComputedStyle(document.documentElement);
      setCSS(
        ["top", "right", "bottom", "left"]
          .map(
            (edge) =>
              `${edge}: ${style.getPropertyValue(`--radical-safe-area-${edge}`)}`
          )
          .join("; ")
      );
    };
    readCSS();
    window.addEventListener("radicalSafeArea", readCSS);
    return () => {
      window.removeEventListener("radicalSafeArea", readCSS);
    };
  }, []);
  return (
    <main>
      <h1>Radical example</h1>
      <a href="/offline-route">Offline route</a>{" "}
      <a href="/online-route">Network required</a>
      <Link to="/details">Slide to details</Link>{" "}
      <Link to="/about">Fade to about</Link>
      <Link to="/camera">Camera capture and permission</Link>
      <Link to="/video">Live video and QR scanning</Link>
      <Link to="/files">Files and intents</Link>
      <Link to="/haptics">Haptic feedback</Link>
      <h2>Safe area</h2>
      <pre data-testid="safe-area">{JSON.stringify(safeArea)}</pre>
      <h2>CSS variables</h2>
      <pre data-testid="safe-area-css">{css}</pre>
      <h2>Device info</h2>
      <pre data-testid="device-info">
        {device.loading
          ? "Loading device info..."
          : JSON.stringify(device.error ?? device.value, null, 2)}
      </pre>
      <h2>Manifest commands</h2>
      <button
        type="button"
        onClick={() => {
          runEcho("hello");
        }}
      >
        Call echo
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          runEcho("deny");
        }}
      >
        Reject echo
      </button>
      <pre>{echo}</pre>
      <h2>Native context</h2>
      <button type="button" onClick={callServer}>
        Call server function
      </button>
      <pre>{nativeContext}</pre>
      <p>
        <a href="/?navigation=allowed">Navigate within the shell</a>
      </p>
      <p>
        <a href="https://example.com/">Navigate outside the allowlist</a>
      </p>
      <form
        style={{ marginTop: "auto", paddingTop: "24px" }}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label htmlFor="keyboard-check">Keyboard check</label>{" "}
        <input
          id="keyboard-check"
          placeholder="Type near the bottom"
          style={{ fontSize: "16px" }}
        />{" "}
        <button type="submit">Submit</button>
      </form>
    </main>
  );
};

export const Route = createFileRoute("/")({
  staticData: { radical: { transition: "slide" } },
  component: Home,
});
