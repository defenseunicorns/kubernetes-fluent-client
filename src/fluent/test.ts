import { readFileSync, writeFileSync } from "fs";

import { K8s } from ".";
import { kind } from "..";
import { WatchEvent } from "./watch";

// load the resource version from the file "resource-version.txt"
let resourceVersion: string | undefined = undefined;
try {
  const buffer = readFileSync("resource-version.txt", "utf8");
  if (buffer) {
    resourceVersion = buffer.toString();
  }
} catch (e) {
  // ignore
}

const watcher = K8s(kind.Pod).Watch(
  (d, phase) => {
    console.log(`>-----> ${d.metadata?.name} (${d.metadata?.resourceVersion}) is ${phase}`);
  },
  {
    resourceVersion,
  },
);

watcher.events.on(WatchEvent.CONNECT, () => console.log("connected"));

watcher.events.on(WatchEvent.DATA, (_pod, phase) => {
  console.log("data received", phase);
});

watcher.events.on(WatchEvent.BOOKMARK, bookmark => console.log(`bookmark:`, bookmark));

watcher.events.on(WatchEvent.NETWORK_ERROR, e => console.error(`network error:`, e));

watcher.events.on(WatchEvent.RECONNECT, e => console.error(`reconnecting:`, e));

watcher.events.on(WatchEvent.GIVE_UP, e => console.error(`giving up:`, e));

watcher.events.on(WatchEvent.ABORT, e => console.error(`aborting:`, e));

watcher.events.on(WatchEvent.RESYNC, e => console.error(`resyncing:`, e));

watcher.events.on(WatchEvent.RESOURCE_VERSION, rv => {
  console.log(`resource version:`, rv);
  // persist the resource version
  writeFileSync("resource-version.txt", rv || "", "utf8");
});

watcher.events.on(WatchEvent.OLD_RESOURCE_VERSION, rv => console.log(`old resource version:`, rv));

watcher.events.on(WatchEvent.DATA_ERROR, e => console.error(`data error:`, e));

watcher.events.on(WatchEvent.RECONNECT_PENDING, () => console.log(`reconnect pending`));

watcher
  .start()
  .then(() => {
    console.log("started");
    console.log("cache id: ", watcher.id);
  })
  .catch(e => console.error(`failed to start:`, e));
