import { K8s } from ".";
import { kind } from "..";
import { WatchEvent } from "./watch";

const watcher = K8s(kind.CoreEvent).Watch((d, phase) => {
  console.log(`>-----> ${d.metadata?.name} (${d.metadata?.resourceVersion}) is ${phase}`);
});

watcher.events.on(WatchEvent.CONNECT, () => console.log("connected"));

watcher.events.on(WatchEvent.DATA, (_pod, phase) => {
  console.log("data received", phase);
});

watcher.events.on(WatchEvent.BOOKMARK, bookmark => console.log(`bookmark:`, bookmark));

watcher.events.on(WatchEvent.NETWORK_ERROR, e => console.error(`network error:`, e));

watcher.events.on(WatchEvent.RETRY, e => console.error(`retrying:`, e));

watcher.events.on(WatchEvent.GIVE_UP, e => console.error(`giving up:`, e));

watcher.events.on(WatchEvent.ABORT, e => console.error(`aborting:`, e));

watcher.events.on(WatchEvent.RESOURCE_VERSION, rv => console.log(`resource version:`, rv));

watcher.events.on(WatchEvent.OLD_RESOURCE_VERSION, rv => console.log(`old resource version:`, rv));

watcher.events.on(WatchEvent.DATA_ERROR, e => console.error(`data error:`, e));

watcher.start().catch(e => console.error(`failed to start:`, e));

process.on("unhandledRejection", (reason, p) => {
  console.trace("Unhandled Rejection at: Promise", p, "reason:", reason);
});

process.on("uncaughtException", err => {
  console.trace("Uncaught Exception:", err);
});

process.on("SIGINT", () => {
  console.trace("Caught interrupt signal");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.trace("Caught terminate signal");
  process.exit(0);
});

process.on("exit", () => {
  console.trace("Exiting");
});

process.on("beforeExit", () => {
  console.trace("Before exit");
});

// Hold the process open for a day
setTimeout(
  () => {
    console.log("Done");
  },
  1000 * 60 * 60 * 24,
);
