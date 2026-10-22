import { Effect } from "effect";
import { useCallback, useEffect } from "react";

import {
  checkExactAlarmPermission,
  requestExactAlarmPermission,
  cancelNotification,
  clearNotificationBadge,
  checkNotificationPermission,
  getNotificationTopics,
  notificationsLive,
  registerPush,
  requestNotificationPermission,
  scheduleNotification,
  setNotificationBadge,
  subscribeToTopic,
  unsubscribeFromTopic,
} from "../capabilities/notifications/notifications.ts";
import type {
  ExactAlarmPermission,
  NotificationScheduleResult,
  LocalNotification,
  NotificationError,
  NotificationPermission,
} from "../capabilities/notifications/notifications.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

export interface NotificationPermissionState extends ActionState<
  NotificationPermission,
  NotificationError
> {
  readonly check: () => void;
  readonly request: () => void;
}
const check = notificationsLive(checkNotificationPermission);
const request = notificationsLive(requestNotificationPermission);
export const useNotificationPermission = (): NotificationPermissionState => {
  const { run, ...state } = useBridgeAction<
    NotificationPermission,
    NotificationError
  >();
  const refresh = useCallback(() => {
    run(check);
  }, [run]);
  useEffect(refresh, [refresh]);
  return {
    ...state,
    check: refresh,
    request: useCallback(() => {
      run(request);
    }, [run]),
  };
};
export interface NotificationsState extends ActionState<
  string | readonly string[] | true | NotificationScheduleResult,
  NotificationError
> {
  readonly schedule: (notification: LocalNotification) => void;
  readonly cancel: (id: number) => void;
  readonly setBadge: (count: number) => void;
  readonly clearBadge: () => void;
  readonly registerPush: () => void;
  readonly subscribe: (topic: string) => void;
  readonly unsubscribe: (topic: string) => void;
  readonly lookupTopics: () => void;
}
export const useNotifications = (): NotificationsState => {
  const { run, ...state } = useBridgeAction<
    string | readonly string[] | true | NotificationScheduleResult,
    NotificationError
  >();
  return {
    ...state,
    schedule: useCallback(
      (notification: LocalNotification) => {
        run(notificationsLive(scheduleNotification(notification)));
      },
      [run]
    ),
    cancel: useCallback(
      (id: number) => {
        run(
          notificationsLive(cancelNotification(id)).pipe(
            Effect.as(true as const)
          )
        );
      },
      [run]
    ),
    setBadge: useCallback(
      (count: number) => {
        run(setNotificationBadge(count).pipe(Effect.as(true as const)));
      },
      [run]
    ),
    clearBadge: useCallback(() => {
      run(clearNotificationBadge.pipe(Effect.as(true as const)));
    }, [run]),
    registerPush: useCallback(() => {
      run(notificationsLive(registerPush));
    }, [run]),
    subscribe: useCallback(
      (topic: string) => {
        run(
          subscribeToTopic(topic).pipe(Effect.andThen(getNotificationTopics))
        );
      },
      [run]
    ),
    unsubscribe: useCallback(
      (topic: string) => {
        run(
          unsubscribeFromTopic(topic).pipe(
            Effect.andThen(getNotificationTopics)
          )
        );
      },
      [run]
    ),
    lookupTopics: useCallback(() => {
      run(getNotificationTopics);
    }, [run]),
  };
};

export interface ExactAlarmPermissionState extends ActionState<
  ExactAlarmPermission,
  NotificationError
> {
  readonly check: () => void;
  readonly request: () => void;
}
export const useExactAlarmPermission = (): ExactAlarmPermissionState => {
  const { run, ...state } = useBridgeAction<
    ExactAlarmPermission,
    NotificationError
  >();
  const refresh = useCallback(() => {
    run(checkExactAlarmPermission);
  }, [run]);
  useEffect(refresh, [refresh]);
  return {
    ...state,
    check: refresh,
    request: useCallback(() => {
      run(requestExactAlarmPermission);
    }, [run]),
  };
};
