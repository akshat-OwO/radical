import { createFileRoute, Link } from "@tanstack/react-router";
import { useHapticFeedback } from "radical/react";

const Haptics = () => {
  const feedback = useHapticFeedback();
  const actions = [
    ["Light", feedback.light],
    ["Medium", feedback.medium],
    ["Heavy", feedback.heavy],
    ["Success", feedback.success],
    ["Warning", feedback.warning],
    ["Error", feedback.error],
    ["Selection", feedback.selection],
    [
      "Impact (default medium)",
      () => {
        feedback.impact();
      },
    ],
  ] as const;
  return (
    <main>
      <h1>Haptic feedback</h1>
      <Link to="/">Home</Link>
      {actions.map(([label, action]) => (
        <button
          key={label}
          type="button"
          disabled={feedback.loading}
          onClick={action}
        >
          {label}
        </button>
      ))}
      <output>
        {feedback.loading
          ? "Sending..."
          : (feedback.failure?._tag ?? (feedback.value ? "Sent" : "Idle"))}
      </output>
      <p>
        Unsupported browsers do nothing. A successful call does not confirm
        physical vibration.
      </p>
    </main>
  );
};
export const Route = createFileRoute("/haptics")({ component: Haptics });
