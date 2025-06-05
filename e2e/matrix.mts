// ----- deps ----- //
import { execSync } from "node:child_process";

// ----- args ----- //
process.argv.shift(); // node
process.argv.shift(); // script
const peprExcellentExamplesPath = process.argv.shift(); // abs path to pepr-excellent-examples

// ----- main ----- //

// find examples
const cmd = "npm exec -c pwd -ws";
const stdout = execSync(cmd, { cwd: peprExcellentExamplesPath });
const examples = stdout.toLocaleString().trim().split("\n");

// select those with 'test:e2e' scripts
const raw = await Promise.all(
  examples.map(async ex => {
    const cfg = await import(`${ex}/package.json`, { assert: { type: "json" } });
    return [ex, cfg.default] as const;
  }),
);

const e2es = raw
  .filter(([, cfg]) => Object.hasOwn(cfg.scripts ?? {}, "test:e2e"))
  .filter(([, cfg]) => cfg.name !== "test-specific-version"); // requires package.json.bak which is only present when overriding the Pepr version

// gen matrix spec
const spec = {
  include: e2es.map(([ex, cfg]) => ({
    name: cfg.name,
    path: ex,
  })),
};

console.log(JSON.stringify(spec));
