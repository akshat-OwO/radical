import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import {
  offlineHandler,
  withBundledRequests,
} from "radical/tanstack-start-server";

export default {
  fetch: withBundledRequests(
    createStartHandler(offlineHandler(defaultStreamHandler))
  ),
};
