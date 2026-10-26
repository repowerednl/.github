const RELEASE_BRANCH = "main";

const openReleasePullRequest = async ({ github, context }, branch) => {
  const { data: prs } = await github.rest.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: "open",
    base: RELEASE_BRANCH,
    head: `${context.repo.owner}:${branch}`,
  });
  return prs.length > 0;
};

const resolve = async ({ github, context, env }) => {
  const eventName = context.eventName;
  const branch = context.payload.workflow_run?.head_branch || env.GITHUB_REF_NAME || "";
  const deployToQa = env.DEPLOY_TO_QA === "true";

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const base = context.payload.pull_request?.base?.ref ?? "";
    const head = context.payload.pull_request?.head?.ref ?? "";
    const reason = `Pull request from \`${head}\` to \`${base}\`.`;
    return { environment: deployToQa && base === RELEASE_BRANCH ? "qa" : "dev", reason };
  }

  if (eventName !== "push" && eventName !== "workflow_run") {
    return { environment: "dev", reason: `\`${eventName}\` event.` };
  }

  if (branch === RELEASE_BRANCH) {
    return { environment: "prod", reason: `\`${eventName}\` on \`${branch}\`.` };
  }

  if (deployToQa && branch && (await openReleasePullRequest({ github, context }, branch))) {
    return {
      environment: "qa",
      reason: `\`${eventName}\` on \`${branch}\`, which has an open pull request to \`${RELEASE_BRANCH}\`.`,
    };
  }

  return { environment: "dev", reason: `\`${eventName}\` on \`${branch}\`.` };
};

module.exports = async ({ github, context, core, env = process.env }) => {
  const { environment, reason } = await resolve({ github, context, env });
  core.setOutput("environment", environment);
  await core.summary
    .addHeading(`🌍 Deploying to **${environment}**`, 3)
    .addRaw(`**Reason:** ${reason}`)
    .write();
  return environment;
};
