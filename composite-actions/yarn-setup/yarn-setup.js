const INSTALL_COMMAND = "yarn install --immutable";

const toCommands = (setupCommands = "") => [
  INSTALL_COMMAND,
  ...setupCommands
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
];

module.exports = async ({
  core,
  exec,
  nodeVersion,
  yarnVersion,
  env = process.env,
}) => {
  const commands = toCommands(env.SETUP_COMMANDS);
  const rows = [];
  let failed = null;

  for (const command of commands) {
    if (failed) {
      rows.push([command, "⏭️ skipped"]);
      continue;
    }
    const exitCode = await core.group(command, () =>
      exec.exec(command, [], { ignoreReturnCode: true }),
    );
    rows.push([command, exitCode === 0 ? "✅" : `❌ exit code ${exitCode}`]);
    if (exitCode !== 0) {
      failed = command;
    }
  }

  if (failed || commands.length > 1) {
    await core.summary
      .addHeading("Dependencies", 3)
      .addRaw(`Node.js ${nodeVersion} · yarn ${yarnVersion}`, true)
      .addTable([
        [
          { data: "Command", header: true },
          { data: "Result", header: true },
        ],
        ...rows,
      ])
      .write();
  }

  if (failed) {
    core.setFailed(`Setting up the dependencies failed on: ${failed}`);
  }

  return { rows, failed };
};

module.exports.toCommands = toCommands;
