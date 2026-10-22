import { createFileRoute, Link } from "@tanstack/react-router";
import { Schema } from "effect";
import { NotificationScheduleResultSchema } from "radical/client";
import {
  useExactAlarmPermission,
  useNotificationPermission,
  useNotifications,
} from "radical/react";

const isScheduleResult = Schema.is(NotificationScheduleResultSchema);

const Notifications = () => {
  const exactAlarms = useExactAlarmPermission();
  const permission = useNotificationPermission();
  const notifications = useNotifications();

  const actions = [
    [
      "Schedule in 5 seconds",
      () => {
        notifications.schedule({
          id: 22,
          title: "Radical reminder",
          body: "Open the offline route",
          delaySeconds: 5,
          route: "/offline-route",
        });
      },
    ],
    [
      "Cancel reminder",
      () => {
        notifications.cancel(22);
      },
    ],
    [
      "Set badge to 1",
      () => {
        notifications.setBadge(1);
      },
    ],
    ["Clear badge", notifications.clearBadge],
    ["Register push", notifications.registerPush],
    [
      "Subscribe to radical-demo",
      () => {
        notifications.subscribe("radical-demo");
      },
    ],
    [
      "Unsubscribe from radical-demo",
      () => {
        notifications.unsubscribe("radical-demo");
      },
    ],
    ["Look up topics", notifications.lookupTopics],
  ] as const;

  return (
    <main>
      <h1>Notifications</h1>
      <Link to="/">Home</Link>
      <a href="/offline-route">Visit the offline route to save its snapshot</a>
      <p>Permission: {permission.value ?? "Not checked"}</p>
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
        disabled={permission.loading}
        onClick={() => {
          permission.check();
        }}
      >
        Check permission
      </button>
      <output>{permission.error?._tag}</output>
      <p>Exact alarm permission: {exactAlarms.value ?? "Not checked"}</p>
      <button
        type="button"
        disabled={exactAlarms.loading}
        onClick={() => {
          exactAlarms.check();
        }}
      >
        Check exact alarm permission
      </button>
      {exactAlarms.value === "denied" && (
        <button
          type="button"
          disabled={exactAlarms.loading}
          onClick={() => {
            exactAlarms.request();
          }}
        >
          Allow exact alarms in Android settings
        </button>
      )}
      <output>{exactAlarms.error?._tag}</output>
      {isScheduleResult(notifications.value) &&
        notifications.value.warning?.code === "OS-PLUG-LNOT-0017" && (
          <p>
            Android scheduled an inexact alarm. Allow exact alarms, then
            schedule the reminder again.
          </p>
        )}
      {actions.map(([label, action]) => (
        <button
          key={label}
          type="button"
          disabled={
            notifications.loading ||
            (label === "Schedule in 5 seconds" &&
              (exactAlarms.loading ||
                (exactAlarms.value !== "granted" &&
                  exactAlarms.value !== "not-required")))
          }
          onClick={action}
        >
          {label}
        </button>
      ))}
      <pre>
        {notifications.loading
          ? "Working..."
          : JSON.stringify(
              notifications.error ?? notifications.value ?? "Idle",
              null,
              2
            )}
      </pre>
      <p>
        Browser reminders require this page to stay open. Push and topics
        require your Firebase configuration. Badge support depends on the
        launcher.
      </p>
    </main>
  );
};

export const Route = createFileRoute("/notifications")({
  component: Notifications,
});
