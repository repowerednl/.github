const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test, after } = require("node:test");

const updateVersionFiles = require("./update-version-files.js");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "update-version-files-"));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
const bump = async (files, tag, versionFiles) => {
  const dir = path.join(workspace, `case-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  const outputs = {};
  const failures = [];
  const core = {
    setOutput: (name, value) => {
      outputs[name] = String(value);
    },
    setFailed: (message) => failures.push(message),
    summary: {
      addHeading: () => core.summary,
      addRaw: () => core.summary,
      addTable: () => core.summary,
      write: async () => core.summary,
    },
  };

  const cwd = process.cwd();
  process.chdir(dir);
  let result;
  try {
    result = await updateVersionFiles({
      core,
      env: { TAG: tag, VERSION_FILES: versionFiles ?? Object.keys(files).join(",") },
    });
  } finally {
    process.chdir(cwd);
  }

  const after = {};
  for (const name of Object.keys(files)) {
    after[name] = fs.readFileSync(path.join(dir, name), "utf8");
  }
  return { outputs, failures, result, after };
};

const PKG = '{\n  "name": "workflow-tests",\n  "version": "16.0.4",\n  "private": true\n}\n';
const PYPROJECT = '[project]\nname = "workflow-tests"\nversion = "16.0.4"\n\n[tool.poetry.dependencies]\ndjango = "^5.2"\n';
const DOCKERFILE = "ARG PYTHON_VERSION=3.11.10\nFROM python:${PYTHON_VERSION}-alpine\nARG VERSION=16.0.4\nARG ARG_1=1\n";

test("bumps every configured file to the same version", async () => {
  const { outputs, after } = await bump(
    { "package.json": PKG, "pyproject.toml": PYPROJECT, Dockerfile: DOCKERFILE },
    "v16.0.5",
  );

  assert.equal(outputs.needs_bump, "true");
  assert.equal(outputs.version, "16.0.5");
  assert.equal(JSON.parse(after["package.json"]).version, "16.0.5");
  assert.match(after["pyproject.toml"], /^version = "16\.0\.5"$/m);
  assert.match(after.Dockerfile, /^ARG VERSION=16\.0\.5$/m);
});

test("pulls a drifted file back in line with the others", async () => {
  const drifted = PYPROJECT.replace('"16.0.4"', '"0.1.0"');
  const { after } = await bump(
    { "package.json": PKG, "pyproject.toml": drifted },
    "v16.0.5",
  );

  assert.equal(JSON.parse(after["package.json"]).version, "16.0.5");
  assert.match(after["pyproject.toml"], /^version = "16\.0\.5"$/m);
});

test("needs_bump is true when only one file is behind", async () => {
  const current = DOCKERFILE.replace("ARG VERSION=16.0.4", "ARG VERSION=16.0.5");
  const { outputs, after } = await bump(
    { "package.json": PKG, Dockerfile: current },
    "v16.0.5",
  );

  assert.equal(outputs.needs_bump, "true");
  assert.equal(outputs.bumped_files, "package.json");
  assert.equal(JSON.parse(after["package.json"]).version, "16.0.5");
});

test("does nothing when every file already holds the target", async () => {
  const pkg = PKG.replace("16.0.4", "16.0.5");
  const dockerfile = DOCKERFILE.replace("ARG VERSION=16.0.4", "ARG VERSION=16.0.5");
  const { outputs, after } = await bump(
    { "package.json": pkg, Dockerfile: dockerfile },
    "v16.0.5",
  );

  assert.equal(outputs.needs_bump, "false");
  assert.equal(outputs.bumped_files, "");
  assert.equal(after["package.json"], pkg);
  assert.equal(after.Dockerfile, dockerfile);
});

test("leaves a Dockerfile toolchain pin alone", async () => {
  const { after } = await bump({ Dockerfile: DOCKERFILE }, "v16.0.5");
  assert.match(after.Dockerfile, /^ARG PYTHON_VERSION=3\.11\.10$/m);
  assert.match(after.Dockerfile, /^FROM python:\$\{PYTHON_VERSION\}-alpine$/m);
});

test("leaves a pyproject dependency constraint alone", async () => {
  const { after } = await bump({ "pyproject.toml": PYPROJECT }, "v16.0.5");
  assert.match(after["pyproject.toml"], /^django = "\^5\.2"$/m);
});

test("preserves formatting exactly", async () => {
  const { after } = await bump({ "package.json": PKG }, "v16.0.5");
  assert.equal(after["package.json"], PKG.replace("16.0.4", "16.0.5"));
});

test("writes a prerelease version through", async () => {
  const { after } = await bump({ "package.json": PKG }, "v16.0.5-beta.3");
  assert.equal(JSON.parse(after["package.json"]).version, "16.0.5-beta.3");
});

test("accepts a tag without the leading v", async () => {
  const { after } = await bump({ "package.json": PKG }, "16.0.5");
  assert.equal(JSON.parse(after["package.json"]).version, "16.0.5");
});

test("bumps a nested file", async () => {
  const { after } = await bump(
    { "vue-test/package.json": PKG },
    "v16.0.5",
    "vue-test/package.json",
  );
  assert.equal(JSON.parse(after["vue-test/package.json"]).version, "16.0.5");
});

test("fails when a configured file has no version declaration", async () => {
  const { failures, outputs } = await bump(
    { Dockerfile: "FROM alpine\nARG PYTHON_VERSION=3.11\n" },
    "v16.0.5",
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /No version declaration found in Dockerfile/);
  assert.equal(outputs.needs_bump, undefined, "nothing is committed on failure");
});

test("fails when a configured file does not exist", async () => {
  const { failures } = await bump({ "package.json": PKG }, "v16.0.5", "package.json,missing.toml");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Could not read missing\.toml/);
});

test("fails when no files are configured", async () => {
  const { failures } = await bump({ "package.json": PKG }, "v16.0.5", "");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /No version files were configured/);
});

test("fails when no tag is given", async () => {
  const { failures } = await bump({ "package.json": PKG }, "");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /No tag was given/);
});
