import { createFileRoute, Link } from "@tanstack/react-router";
import { useVideoStream } from "radical/react";
import { useRef, useState } from "react";

const Video = () => {
  const viewfinder = useRef<HTMLDivElement>(null);
  const [lastQR, setLastQR] = useState("None");
  const stream = useVideoStream({ viewfinder, onDetect: setLastQR });
  const zoom = stream.value?.zoom;
  let status = "Stopped";
  if (stream.loading) {
    status = "Starting...";
  }
  if (stream.running) {
    status = "Streaming";
  }
  return (
    <main style={{ isolation: "isolate", overflow: "hidden" }}>
      <section
        style={{
          background: "white",
          color: "black",
          position: "relative",
          zIndex: 1,
        }}
      >
        <h1>Live video</h1>
        <Link to="/">Home</Link>
        <p>
          <output>{stream.error?._tag ?? status}</output>
        </p>
        <button
          type="button"
          disabled={stream.running || stream.loading}
          onClick={() => {
            stream.start();
          }}
        >
          Start
        </button>
        <button
          type="button"
          disabled={!stream.running && !stream.loading}
          onClick={() => {
            stream.stop();
          }}
        >
          Stop
        </button>
        <button
          type="button"
          disabled={!stream.running}
          onClick={() => {
            stream.switchCamera();
          }}
        >
          Switch camera
        </button>
        <button
          type="button"
          disabled={stream.value?.torchAvailable !== true}
          onClick={() => {
            stream.setTorch(stream.value?.torch !== true);
          }}
        >
          Torch {stream.value?.torch === true ? "off" : "on"}
        </button>
        <p>
          Camera: {stream.value?.facing ?? "rear"}. Frame rate:{" "}
          {stream.value?.frameRate ?? "Unavailable"}
        </p>
        {zoom && (
          <label>
            Zoom{" "}
            <input
              aria-label="Zoom"
              type="range"
              min={zoom.min}
              max={zoom.max}
              step="0.1"
              value={zoom.current}
              onChange={(event) => {
                stream.setZoom(Number(event.target.value));
              }}
            />{" "}
            {zoom.current.toFixed(1)}
          </label>
        )}
        <p>
          Last QR: <output>{lastQR}</output>
        </p>
        {stream.running && stream.value?.detectionAvailable === false && (
          <p>QR detection is unavailable in this browser.</p>
        )}
      </section>
      <div
        ref={viewfinder}
        aria-label="Camera viewfinder"
        style={{
          width: "100%",
          height: "40vh",
          border: "2px solid #6d28d9",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 0 0 100vmax white",
        }}
      />
    </main>
  );
};
export const Route = createFileRoute("/video")({ component: Video });
