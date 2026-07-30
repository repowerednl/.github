const SOURCE = "main";
const TARGET = "dev";
const CONFLICT_MARKER = "<!-- repowered-merge-back-conflict -->";
const MERGEABLE_POLL_ATTEMPTS = 12;
const MERGEABLE_POLL_SECONDS = 5;
const MAX_REVIEWERS = 15;
const MAX_ASSIGNEES = 10;

const RESULTS = {
  "up-to-date": `✅ ${TARGET} already contains ${SOURCE}`,
  merged: `✅ ${SOURCE} has been merged into ${TARGET}`,
  "auto-merge-enabled":
    "⏳ auto-merge is enabled, the pull request merges once the required checks pass",
  conflict: "⚠️ merge conflict, the pull request stays open",
  blocked: "⚠️ GitHub refused the merge, the pull request stays open",
  unknown:
    "⚠️ GitHub could not determine the mergeability, the pull request stays open",
};

const toList = (value) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const sleepSeconds = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const humanAuthors = (commits) => [
  ...new Set(
    (commits || [])
      .map((commit) => commit.author)
      .filter(
        (author) =>
          author &&
          author.login &&
          author.type !== "Bot" &&
          !author.login.endsWith("[bot]"),
      )
      .map((author) => author.login),
  ),
];

