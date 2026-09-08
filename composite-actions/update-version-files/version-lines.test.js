const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  matchVersion,
  isVersionLine,
  isVersionOnlyPatch,
  isVersionFile,
  toList,
} = require("./version-lines.js");

const MATCH = [
  ['  "version": "11.7.1",', "11.7.1", "package.json"],
  ['version = "1.2.3"', "1.2.3", "pyproject [project]"],
  ['version = "2024.11.1"', "2024.11.1", "calendar version"],
  ["version: 1.2.3", "1.2.3", "Chart.yaml unquoted"],
  ['version: "1.2.3"', "1.2.3", "Chart.yaml quoted"],
  ["version = 1.2.3", "1.2.3", "setup.cfg"],
  ['__version__ = "1.2.3"', "1.2.3", "python dunder"],
  ['version = "1.2.3-beta.0"', "1.2.3-beta.0", "prerelease"],
  ['version = "1.2.3.dev0"', "1.2.3.dev0", "python dev version"],
  ["ARG VERSION=1.2.3", "1.2.3", "Dockerfile ARG"],
  ["ARG APP_VERSION=1.2.3", "1.2.3", "Dockerfile ARG APP_VERSION"],
  ["ENV VERSION=1.2.3", "1.2.3", "Dockerfile ENV"],
  ['ENV APP_VERSION="1.2.3"', "1.2.3", "Dockerfile ENV quoted"],
  ['LABEL version="1.2.3"', "1.2.3", "Dockerfile LABEL"],
  ['LABEL org.opencontainers.image.version="1.2.3"', "1.2.3", "OCI label"],
];

const IGNORE = [
  ['  "name": "repower-frontend",', "a different json key"],
  ['  "vue": "3.5.0",', "a json dependency"],
  ['django = "^5.2"', "a toml dependency"],
  ['version = "^5.2"', "a caret constraint"],
  ['version = ">=1.2"', "a range constraint"],
  ['version = "1.2.*"', "a wildcard constraint"],
  ['        "version": "3.5.0",', "a nested lockfile dependency"],
  ["    version: 3.5.0", "an indented Chart.yaml dependency"],
  ['  "description": "1.2.3",', "a different key holding a version"],
  ['const version = "1.2.3";', "source code"],
  ["ARG PYTHON_VERSION=3.11", "a toolchain pin, live in owen/Dockerfile"],
  ["ENV POETRY_VERSION=1.5.1", "a toolchain pin, live in BST-backend/Dockerfile"],
  ["ARG NODE_VERSION=20", "a toolchain pin"],
  ["ARG POETRY_VERSION", "declared without a value"],
  ["FROM node:20-alpine", "a base image"],
  ["ARG HEAP_MEMORY=4096", "a size, not a version"],
  ["ARG ARG_1=1", "a build arg"],
  ['LABEL authors="fanna"', "a non-version label"],
  ['appVersion: "1.0"', "Chart.yaml appVersion is out of scope"],
  ['    version: "2.3.3"', "a helmfile chart pin is out of scope"],
];

test("recognises a version declaration and captures the value", () => {
  for (const [line, expected, why] of MATCH) {
    const found = matchVersion(line);
    assert.notEqual(found, null, `should match (${why}): ${line}`);
    assert.equal(found.version, expected, `wrong capture (${why}): ${line}`);
    assert.equal(
      `${found.prefix}${found.version}${found.suffix}`,
      line,
      `prefix + version + suffix must rebuild the line exactly (${why})`,
    );
  }
});

test("ignores everything that is not a version declaration", () => {
  for (const [line, why] of IGNORE) {
    assert.equal(isVersionLine(line), false, `should ignore (${why}): ${line}`);
  }
});

test("rewriting a line preserves quoting and trailing punctuation", () => {
  const cases = [
    ['  "version": "1.0.0",', '  "version": "2.0.0",'],
    ['version = "1.0.0"', 'version = "2.0.0"'],
    ["version: 1.0.0", "version: 2.0.0"],
    ["ARG VERSION=1.0.0", "ARG VERSION=2.0.0"],
    ['ENV APP_VERSION="1.0.0"', 'ENV APP_VERSION="2.0.0"'],
  ];
  for (const [before, expected] of cases) {
    const { prefix, suffix } = matchVersion(before);
    assert.equal(`${prefix}2.0.0${suffix}`, expected);
  }
});

test("a patch of only version lines is version-only", () => {
  const patch = '@@ -1,3 +1,3 @@\n {\n-  "version": "1.0.0",\n+  "version": "1.0.1",\n }';
  assert.equal(isVersionOnlyPatch(patch), true);
});

test("a patch touching anything else is not version-only", () => {
  const patch = '@@ -1,3 +1,3 @@\n-  "version": "1.0.0",\n+  "version": "1.0.1",\n-    "vue": "3.4.0"\n+    "vue": "3.5.0"';
  assert.equal(isVersionOnlyPatch(patch), false);
});

test("a Dockerfile toolchain bump is not version-only", () => {
  assert.equal(
    isVersionOnlyPatch("@@ -1,2 +1,2 @@\n-ARG PYTHON_VERSION=3.11\n+ARG PYTHON_VERSION=3.12"),
    false,
  );
});

test("a Dockerfile app version bump is version-only", () => {
  assert.equal(
    isVersionOnlyPatch("@@ -1,2 +1,2 @@\n-ARG VERSION=1.0.0\n+ARG VERSION=1.0.1"),
    true,
  );
});

test("the +++ and --- headers are not counted as changed lines", () => {
  const patch = '--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-  "version": "1.0.0"\n+  "version": "1.0.1"';
  assert.equal(isVersionOnlyPatch(patch), true);
});

test("an absent or empty patch is never version-only", () => {
  assert.equal(isVersionOnlyPatch(undefined), false);
  assert.equal(isVersionOnlyPatch(""), false);
});

test("version files match on an exact name or a path suffix", () => {
  const files = toList("package.json,pyproject.toml,Chart.yaml,Dockerfile");
  assert.equal(isVersionFile("package.json", files), true);
  assert.equal(isVersionFile("vue-test/package.json", files), true);
  assert.equal(isVersionFile("deployment/Chart.yaml", files), true);
  assert.equal(isVersionFile("django-test/pyproject.toml", files), true);
  assert.equal(isVersionFile("src/app.js", files), false);
  assert.equal(isVersionFile("package-lock.json", files), false);
  assert.equal(isVersionFile("Dockerfile.vue-test", files), false);
});

test("toList trims and drops blanks", () => {
  assert.deepEqual(toList(" a , b ,, c "), ["a", "b", "c"]);
  assert.deepEqual(toList(""), []);
  assert.deepEqual(toList(undefined), []);
});
