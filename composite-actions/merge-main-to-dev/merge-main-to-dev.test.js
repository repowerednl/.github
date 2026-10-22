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

const httpError = (status, message) =>
  stub(async () => {
    const error = new Error(message);
    error.status = status;
    throw error;
  });

const buildCore = () => {
  const outputs = {};
  const warnings = [];
  const failures = [];
  const summary = {
    addHeading: () => summary,
    addTable: () => summary,
    addRaw: () => summary,
    write: async () => summary,
  };
  return {
    outputs,
    warnings,
    failures,
    info: () => {},
    warning: (message) => warnings.push(message),
    setFailed: (message) => failures.push(message),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    summary,
  };
};

const buildGithub = ({
  comparison = { ahead_by: 2, status: "ahead", commits: [] },
  openPullRequests = [],
  comments = [],
  merge = stub(async () => ({ data: { sha: "abcdef1234567890" } })),
} = {}) => ({
  rest: {
    repos: {
      compareCommits: stub(async () => ({ data: comparison })),
      merge,
    },
    pulls: {
      list: stub(async () => ({ data: openPullRequests })),
      create: stub(async () => ({
        data: { number: 42, html_url: "https://github.test/pull/42" },
      })),
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

const conflictingCommits = {
  ahead_by: 3,
  status: "ahead",
  commits: [
    { author: { login: "fanna", type: "User" } },
    { author: { login: "fanna", type: "User" } },
    { author: { login: "colleague", type: "User" } },
    { author: { login: "repowered-bot[bot]", type: "Bot" } },
    { author: null },
  ],
};

const run = async (github, env = {}) => {
  const core = buildCore();
  const status = await mergeMainToDev({ github, context, core, env });
  return { status, core };
};

test("does nothing when dev already contains main", async () => {
  const github = buildGithub({
    comparison: { ahead_by: 0, status: "identical", commits: [] },
  });

  const { status, core } = await run(github);

  assert.equal(status, "up-to-date");
  assert.equal(github.rest.pulls.create.calls.length, 0);
  assert.equal(github.rest.repos.merge.calls.length, 0);
  assert.equal(core.outputs.pull_request_number, "");
  assert.deepEqual(core.failures, []);
});

test("creates the pull request and merges main into dev with a merge commit", async () => {
  const github = buildGithub();

  const { status, core } = await run(github, { LABELS: "ignore-for-release" });

  assert.equal(status, "merged");
  assert.equal(github.rest.pulls.create.calls.length, 1);
  assert.equal(github.rest.pulls.create.calls[0].base, "dev");
  assert.equal(github.rest.pulls.create.calls[0].head, "main");
  assert.match(
    github.rest.pulls.create.calls[0].body,
    /Do not press \*\*Update branch\*\*/,
  );
  assert.deepEqual(github.rest.issues.addLabels.calls[0].labels, [
    "ignore-for-release",
  ]);
  assert.equal(github.rest.repos.merge.calls[0].base, "dev");
  assert.equal(github.rest.repos.merge.calls[0].head, "main");
  assert.match(
    github.rest.repos.merge.calls[0].commit_message,
    /Merge main back into dev \(#42\)/,
  );
  assert.equal(github.rest.issues.createComment.calls.length, 0);
  assert.equal(core.outputs.pull_request_number, "42");
  assert.equal(core.outputs.pull_request_url, "https://github.test/pull/42");
  assert.deepEqual(core.failures, []);
});

test("reports a merge that turned out to be a no-op", async () => {
  const github = buildGithub({ merge: stub(async () => ({ data: undefined })) });

  const { status, core } = await run(github);

  assert.equal(status, "merged");
  assert.deepEqual(core.failures, []);
});

test("reuses an already open pull request", async () => {
  const github = buildGithub({
    openPullRequests: [{ number: 7, html_url: "https://github.test/pull/7" }],
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(github.rest.pulls.create.calls.length, 0);
  assert.match(
    github.rest.repos.merge.calls[0].commit_message,
    /Merge main back into dev \(#7\)/,
  );
});

test("leaves the pull request open and assigns the commit authors on a conflict", async () => {
  const github = buildGithub({
    comparison: conflictingCommits,
    merge: httpError(409, "Merge conflict"),
  });

  const { status, core } = await run(github, {
    CONFLICT_LABEL: "merge-conflict",
  });

  assert.equal(status, "conflict");
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /merge conflict/);
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
  assert.match(
    github.rest.issues.createComment.calls[0].body,
    /results in merge conflicts/,
  );
});

test("reports blocked when GitHub refuses the merge for another reason", async () => {
  const github = buildGithub({
    comparison: conflictingCommits,
    merge: httpError(403, "Resource not accessible by integration"),
  });

  const { status, core } = await run(github);

  assert.equal(status, "blocked");
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /Resource not accessible by integration/);
  assert.match(
    github.rest.issues.createComment.calls[0].body,
    /GitHub refused the merge/,
  );
});

test("prefers the configured reviewers over the commit authors", async () => {
  const github = buildGithub({
    comparison: conflictingCommits,
    merge: httpError(409, "Merge conflict"),
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
    merge: httpError(409, "Merge conflict"),
  });
  github.rest.pulls.requestReviewers = failing(
    "Reviews may only be requested from collaborators",
  );

  const { status, core } = await run(github);

  assert.equal(status, "conflict");
  assert.deepEqual(
    github.rest.pulls.requestReviewers.calls.map((call) => call.reviewers),
    [["fanna", "left-the-company"], ["fanna"], ["left-the-company"]],
  );
  assert.ok(
    core.warnings.some((warning) => warning.includes("left-the-company")),
  );
});

test("does not comment twice about the same conflict", async () => {
  const github = buildGithub({
    comparison: conflictingCommits,
    merge: httpError(409, "Merge conflict"),
    comments: [{ body: "<!-- repowered-merge-back-conflict -->\nearlier run" }],
  });

  await run(github);

  assert.equal(github.rest.issues.createComment.calls.length, 0);
});

test("fails with a message when main or dev is missing", async () => {
  const github = buildGithub();
  github.rest.repos.compareCommits = httpError(404, "Not Found");

  await assert.rejects(run(github), {
    message:
      "Comparing dev with main in repowerednl/repower-django failed: Not Found. " +
      "This job merges main into dev so what branches does it need?" +
      " Right, main and dev....and it doesn't have both" +
      " Remove this job from your workflow.",
  });
  assert.equal(github.rest.pulls.create.calls.length, 0);
  assert.equal(github.rest.repos.merge.calls.length, 0);
});

test("adopts the pull request of a parallel run when creating one fails", async () => {
  const github = buildGithub();
  const listed = [[], [{ number: 9, html_url: "https://github.test/pull/9" }]];
  github.rest.pulls.list = stub(async () => ({ data: listed.shift() || [] }));
  github.rest.pulls.create = httpError(
    422,
    "A pull request already exists for repowerednl:main.",
  );

  const { status, core } = await run(github);

  assert.equal(status, "merged");
  assert.equal(github.rest.pulls.list.calls.length, 2);
  assert.match(
    github.rest.repos.merge.calls[0].commit_message,
    /Merge main back into dev \(#9\)/,
  );
  assert.deepEqual(core.failures, []);
});

test("fails when creating the pull request fails and there is none to adopt", async () => {
  const github = buildGithub();
  github.rest.pulls.create = httpError(
    403,
    "Resource not accessible by integration",
  );

  await assert.rejects(run(github), {
    message: "Resource not accessible by integration",
  });
  assert.equal(github.rest.repos.merge.calls.length, 0);
});

test("warns when no reviewer can be determined", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [{ author: { login: "repowered-bot[bot]", type: "Bot" } }],
    },
    merge: httpError(409, "Merge conflict"),
  });

  const { status, core } = await run(github);

  assert.equal(status, "conflict");
  assert.equal(github.rest.pulls.requestReviewers.calls.length, 0);
  assert.ok(core.warnings.some((warning) => warning.includes("No reviewers")));
});
const versionBumpFile = (from, to) => ({
  filename: "package.json",
  patch: [
    '@@ -1,6 +1,6 @@',
    ' {',
    '   "name": "repower-frontend",',
    `-  "version": "${from}",`,
    `+  "version": "${to}",`,
    '   "private": true,',
  ].join("\n"),
});

test("marks the merge [skip ci] when main only carries a version bump", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [versionBumpFile("11.7.0", "11.7.1")],
    },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42) [skip ci]",
  );
});

