import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { bridgeLayer, getDeviceInfo } from "../../src/entry/client.ts";
import {
  RadicalProvider,
  useGoogleSignIn,
  useDataProtection,
  useSafeArea,
  useNetworkStatus,
  useNotificationPermission,
  useNotifications,
  useCamera,
  useCameraPermission,
  useFilePicker,
  useIntent,
  useHapticFeedback,
  useVideoStream,
} from "../../src/react/react.ts";
import { useBridgeEffect } from "../../src/react/use-bridge-effect.ts";

const SafeAreaProbe = () =>
  createElement("pre", null, JSON.stringify(useSafeArea()));

const Probe = () => {
  const state = useBridgeEffect(getDeviceInfo);
  assert.deepStrictEqual(state, {
    loading: true,
    value: undefined,
    error: undefined,
  });

  return createElement("p", null, "loading");
};

it.effect(
  "renders useBridgeEffect on the server without reading the bridge or browser APIs",
  () =>
    Effect.sync(() => {
      const layer = bridgeLayer(() =>
        assert.fail("SSR read the injected bridge")
      );

      assert.isFalse("window" in globalThis);
      assert.strictEqual(
        renderToString(
          createElement(RadicalProvider, { layer }, createElement(Probe))
        ),
        "<p>loading</p>"
      );
    })
);

it.effect(
  "renders native safe area from the provider without browser APIs",
  () =>
    Effect.sync(() => {
      const area = { top: 62, right: 0, bottom: 34, left: 0 };

      const html = renderToString(
        createElement(
          RadicalProvider,
          {
            nativeContext: {
              platform: "ios",
              safeArea: area,
              shellVersion: "1",
            },
          },
          createElement(SafeAreaProbe)
        )
      );

      assert.strictEqual(
        html,
        renderToString(createElement("pre", null, JSON.stringify(area)))
      );
    })
);

const CameraProbe = () => {
  const camera = useCamera();
  const permission = useCameraPermission();
  assert.isFalse(camera.loading);
  assert.isUndefined(camera.value);
  assert.isUndefined(permission.value);
  camera.capture();
  permission.request();

  return createElement("p", null, "camera idle");
};

it.effect(
  "guards camera actions during server rendering without reading the bridge",
  () =>
    Effect.sync(() => {
      const layer = bridgeLayer(() =>
        assert.fail("Camera read bridge during SSR")
      );

      assert.strictEqual(
        renderToString(
          createElement(RadicalProvider, { layer }, createElement(CameraProbe))
        ),
        "<p>camera idle</p>"
      );
    })
);

const FilesProbe = () => {
  const picker = useFilePicker();
  const intent = useIntent();
  assert.isFalse(picker.loading);
  assert.isUndefined(picker.value);
  assert.isUndefined(intent.value);
  picker.pick();
  intent.openUrl("https://example.test");
  intent.openFile({ uri: "file:///tmp/a" });

  return createElement("p", null, "files idle");
};

it.effect("guards file picker and intent actions during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Files read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(RadicalProvider, { layer }, createElement(FilesProbe))
      ),
      "<p>files idle</p>"
    );
  })
);

const VideoProbe = () => {
  const stream = useVideoStream({ viewfinder: { current: null } });
  assert.isFalse(stream.running);
  assert.isFalse(stream.loading);
  stream.start();
  stream.stop();
  stream.switchCamera();
  stream.setZoom(2);
  stream.setTorch(true);

  return createElement("p", null, "video idle");
};

it.effect("guards video stream actions during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Video read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(RadicalProvider, { layer }, createElement(VideoProbe))
      ),
      "<p>video idle</p>"
    );
  })
);

const HapticsProbe = () => {
  const feedback = useHapticFeedback();
  assert.isFalse(feedback.loading);
  assert.isUndefined(feedback.failure);
  assert.isUndefined(feedback.value);
  feedback.light();
  feedback.medium();
  feedback.heavy();
  feedback.success();
  feedback.warning();
  feedback.error();
  feedback.selection();
  feedback.impact();

  return createElement("p", null, "haptics idle");
};

it.effect("guards every haptic helper during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Haptics read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(RadicalProvider, { layer }, createElement(HapticsProbe))
      ),
      "<p>haptics idle</p>"
    );
  })
);

const NetworkProbe = () => {
  assert.deepStrictEqual(useNetworkStatus(), {
    loading: true,
    value: undefined,
    error: undefined,
  });

  return createElement("p", null, "network unknown");
};

it.effect(
  "renders network status as loading without accessing globals during SSR",
  () =>
    Effect.sync(() => {
      const layer = bridgeLayer(() =>
        assert.fail("Network read bridge during SSR")
      );

      assert.strictEqual(
        renderToString(
          createElement(RadicalProvider, { layer }, createElement(NetworkProbe))
        ),
        "<p>network unknown</p>"
      );
    })
);

const GoogleProbe = () => {
  const state = useGoogleSignIn();
  assert.isFalse(state.loading);
  assert.isUndefined(state.value);
  assert.isUndefined(state.error);
  state.signIn();
  state.cancel();

  return createElement("p", null, "google idle");
};

it.effect("guards Google sign-in during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Google sign-in read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(RadicalProvider, { layer }, createElement(GoogleProbe))
      ),
      "<p>google idle</p>"
    );
  })
);

const NotificationsProbe = () => {
  const permission = useNotificationPermission();
  const notifications = useNotifications();
  assert.isFalse(permission.loading);
  assert.isUndefined(permission.value);
  assert.isFalse(notifications.loading);
  assert.isUndefined(notifications.value);
  permission.check();
  permission.request();
  notifications.schedule({ id: 1, title: "SSR", delaySeconds: 1 });
  notifications.cancel(1);
  notifications.setBadge(1);
  notifications.clearBadge();
  notifications.registerPush();
  notifications.subscribe("demo");
  notifications.unsubscribe("demo");
  notifications.lookupTopics();

  return createElement("p", null, "notifications idle");
};

it.effect("guards every notification action during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Notifications read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(
          RadicalProvider,
          { layer },
          createElement(NotificationsProbe)
        )
      ),
      "<p>notifications idle</p>"
    );
  })
);

const DataProtectionProbe = () => {
  const protection = useDataProtection();
  assert.isFalse(protection.loading);
  assert.isUndefined(protection.value);
  protection.setEnabled(true);
  protection.setEnabled(false);
  protection.clearWebData();

  return createElement("p", null, "protection idle");
};

it.effect("guards data protection and clearing during server rendering", () =>
  Effect.sync(() => {
    const layer = bridgeLayer(() =>
      assert.fail("Data protection read bridge during SSR")
    );

    assert.strictEqual(
      renderToString(
        createElement(
          RadicalProvider,
          { layer },
          createElement(DataProtectionProbe)
        )
      ),
      "<p>protection idle</p>"
    );
  })
);
