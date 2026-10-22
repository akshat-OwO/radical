import { createFileRoute, Link } from "@tanstack/react-router";
import { useCamera, useCameraPermission } from "radical/react";

const Camera = () => {
  const camera = useCamera();
  const permission = useCameraPermission();

  return (
    <main>
      <h1>Camera</h1>
      <Link to="/">Home</Link>
      <p>
        Camera permission:{" "}
        {permission.loading
          ? "Checking..."
          : (permission.error?._tag ?? permission.value ?? "Not checked")}
      </p>
      <button
        type="button"
        disabled={permission.loading}
        onClick={() => {
          permission.check();
        }}
      >
        Check permission
      </button>
      <button
        type="button"
        disabled={permission.loading}
        onClick={() => {
          permission.request();
        }}
      >
        Request permission
      </button>
      <button
        type="button"
        disabled={camera.loading || permission.loading}
        onClick={() => {
          camera.capture();
        }}
      >
        Capture photo
      </button>
      <button
        type="button"
        disabled={camera.loading}
        onClick={() => {
          camera.choose();
        }}
      >
        Choose photo
      </button>
      <p>{camera.loading ? "Capturing..." : camera.error?._tag}</p>
      {camera.value && (
        <>
          <p>
            {camera.value.mimeType} {camera.value.width} {camera.value.height}
          </p>
          <img
            src={camera.value.dataUrl}
            alt="Captured preview"
            style={{ maxWidth: "100%", maxHeight: "50vh" }}
          />
        </>
      )}
    </main>
  );
};

export const Route = createFileRoute("/camera")({ component: Camera });
