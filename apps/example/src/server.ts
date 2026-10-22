import {
  offlineHandler,
  withBundledRequests,
} from "@akshatowo/radical/tanstack-start-server";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

export default {
  fetch: withBundledRequests(
    createStartHandler(offlineHandler(defaultStreamHandler))
  ),
};
