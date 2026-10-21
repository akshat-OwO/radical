import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { withBundledRequests } from "radical/server";
import { offlineHandler } from "radical/tanstack-start-server";

export default {
  fetch: withBundledRequests(
    createStartHandler(offlineHandler(defaultStreamHandler))
  ),
};
