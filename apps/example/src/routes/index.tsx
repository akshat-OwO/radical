import {
  useDeviceInfo,
  useSafeArea,
  useRadicalRuntime,
} from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { createPlugins } from "virtual:radical/plugins";

import { EchoRejected } from "../../plugins/echo.ts";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const Home = () => {
  const runtime = useRadicalRuntime();
  const plugins = useMemo(() => createPlugins(runtime), [runtime]);
  const [echo, setEcho] = useState("Ready");

  const runEcho = async (text: string) => {
    try {
      const result = await plugins.echo.echo({ text });
      setEcho(result.text);
    } catch (error) {
      setEcho(
        error instanceof EchoRejected
          ? `EchoRejected: ${error.reason}`
          : String(error)
      );
    }
  };

  const device = useDeviceInfo();
  const safeArea = useSafeArea();
  const [nativeContext, setNativeContext] = useState("Not requested");

  const callServer = async () => {
    try {
      setNativeContext(JSON.stringify(await readNativeContext(), null, 2));
    } catch {
      setNativeContext("Server unavailable");
    }
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
      <Link to="/network">Network status</Link>
      <Link to="/notifications">Notifications</Link>
      <Link to="/files">Files and intents</Link>
      <Link to="/google-sign-in">Google sign-in</Link>
      <Link to="/data-protection">Data protection</Link>
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
          void runEcho("hello");
        }}
      >
        Call echo
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          void runEcho("deny");
        }}
      >
        Reject echo
      </button>
      <pre>{echo}</pre>
      <h2>Native context</h2>
      <button
        type="button"
        onClick={() => {
          void callServer();
        }}
      >
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
