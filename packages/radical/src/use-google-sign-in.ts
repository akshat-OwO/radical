import { useCallback } from "react";

import { googleSignIn, googleSignInLive } from "./google-sign-in.ts";
import type { GoogleIdentity, GoogleSignInError } from "./google-sign-in.ts";
import { useBridgeAction } from "./use-bridge-action.ts";
import type { ActionState } from "./use-bridge-action.ts";

export interface GoogleSignInState extends ActionState<
  GoogleIdentity,
  GoogleSignInError
> {
  readonly signIn: () => void;
  readonly cancel: () => void;
}
/** The identity token is available in value.idToken after success. */
export const useGoogleSignIn = (): GoogleSignInState => {
  const { run, ...state } = useBridgeAction<
    GoogleIdentity,
    GoogleSignInError
  >();
  const signIn = useCallback(() => {
    run(googleSignInLive(googleSignIn));
  }, [run]);
  return { ...state, signIn };
};
