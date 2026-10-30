import {
  radical,
  tanstackStartOptions,
} from "@akshatowo/radical/tanstack-start";
import type { RadicalConfig } from "@akshatowo/radical/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const config = {
  version: "1.2.3",
  build: 127,
  navigation: {
    android: {
      labels: "labeled",
      colors: {
        container: { light: "#EDE4FF", dark: "#241538" },
        indicator: { light: "#D1BCFF", dark: "#553A78" },
        badge: { light: "#9C2454", dark: "#FFB0CC" },
        icon: {
          selected: { light: "#3D1963", dark: "#F0DBFF" },
          unselected: { light: "#62536F", dark: "#CDBDDD" },
        },
        label: {
          selected: { light: "#3D1963", dark: "#F0DBFF" },
          unselected: { light: "#62536F", dark: "#CDBDDD" },
        },
      },
    },
    sections: [
      {
        id: "home",
        title: "Home",
        route: "/",
        icon: { ios: "house", android: "./assets/home.svg" },
        selectedIcon: { ios: "house.fill", android: "./assets/home.svg" },
      },
      {
        id: "about",
        title: "About",
        route: "/about",
        icon: { ios: "info.circle", android: "./assets/about.svg" },
      },
    ],
  },
  appId: "dev.radical.example",
  name: "Radical",
  android: {
    name: "Radical Android",
    packageId: "dev.radical.example.android",
  },
  ios: { name: "Radical iOS", bundleId: "dev.radical.example.ios" },
  icon: { image: "./assets/icon.png", backgroundColor: "#6d28d9" },
  splash: { image: "./assets/splash.png", backgroundColor: "#241044" },
  plugins: [{ manifest: "./plugins/echo.ts" }],
  internalPlugins: {
    googleSignIn: true,
    network: true,
    notifications: true,
    pushNotifications: true,
    location: true,
    camera: true,
    videoStream: true,
    filePicker: true,
    intents: true,
    haptics: true,
    dataProtection: true,
  },
  pluginOptions: {
    Location: {
      usageDescription: "Show your location on the example map.",
      precisePurposes: {
        navigation: "Follow your precise location while navigating.",
      },
    },
    GoogleSignIn: {
      webClientId:
        process.env.GOOGLE_WEB_CLIENT_ID ??
        "configure-web.apps.googleusercontent.com",
      iosClientId:
        process.env.GOOGLE_IOS_CLIENT_ID ??
        "configure-ios.apps.googleusercontent.com",
    },
    VideoStream: {
      usageDescription: "Show a live camera preview and scan QR codes.",
    },
    Echo: { prefix: "Native: " },
    Camera: {
      photoLibraryUsageDescription:
        "Choose a photo to preview it in the Radical example.",
      usageDescription: "Take a photo to preview it in the Radical example.",
    },
  },
  devHost: "localhost",
  mode: "remote",
  origin: "http://localhost:4173",
} satisfies RadicalConfig;

export default defineConfig({
  plugins: [
    tanstackStart(tanstackStartOptions(config)),
    radical(config),
    react(),
  ],
});
