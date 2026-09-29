const fs = require("fs");

const { matchVersion, toList } = require("./version-lines.js");

const DEFAULT_VERSION_FILES = "package.json";

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

  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n");
    } catch (error) {
      core.setFailed(`Could not read ${file}: ${error.message}`);
      return null;
    }

    const index = lines.findIndex((line) => matchVersion(line) !== null);
    if (index === -1) {
      core.setFailed(`No version declaration found in ${file}.`);
      return null;
    }

    const { prefix, version, suffix } = matchVersion(lines[index]);

    if (version === target) {
      rows.push([file, version, "already at the target"]);
      continue;
    }

    lines[index] = `${prefix}${target}${suffix}`;
    fs.writeFileSync(file, lines.join("\n"));
    rows.push([file, version, target]);
    bumped.push(file);
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