module.exports = async ({
  github,
  context,
  core,
  env = process.env,
  sleep = sleepSeconds,
}) => {
  const { owner, repo } = context.repo;

  const report = async (status, detail, pullRequest) => {
    core.setOutput("status", status);
    core.setOutput(
      "pull_request_number",
      pullRequest ? String(pullRequest.number) : "",
    );
    core.setOutput("pull_request_url", pullRequest ? pullRequest.html_url : "");
    core.info(`status=${status} :: ${detail}`);
    if (status !== "merged" && status !== "up-to-date") {
      core.warning(`${RESULTS[status]} :: ${detail}`);
    }
    await core.summary
      .addHeading(`Merge ${SOURCE} back into ${TARGET}`, 3)
      .addTable([
        [
          { data: "Field", header: true },
          { data: "Value", header: true },
        ],
        ["Result", RESULTS[status]],
        [
          "Pull request",
          pullRequest
            ? `<a href="${pullRequest.html_url}">#${pullRequest.number}</a>`
            : "-",
        ],
        ["Detail", detail],
      ])
      .write();
    return status;
  };

  const attempt = async (description, action) => {
    try {
      await action();
      return true;
    } catch (error) {
      core.warning(`${description} failed: ${error.message}`);
      return false;
    }
  };

  const findOpenPullRequest = async () => {
    const { data: open } = await github.rest.pulls.list({
      owner,
      repo,
      base: TARGET,
      head: `${owner}:${SOURCE}`,
      state: "open",
    });
    return open[0];
  };

  const createPullRequest = async (comparison) => {
    const { data: pullRequest } = await github.rest.pulls.create({
      owner,
      repo,
      base: TARGET,
      head: SOURCE,
      title: `Merge ${SOURCE} back into ${TARGET}`,
      body: [
        `Automated merge of \`${SOURCE}\` back into \`${TARGET}\`, containing ` +
          `${comparison.ahead_by} commit(s) that only exist on \`${SOURCE}\`.`,
        "",
        "This pull request is merged automatically with a merge commit (never a " +
          "squash) as soon as GitHub reports it as mergeable. It only stays open when " +
          "that is not possible, in which case the requested reviewers have to resolve it.",
      ].join("\n"),
    });
    core.info(`Created pull request #${pullRequest.number}.`);

    const labels = toList(env.LABELS);
    if (labels.length) {
      await attempt(`Adding the labels ${labels.join(", ")}`, () =>
        github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pullRequest.number,
          labels,
        }),
      );
    }
    return pullRequest;
  };

  const waitForMergeability = async (pullRequest) => {
    let current = pullRequest;
    for (
      let poll = 0;
      poll < MERGEABLE_POLL_ATTEMPTS && current.mergeable == null;
      poll += 1
    ) {
      await sleep(MERGEABLE_POLL_SECONDS);
      ({ data: current } = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: current.number,
      }));
    }
    core.info(
      `mergeable=${current.mergeable} mergeable_state=${current.mergeable_state}`,
    );
    return current;
  };

  const requestReviewers = async (pullRequest, comparison) => {
    const configured = toList(env.REVIEWERS);
    const reviewers = (
      configured.length ? configured : humanAuthors(comparison.commits)
    ).slice(0, MAX_REVIEWERS);
    if (!reviewers.length) {
      core.warning(
        `No reviewers could be determined for pull request #${pullRequest.number}.`,
      );
      return;
    }

    const requested = await attempt(
      `Requesting ${reviewers.join(", ")} as reviewer(s)`,
      () =>
        github.rest.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pullRequest.number,
          reviewers,
        }),
    );
    if (!requested) {
      for (const reviewer of reviewers) {
        await attempt(`Requesting ${reviewer} as reviewer`, () =>
          github.rest.pulls.requestReviewers({
            owner,
            repo,
            pull_number: pullRequest.number,
            reviewers: [reviewer],
          }),
        );
      }
    }
    await attempt(`Assigning ${reviewers.join(", ")}`, () =>
      github.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: pullRequest.number,
        assignees: reviewers.slice(0, MAX_ASSIGNEES),
      }),
    );
  };

  const commentOnce = async (pullRequest, detail) => {
    const { data: comments } = await github.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullRequest.number,
      per_page: 100,
    });
    if (
      comments.some((comment) => (comment.body || "").includes(CONFLICT_MARKER))
    ) {
      core.info("The conflict comment is already there, not commenting again.");
      return;
    }
    await attempt("Commenting on the pull request", () =>
      github.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullRequest.number,
        body: [
          CONFLICT_MARKER,
          `⚠️ \`${SOURCE}\` could not be merged into \`${TARGET}\` automatically.`,
          "",
          detail,
          "",
          `Resolve this by merging \`${SOURCE}\` into \`${TARGET}\` locally ` +
            `(\`git switch ${TARGET} && git pull && git merge origin/${SOURCE}\`), ` +
            "pushing the resolution and merging this pull request with a **merge " +
            "commit**. Do not squash it and do not close it, since that would keep " +
            `\`${TARGET}\` behind \`${SOURCE}\`.`,
        ].join("\n"),
      }),
    );
  };

  const escalate = async (pullRequest, comparison, detail) => {
    await requestReviewers(pullRequest, comparison);
    const conflictLabel = (env.CONFLICT_LABEL || "").trim();
    if (conflictLabel) {
      await attempt(`Adding the label ${conflictLabel}`, () =>
        github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pullRequest.number,
          labels: [conflictLabel],
        }),
      );
    }
    await commentOnce(pullRequest, detail);
  };

  const merge = async (pullRequest) => {
    try {
      const { data: merged } = await github.rest.pulls.merge({
        owner,
        repo,
        pull_number: pullRequest.number,
        merge_method: "merge",
        commit_title: `Merge ${SOURCE} back into ${TARGET} (#${pullRequest.number})`,
      });
      return merged.sha;
    } catch (error) {
      core.info(
        `Merging pull request #${pullRequest.number} failed: ${error.message}`,
      );
      return null;
    }
  };

  const enableAutoMerge = async (pullRequest) => {
    try {
      await github.graphql(
        `mutation ($pullRequestId: ID!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: MERGE }) {
            clientMutationId
          }
        }`,
        { pullRequestId: pullRequest.node_id },
      );
      return true;
    } catch (error) {
      core.info(`Enabling auto-merge failed: ${error.message}`);
      return false;
    }
  };

  const { data: comparison } = await github.rest.repos.compareCommits({
    owner,
    repo,
    base: TARGET,
    head: SOURCE,
  });
  if (comparison.ahead_by === 0) {
    return report(
      "up-to-date",
      `${SOURCE} has no commits that are missing in ${TARGET} (status=${comparison.status}).`,
    );
  }

  let pullRequest = await findOpenPullRequest();
  if (pullRequest) {
    core.info(`Reusing open pull request #${pullRequest.number}.`);
  } else {
    pullRequest = await createPullRequest(comparison);
  }

  pullRequest = await waitForMergeability(pullRequest);

  if (pullRequest.mergeable == null) {
    await escalate(
      pullRequest,
      comparison,
      "GitHub did not report a mergeable state in time.",
    );
    return report(
      "unknown",
      "The mergeability was still unknown after " +
        `${MERGEABLE_POLL_ATTEMPTS * MERGEABLE_POLL_SECONDS} seconds.`,
      pullRequest,
    );
  }

  if (pullRequest.mergeable === false) {
    await escalate(
      pullRequest,
      comparison,
      `GitHub reports \`${pullRequest.mergeable_state}\`, which means both branches ` +
        "contain conflicting changes.",
    );
    return report(
      "conflict",
      `The pull request is not mergeable (state=${pullRequest.mergeable_state}).`,
      pullRequest,
    );
  }

  const sha = await merge(pullRequest);
  if (sha) {
    return report("merged", `Merged as ${sha.slice(0, 7)}.`, pullRequest);
  }

  if (await enableAutoMerge(pullRequest)) {
    return report(
      "auto-merge-enabled",
      `Merging was refused (state=${pullRequest.mergeable_state}), so auto-merge has ` +
        "been enabled instead.",
      pullRequest,
    );
  }

  await escalate(
    pullRequest,
    comparison,
    `GitHub refused the merge (state \`${pullRequest.mergeable_state}\`) and auto-merge ` +
      "could not be enabled, so this pull request needs a manual merge.",
  );
  return report(
    "blocked",
    `Merging and enabling auto-merge both failed (state=${pullRequest.mergeable_state}).`,
    pullRequest,
  );
};