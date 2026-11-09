import { useKeyValue } from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

const KeyValue = () => {
  const [namespace, setNamespace] = useState("user-one");
  const [text, setText] = useState("Hello");

  const storage = useKeyValue(
    { store: "example-settings", namespace, backup: "eligible" },
    "message"
  );

  return (
    <main>
      <h1>Native key-value storage</h1>
      <Link to="/">Home</Link>
      <label htmlFor="storage-namespace">Namespace</label>
      <select
        id="storage-namespace"
        value={namespace}
        onChange={(event) => {
          setNamespace(event.target.value);
        }}
      >
        <option value="user-one">User one</option>
        <option value="user-two">User two</option>
      </select>
      <label htmlFor="storage-message">Message</label>
      <input
        id="storage-message"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <button
        type="button"
        disabled={storage.loading}
        onClick={() => {
          storage.set(text);
        }}
      >
        Save message
      </button>
      <button
        type="button"
        disabled={storage.loading}
        onClick={() => {
          storage.refresh();
        }}
      >
        Read message
      </button>
      <button
        type="button"
        disabled={storage.loading}
        onClick={() => {
          storage.remove();
        }}
      >
        Remove message
      </button>
      <button
        type="button"
        disabled={storage.loading}
        onClick={() => {
          storage.clear();
        }}
      >
        Clear namespace
      </button>
      <output aria-live="polite">
        {storage.loading
          ? "Loading..."
          : (storage.error?._tag ?? JSON.stringify(storage.value))}
      </output>
      <p>
        Values survive app relaunches and web origin changes. Browser operations
        report Unavailable. Actions are disabled while a request runs.
      </p>
    </main>
  );
};

export const Route = createFileRoute("/key-value")({ component: KeyValue });
