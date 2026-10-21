import { createFileRoute, Link } from "@tanstack/react-router";
import { useFilePicker, useIntent } from "radical/react";

const Files = () => {
  const picker = useFilePicker();
  const intent = useIntent();
  const first = picker.value?.[0];
  let intentStatus = "Idle";
  if (intent.loading) {
    intentStatus = "Opening...";
  } else if (intent.error) {
    intentStatus = intent.error._tag;
  } else if (intent.value) {
    intentStatus = "Opened";
  }
  return (
    <main>
      <h1>Files</h1>
      <Link to="/">Home</Link>
      <button
        type="button"
        disabled={picker.loading}
        onClick={() => {
          picker.pick();
        }}
      >
        Pick file
      </button>
      <button
        type="button"
        disabled={picker.loading}
        onClick={() => {
          picker.pick({
            types: ["image/*", "application/pdf"],
            multiple: true,
          });
        }}
      >
        Pick images or PDFs
      </button>
      <p>{picker.loading ? "Picking..." : picker.error?._tag}</p>
      <ul>
        {picker.value?.map((file) => (
          <li key={`${file.name}-${file.uri ?? file.size}`}>
            {file.name} {file.mimeType} {file.size} {file.blob.size}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={intent.loading}
        onClick={() => {
          intent.openUrl("https://example.com/");
        }}
      >
        Open URL
      </button>
      <button
        type="button"
        disabled={intent.loading || first === undefined}
        onClick={() => {
          if (first !== undefined) {
            intent.openFile(first);
          }
        }}
      >
        Open picked file
      </button>
      <p>Intent: {intentStatus}</p>
    </main>
  );
};
export const Route = createFileRoute("/files")({ component: Files });
