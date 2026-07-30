const assert = require("node:assert/strict");
const { test } = require("node:test");

const mergeMainToDev = require("./merge-main-to-dev.js");

const context = { repo: { owner: "repowerednl", repo: "repower-django" } };

const stub = (implementation = async () => ({ data: {} })) => {
  const calls = [];
  const fake = async (...args) => {
    calls.push(args[0]);
    return implementation(...args);
  };
  fake.calls = calls;
  return fake;
};

const failing = (message) =>
  stub(async () => {
    throw new Error(message);
  });

const buildCore = () => {
  const outputs = {};
  const warnings = [];
  const summary = {
    addHeading: () => summary,
    addTable: () => summary,
    addRaw: () => summary,
    write: async () => summary,
  };
  return {
    outputs,
    warnings,
    info: () => {},
    warning: (message) => warnings.push(message),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    summary,
  };
};

const buildGithub = ({
  comparison = { ahead_by: 2, status: "ahead", commits: [] },
  openPullRequests = [],
  pullRequest = {},
  comments = [],
  merge = stub(async () => ({ data: { sha: "abcdef1234567890" } })),
  graphql = stub(),
} = {}) => ({
  graphql,
  rest: {
    repos: { compareCommits: stub(async () => ({ data: comparison })) },
    pulls: {
      list: stub(async () => ({ data: openPullRequests })),
      create: stub(async () => ({
        data: { number: 42, html_url: "https://github.test/pull/42", node_id: "PR_42" },
      })),
      get: stub(async () => ({ data: pullRequest })),
      merge,
      requestReviewers: stub(),
    },
    issues: {
      addLabels: stub(),
      addAssignees: stub(),
      listComments: stub(async () => ({ data: comments })),
      createComment: stub(),
    },
  },
});

const run = async (github, env = {}) => {
  const core = buildCore();
  const status = await mergeMainToDev({
    github,
    context,
    core,
    env,
    sleep: async () => {},
  });
  return { status, core };
};

test("does nothing when dev already contains main", async () => {
  const github = buildGithub({
    comparison: { ahead_by: 0, status: "identical", commits: [] },
  });

  const { status, core } = await run(github);

  assert.equal(status, "up-to-date");
  assert.equal(github.rest.pulls.create.calls.length, 0);
  assert.equal(core.outputs.pull_request_number, "");
});

test("creates the pull request and merges it with a merge commit", async () => {
  const github = buildGithub({
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      node_id: "PR_42",
      mergeable: true,
      mergeable_state: "clean",
    },
  });

  const { status, core } = await run(github, { LABELS: "ignore-for-release" });

  assert.equal(status, "merged");
  assert.equal(github.rest.pulls.create.calls.length, 1);
  assert.deepEqual(github.rest.pulls.create.calls[0].base, "dev");
  assert.deepEqual(github.rest.pulls.create.calls[0].head, "main");
  assert.equal(github.rest.pulls.merge.calls[0].merge_method, "merge");
  assert.deepEqual(github.rest.issues.addLabels.calls[0].labels, [
    "ignore-for-release",
  ]);
  assert.equal(github.rest.issues.createComment.calls.length, 0);
  assert.equal(core.outputs.pull_request_number, "42");
  assert.equal(core.outputs.pull_request_url, "https://github.test/pull/42");
});

test("reuses an already open pull request", async () => {
  const github = buildGithub({
    openPullRequests: [{ number: 7, html_url: "https://github.test/pull/7" }],
    pullRequest: {
      number: 7,
      html_url: "https://github.test/pull/7",
      mergeable: true,
      mergeable_state: "clean",
    },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(github.rest.pulls.create.calls.length, 0);
  assert.equal(github.rest.pulls.merge.calls[0].pull_number, 7);
});

test("leaves the pull request open and assigns the commit authors on a conflict", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 3,
      status: "ahead",
      commits: [
        { author: { login: "fanna", type: "User" } },
        { author: { login: "fanna", type: "User" } },
        { author: { login: "colleague", type: "User" } },
        { author: { login: "repowered-bot[bot]", type: "Bot" } },
        { author: null },
      ],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: false,
      mergeable_state: "dirty",
    },
  });

  const { status } = await run(github, { CONFLICT_LABEL: "merge-conflict" });

  assert.equal(status, "conflict");
  assert.equal(github.rest.pulls.merge.calls.length, 0);
  assert.deepEqual(github.rest.pulls.requestReviewers.calls[0].reviewers, [
    "fanna",
    "colleague",
  ]);
  assert.deepEqual(github.rest.issues.addAssignees.calls[0].assignees, [
    "fanna",
    "colleague",
  ]);
  assert.deepEqual(github.rest.issues.addLabels.calls.at(-1).labels, [
    "merge-conflict",
  ]);
  assert.equal(github.rest.issues.createComment.calls.length, 1);
});

