// ----- deps ----- //
const { execSync } = require("node:child_process");

// ----- args ----- //
process.argv.shift(); // node
process.argv.shift(); // script
const peprExcellentExamplesPath = process.argv.shift(); // abs path to pepr-excellent-examples

// ----- main ----- //

// find examples
let cmd = "npm exec -c pwd -ws";
let stdout = execSync(cmd, { cwd: peprExcellentExamplesPath });
let examples = stdout.toLocaleString().trim().split("\n");

// select those with 'test:e2e' scripts
let e2es = examples
  .map(ex => [ex, require(`${ex}/package.json`)])
  .filter(([ex, cfg]) => Object.hasOwn(cfg.scripts, "test:e2e"))
  .filter(([ex, cfg]) => cfg.name !== "test-specific-version"); // requires package.json.bak which is only present when overriding the Pepr version

// gen matrix spec
let spec = {
  include: e2es.map(([ex, cfg]) => ({
    name: cfg.name,
    path: ex,
  })),
};

console.log(JSON.stringify(spec));
