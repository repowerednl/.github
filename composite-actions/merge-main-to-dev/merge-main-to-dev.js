const CONFLICT_MARKER = "<!-- repowered-merge-back-conflict -->";
const MAX_REVIEWERS = 15;
const MAX_ASSIGNEES = 10;

const RESULTS = {
  "up-to-date": "✅ dev already contains main",
  merged: "✅ main has been merged into dev",
  conflict: "⚠️ merge conflict, the pull request stays open",
  blocked: "⚠️ GitHub refused the merge, the pull request stays open",
};

const FAILING = ["conflict", "blocked"];

const toList = (value) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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

module.exports = async ({ github, context, core, env = process.env }) => {
  const { owner, repo } = context.repo;

  const report = async (status, detail, pullRequest) => {
    core.setOutput("status", status);
    core.setOutput(
      "pull_request_number",
      pullRequest ? String(pullRequest.number) : "",
    );
    core.setOutput("pull_request_url", pullRequest ? pullRequest.html_url : "");
    core.info(`status=${status} :: ${detail}`);
    await core.summary
      .addHeading("Merge main back into dev", 3)
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
    if (FAILING.includes(status)) {
      core.setFailed(`${RESULTS[status]} :: ${detail}`);
    }
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
      base: "dev",
      head: `${owner}:main`,
      state: "open",
    });
    return open[0];
  };

  const createPullRequest = async (comparison) => {
    const { data: pullRequest } = await github.rest.pulls.create({
      owner,
      repo,
      base: "dev",
      head: "main",
      title: "Merge main back into dev",
      body: [
        "Automated merge of `main` back into `dev`, containing " +
          `${comparison.ahead_by} commit(s) that only exist on \`main\`.`,
        "",
        "This pull request is merged automatically." +
        "It only stays open when that is not possible, in which case the " +
          "requested reviewer(s) has/have to resolve it.",
        "",
        "⚠️ Do not press **Update branch**: on this pull request that merges `dev` " +
          "into `main` instead, which puts unreleased `dev` code on `main`.",
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
          "⚠️ `main` could not be merged into `dev` automatically.",
          "",
          detail,
          "",
          "Create a hotfix to resolve this.",
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

  const { data: comparison } = await github.rest.repos.compareCommits({
    owner,
    repo,
    base: "dev",
    head: "main",
  });
  if (comparison.ahead_by === 0) {
    return report(
      "up-to-date",
      `main has no commits that are missing in dev (status=${comparison.status}).`,
    );
  }

  let pullRequest = await findOpenPullRequest();
  if (pullRequest) {
    core.info(`Reusing open pull request #${pullRequest.number}.`);
  } else {
    pullRequest = await createPullRequest(comparison);
  }

  try {
    const { data: merged } = await github.rest.repos.merge({
      owner,
      repo,
      base: "dev",
      head: "main",
      commit_message: `Merge main back into dev (#${pullRequest.number})`,
    });
    const sha = merged && merged.sha;
    return report(
      "merged",
      sha ? `Merged as ${sha.slice(0, 7)}.` : "dev already contained main.",
      pullRequest,
    );
  } catch (error) {
    const conflict = error.status === 409;
    await escalate(
      pullRequest,
      comparison,
      conflict
        ? "Merging main into dev results in merge conflicts."
        : `GitHub refused the merge: ${error.message}`,
    );
    return report(
      conflict ? "conflict" : "blocked",
      `Merging main into dev failed (status=${error.status}): ${error.message}`,
      pullRequest,
    );
  }
};