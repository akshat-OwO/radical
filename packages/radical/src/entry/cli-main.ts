#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

import manifest from "../../package.json" with { type: "json" };
import { assetGeneratorLayer } from "../native/assets/native-assets.ts";
import { pluginModulesLayer } from "../vite/plugins/plugin-plan.ts";
import { cliNativeLayer, makeCli } from "./cli.ts";
import { cliViteLayer } from "./prepare-native.ts";

Command.run(makeCli(process.cwd()), { version: manifest.version }).pipe(
  Effect.provide(
    Layer.mergeAll(
      cliNativeLayer,
      cliViteLayer,
      pluginModulesLayer(process.cwd()),
      assetGeneratorLayer,
      NodeServices.layer
    )
  ),
  (program) => {
    NodeRuntime.runMain(program);
  }
);
