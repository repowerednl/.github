const assert = require("node:assert/strict");
const { test } = require("node:test");

const yarnSetup = require("./yarn-setup.js");

const { toCommands } = yarnSetup;

const buildCore = () => {
  const failures = [];
  const groups = [];
  const raw = [];
  const tables = [];
  const summary = {
    addHeading: () => summary,
    addRaw: (text) => {
      raw.push(text);
      return summary;
    },
    addTable: (table) => {
      tables.push(table);
      return summary;
    },
    write: async () => summary,
  };
  return {
    failures,
    groups,
    raw,
    tables,
    group: async (name, fn) => {
      groups.push(name);
      return fn();
    },
    setFailed: (message) => failures.push(message),
    summary,
  };
};

const buildExec = (exitCodes = {}) => {
  const calls = [];
  return {
    calls,
    exec: async (command) => {
      calls.push(command);
      return exitCodes[command] ?? 0;
    },
  };
};

const run = (setupCommands, exitCodes) => {
  const core = buildCore();
  const exec = buildExec(exitCodes);
  const result = yarnSetup({
    core,
    exec,
    nodeVersion: "v24.11.0",
    yarnVersion: "4.9.2",
    env: { SETUP_COMMANDS: setupCommands },
  });
  return { core, exec, result };
};

test("toCommands always starts with the yarn install", () => {
  assert.deepEqual(toCommands(""), ["yarn install --immutable"]);
  assert.deepEqual(toCommands(), ["yarn install --immutable"]);
});

test("toCommands adds every non-empty, trimmed line", () => {
  assert.deepEqual(
    toCommands(
      "  yarn playwright install --with-deps chromium \n\n yarn foo\n",
    ),
    [
      "yarn install --immutable",
      "yarn playwright install --with-deps chromium",
      "yarn foo",
    ],
  );
});

test("runs only the yarn install without setup commands", async () => {
  const { core, exec, result } = run("");
  const { failed } = await result;

  assert.deepEqual(exec.calls, ["yarn install --immutable"]);
  assert.deepEqual(core.groups, ["yarn install --immutable"]);
  assert.equal(failed, null);
  assert.deepEqual(core.failures, []);
});

test("runs the setup commands in order after the yarn install", async () => {
  const { exec, core, result } = run("yarn a\nyarn b");
  const { rows } = await result;

  assert.deepEqual(exec.calls, [
    "yarn install --immutable",
    "yarn a",
    "yarn b",
  ]);
  assert.deepEqual(rows, [
    ["yarn install --immutable", "✅"],
    ["yarn a", "✅"],
    ["yarn b", "✅"],
  ]);
  assert.deepEqual(core.failures, []);
});

test("stops at a failing command, skips the rest and fails naming it", async () => {
  const { exec, core, result } = run("yarn a\nyarn b", { "yarn a": 2 });
  const { rows, failed } = await result;

  assert.deepEqual(exec.calls, ["yarn install --immutable", "yarn a"]);
  assert.deepEqual(rows, [
    ["yarn install --immutable", "✅"],
    ["yarn a", "❌ exit code 2"],
    ["yarn b", "⏭️ skipped"],
  ]);
  assert.equal(failed, "yarn a");
  assert.deepEqual(core.failures, [
    "Setting up the dependencies failed on: yarn a",
  ]);
});

test("a failing yarn install skips all setup commands", async () => {
  const { exec, core, result } = run("yarn a", {
    "yarn install --immutable": 1,
  });
  const { rows } = await result;

  assert.deepEqual(exec.calls, ["yarn install --immutable"]);
  assert.deepEqual(rows[1], ["yarn a", "⏭️ skipped"]);
  assert.equal(core.failures.length, 1);
});

test("writes the versions and the results to the job summary", async () => {
  const { core, result } = run("yarn a");
  await result;

  assert.deepEqual(core.raw, ["Node.js v24.11.0 · yarn 4.9.2"]);
  assert.equal(core.tables.length, 1);
  assert.equal(core.tables[0].length, 3);
});
