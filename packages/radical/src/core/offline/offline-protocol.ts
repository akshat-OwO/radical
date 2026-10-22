import * as Schema from "effect/Schema";

import {
  offlineAppCachePrefix,
  offlineMessageLiterals,
  snapshotKey,
  snapshotSuffix,
} from "./offline-wire.ts";

export {
  isSnapshotCache,
  offlineAppCachePrefix,
  offlineCachePrefix,
  offlineMessages,
  snapshotCacheName,
  snapshotKey,
} from "./offline-wire.ts";

/** Both directions share this finite union. Unknown messages have no action. */
export const OfflineMessageSchema = Schema.Literals(offlineMessageLiterals);

export type OfflineMessage = typeof OfflineMessageSchema.Type;

export const decodeOfflineMessage =
  Schema.decodeUnknownOption(OfflineMessageSchema);

export const snapshotsDisabledKey = "__radicalDataCleared";

export const savedOfflineURLKeys = {
  android: "lastOfflineUrl",
  ios: "radical.lastOfflineURL",
} as const;

/** Project the literal Schema union into document-start JS without a runtime bundle. */
export const offlineProtocolScript = (appId: string) => `
  const decodeOfflineMessage = value => ${JSON.stringify(OfflineMessageSchema.literals)}.includes(value) ? value : undefined;
  const isSnapshotCache = name => name.startsWith(${JSON.stringify(offlineAppCachePrefix(appId))}) && name.endsWith(${JSON.stringify(snapshotSuffix)});
  const snapshotKey = ${snapshotKey.toString()};
`;