test("prefers the configured reviewers over the commit authors", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "fanna", type: "User" } }],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: false,
      mergeable_state: "dirty",
    },
  });

  await run(github, { REVIEWERS: "reviewer-one, reviewer-two" });

  assert.deepEqual(github.rest.pulls.requestReviewers.calls[0].reviewers, [
    "reviewer-one",
    "reviewer-two",
  ]);
});

test("requests the reviewers one by one when the combined request fails", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [
        { author: { login: "fanna", type: "User" } },
        { author: { login: "left-the-company", type: "User" } },
      ],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: false,
      mergeable_state: "dirty",
    },
  });
  github.rest.pulls.requestReviewers = failing("Reviews may only be requested from collaborators");

  const { status, core } = await run(github);

  assert.equal(status, "conflict");
  assert.deepEqual(
    github.rest.pulls.requestReviewers.calls.map((call) => call.reviewers),
    [["fanna", "left-the-company"], ["fanna"], ["left-the-company"]],
  );
  assert.ok(core.warnings.some((warning) => warning.includes("left-the-company")));
});

test("does not comment twice about the same conflict", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "fanna", type: "User" } }],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: false,
      mergeable_state: "dirty",
    },
    comments: [{ body: "<!-- repowered-merge-back-conflict -->\nearlier run" }],
  });

  await run(github);

  assert.equal(github.rest.issues.createComment.calls.length, 0);
});

test("falls back to auto-merge when GitHub refuses the merge", async () => {
  const github = buildGithub({
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      node_id: "PR_42",
      mergeable: true,
      mergeable_state: "blocked",
    },
    merge: failing("Required status check is expected"),
  });

  const { status } = await run(github);

  assert.equal(status, "auto-merge-enabled");
  assert.equal(github.graphql.calls.length, 1);
  assert.equal(github.rest.issues.createComment.calls.length, 0);
});

test("escalates when both merging and auto-merge fail", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "fanna", type: "User" } }],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      node_id: "PR_42",
      mergeable: true,
      mergeable_state: "blocked",
    },
    merge: failing("Base branch was modified"),
    graphql: failing("Auto merge is not allowed for this repository"),
  });

  const { status } = await run(github);

  assert.equal(status, "blocked");
  assert.deepEqual(github.rest.pulls.requestReviewers.calls[0].reviewers, ["fanna"]);
  assert.equal(github.rest.issues.createComment.calls.length, 1);
});

test("escalates when GitHub keeps reporting an unknown mergeable state", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "fanna", type: "User" } }],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: null,
      mergeable_state: "unknown",
    },
  });

  const { status } = await run(github);

  assert.equal(status, "unknown");
  assert.equal(github.rest.pulls.get.calls.length, 12);
  assert.equal(github.rest.pulls.merge.calls.length, 0);
  assert.equal(github.rest.issues.createComment.calls.length, 1);
});

test("warns instead of failing when no reviewer can be determined", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "repowered-bot[bot]", type: "Bot" } }],
    },
    pullRequest: {
      number: 42,
      html_url: "https://github.test/pull/42",
      mergeable: false,
      mergeable_state: "dirty",
    },
  });

  const { status, core } = await run(github);

  assert.equal(status, "conflict");
  assert.equal(github.rest.pulls.requestReviewers.calls.length, 0);
  assert.ok(core.warnings.some((warning) => warning.includes("No reviewers")));
});