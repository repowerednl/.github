const fs = require("fs");
const path = require("path");

const { matchVersion, toList } = require("./version-lines.js");

const DEFAULT_VERSION_FILES = "package.json";

const normalizeName = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

const projectName = (lines) => {
  let section = null;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section === "project" || section === "tool.poetry") {
      const found = line.match(/^name\s*=\s*["']([^"']+)["']\s*$/);
      if (found) {
        return found[1];
      }
    }
  }
  return null;
};

const lockVersionIndex = (lines, name) => {
  const wanted = normalizeName(name);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "[[package]]") {
      continue;
    }
    const nameLine = (lines[i + 1] || "").match(/^name\s*=\s*"([^"]+)"\s*$/);
    if (!nameLine || normalizeName(nameLine[1]) !== wanted) {
      continue;
    }
    for (let j = i + 2; j < lines.length && lines[j].trim() !== "" && !lines[j].startsWith("["); j++) {
      if (/^version\s*=/.test(lines[j]) && matchVersion(lines[j])) {
        return j;
      }
    }
    return -1;
  }
  return -1;
};

module.exports = async ({ core, env = process.env }) => {
  const target = (env.TAG || "").replace(/^v/, "");
  const files = toList(env.VERSION_FILES ?? DEFAULT_VERSION_FILES);

  if (!target) {
    core.setFailed("No tag was given to bump to.");
    return null;
  }

  if (!files.length) {
    core.setFailed("No version files were configured.");
    return null;
  }

  const rows = [];
  const bumped = [];

  const read = (file) => {
    try {
      return fs.readFileSync(file, "utf8").split("\n");
    } catch (error) {
      core.setFailed(`Could not read ${file}: ${error.message}`);
      return null;
    }
  };

  const bumpLine = (file, lines, index) => {
    const { prefix, version, suffix } = matchVersion(lines[index]);

    if (version === target) {
      rows.push([file, version, "already at the target"]);
      return;
    }

    lines[index] = `${prefix}${target}${suffix}`;
    fs.writeFileSync(file, lines.join("\n"));
    rows.push([file, version, target]);
    bumped.push(file);
  };

  for (const file of files) {
    const lines = read(file);
    if (!lines) {
      return null;
    }

    const index = lines.findIndex((line) => matchVersion(line) !== null);
    if (index === -1) {
      core.setFailed(`No version declaration found in ${file}.`);
      return null;
    }

    bumpLine(file, lines, index);

    if (path.posix.basename(file) !== "pyproject.toml") {
      continue;
    }

    const lockFile = path.posix.join(path.posix.dirname(file), "uv.lock");
    if (!fs.existsSync(lockFile)) {
      continue;
    }

    const name = projectName(lines);
    if (!name) {
      core.setFailed(`No project name found in ${file} to locate it in ${lockFile}.`);
      return null;
    }

    const lockLines = read(lockFile);
    if (!lockLines) {
      return null;
    }

    const lockIndex = lockVersionIndex(lockLines, name);
    if (lockIndex === -1) {
      core.setFailed(`No version for project ${name} found in ${lockFile}.`);
      return null;
    }

    bumpLine(lockFile, lockLines, lockIndex);
  }

  core.setOutput("needs_bump", bumped.length > 0);
  core.setOutput("version", target);
  core.setOutput("bumped_files", bumped.join(","));

  await core.summary
    .addHeading(
      bumped.length > 0 ? "⬆️ Bumping the version" : "♻️ Leaving the version alone",
      3,
    )
    .addTable([
      [
        { data: "File", header: true },
        { data: "From", header: true },
        { data: "To", header: true },
      ],
      ...rows,
    ])
    .write();

  return { target, bumped, rows };
};