test("marks the merge [skip ci] when main changed no files at all", async () => {
  const github = buildGithub({
    comparison: { ahead_by: 1, status: "ahead", commits: [], files: [] },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42) [skip ci]",
  );
});

test("keeps CI running when main carries a hotfix next to the version bump", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 2,
      status: "ahead",
      commits: [],
      files: [
        versionBumpFile("11.7.0", "11.7.1"),
        {
          filename: "src/components/Chart.vue",
          patch: '@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;',
        },
      ],
    },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});

test("keeps CI running when package.json changed beyond its version", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "package.json",
          patch: [
            '@@ -1,6 +1,6 @@',
            '-  "version": "11.7.0",',
            '+  "version": "11.7.1",',
            '-    "vue": "3.4.0"',
            '+    "vue": "3.5.0"',
          ].join("\n"),
        },
      ],
    },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});

test("keeps CI running when the comparison carries no file list", async () => {
  const github = buildGithub({
    comparison: { ahead_by: 1, status: "ahead", commits: [] },
  });

  const { status } = await run(github);

  assert.equal(status, "merged");
  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});

test("marks the merge [skip ci] for a pyproject.toml version bump", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "pyproject.toml",
          patch: '@@ -1,3 +1,3 @@\n-version = "2024.11.1"\n+version = "2024.11.2"',
        },
      ],
    },
  });

  const { status } = await run(github);

  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42) [skip ci]",
  );
  assert.equal(status, "merged");
});

test("marks the merge [skip ci] for a nested Chart.yaml version bump", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "deployment/Chart.yaml",
          patch: "@@ -1,3 +1,3 @@\n-version: 1.0.0\n+version: 1.0.1",
        },
      ],
    },
  });

  await run(github);

  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42) [skip ci]",
  );
});

test("keeps CI running for a pyproject.toml dependency bump", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "pyproject.toml",
          patch: '@@ -5,3 +5,3 @@\n-django = "^5.2"\n+django = "^5.3"',
        },
      ],
    },
  });

  await run(github);

  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});

test("keeps CI running for an indented chart dependency version", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "deployment/Chart.yaml",
          patch: "@@ -4,3 +4,3 @@\n-    version: 1.4.0\n+    version: 1.5.0",
        },
      ],
    },
  });

  await run(github);

  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});

test("keeps CI running for a file that is not a configured version file", async () => {
  const github = buildGithub({
    comparison: {
      ahead_by: 1,
      status: "ahead",
      commits: [],
      files: [
        {
          filename: "pyproject.toml",
          patch: '@@ -1,3 +1,3 @@\n-version = "1.0.0"\n+version = "1.0.1"',
        },
      ],
    },
  });

  await run(github, { VERSION_FILES: "package.json" });

  assert.equal(
    github.rest.repos.merge.calls[0].commit_message,
    "Merge main back into dev (#42)",
  );
});
