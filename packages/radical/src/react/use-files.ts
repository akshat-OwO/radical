import { Effect } from "effect";
import { useCallback } from "react";

import { filesLive, pickFiles } from "../capabilities/files/file-picker.ts";
import type {
  FilePickerError,
  PickedFile,
  PickFilesOptions,
} from "../capabilities/files/file-picker.ts";
import {
  intentsLive,
  openFile,
  openUrl,
} from "../capabilities/files/intents.ts";
import type {
  IntentError,
  OpenableFile,
  OpenFileOptions,
} from "../capabilities/files/intents.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

export interface FilePickerState extends ActionState<
  readonly PickedFile[],
  FilePickerError
> {
  readonly pick: (options?: PickFilesOptions) => void;
}

export interface IntentState extends ActionState<true, IntentError> {
  readonly openUrl: (url: string) => void;
  readonly openFile: (file: OpenableFile, options?: OpenFileOptions) => void;
}

export const useFilePicker = (): FilePickerState => {
  const { run, ...state } = useBridgeAction<
    readonly PickedFile[],
    FilePickerError
  >();

  return {
    ...state,
    pick: useCallback(
      (options?: PickFilesOptions) => {
        run(filesLive(pickFiles(options)));
      },
      [run]
    ),
  };
};

const opened = true as const;

/** `value` is `true` once the URL or file was handed to another app. */
export const useIntent = (): IntentState => {
  const { run, ...state } = useBridgeAction<true, IntentError>();

  return {
    ...state,
    openUrl: useCallback(
      (url: string) => {
        run(intentsLive(openUrl(url)).pipe(Effect.as(opened)));
      },
      [run]
    ),
    openFile: useCallback(
      (file: OpenableFile, options?: OpenFileOptions) => {
        run(intentsLive(openFile(file, options)).pipe(Effect.as(opened)));
      },
      [run]
    ),
  };
};
