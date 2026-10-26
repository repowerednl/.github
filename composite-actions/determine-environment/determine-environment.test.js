const assert = require("node:assert/strict");
const { test } = require("node:test");

const determineEnvironment = require("./determine-environment.js");

const buildGithub = (openPullRequestHeads = []) => {
  const calls = [];
  return {
    calls,
    rest: {
      pulls: {
        list: async (params) => {
          calls.push(params);
          const branch = params.head.split(":")[1];
          const open = params.state === "open" && params.base === "main" && openPullRequestHeads.includes(branch);
          return { data: open ? [{ number: 1 }] : [] };
        },
      },
    },
  };
};

const buildCore = () => {
  const outputs = {};
  const headings = [];
  const summary = {
    addHeading: (heading) => {
      headings.push(heading);
      return summary;
    },
    addRaw: () => summary,
    write: async () => summary,
  };
  return { outputs, headings, summary, setOutput: (name, value) => (outputs[name] = value) };
};

const run = async ({ eventName, payload = {}, refName, openPullRequestHeads }) => {
  const github = buildGithub(openPullRequestHeads);
  const core = buildCore();
  const context = { eventName, payload, repo: { owner: "repowerednl", repo: "repower-django" } };
  const environment = await determineEnvironment({ github, context, core, env: { GITHUB_REF_NAME: refName } });
  assert.equal(core.outputs.environment, environment);
  assert.equal(core.headings.length, 1);
  return { environment, github };
};

const pullRequest = (head, base) => ({ pull_request: { head: { ref: head }, base: { ref: base } } });
const workflowRun = (branch) => ({ workflow_run: { head_branch: branch } });

test("a push to main deploys to prod without an API call", async () => {
  const { environment, github } = await run({ eventName: "push", refName: "main" });
  assert.equal(environment, "prod");
  assert.equal(github.calls.length, 0);
});

test("a workflow_run on main deploys to prod", async () => {
  const { environment } = await run({ eventName: "workflow_run", payload: workflowRun("main"), refName: "dev" });
  assert.equal(environment, "prod");
});

test("a workflow_run on dev with an open release pull request deploys to qa", async () => {
  const { environment, github } = await run({
    eventName: "workflow_run",
    payload: workflowRun("dev"),
    refName: "main",
    openPullRequestHeads: ["dev"],
  });
  assert.equal(environment, "qa");
  assert.deepEqual(github.calls, [
    { owner: "repowerednl", repo: "repower-django", state: "open", base: "main", head: "repowerednl:dev" },
  ]);
});

test("a workflow_run on dev without a release pull request deploys to dev", async () => {
  const { environment } = await run({ eventName: "workflow_run", payload: workflowRun("dev"), refName: "main" });
  assert.equal(environment, "dev");
});

test("a workflow_run on a hotfix with an open pull request to main deploys to qa", async () => {
  const { environment } = await run({
    eventName: "workflow_run",
    payload: workflowRun("hotfix/broken-login"),
    openPullRequestHeads: ["hotfix/broken-login"],
  });
  assert.equal(environment, "qa");
});

test("a workflow_run on a hotfix ignores the open release pull request of dev", async () => {
  const { environment } = await run({
    eventName: "workflow_run",
    payload: workflowRun("hotfix/broken-login"),
    openPullRequestHeads: ["dev"],
  });
  assert.equal(environment, "dev");
});

test("a workflow_run uses its head branch over GITHUB_REF_NAME", async () => {
  const { github } = await run({ eventName: "workflow_run", payload: workflowRun("feature/x"), refName: "main" });
  assert.equal(github.calls[0].head, "repowerednl:feature/x");
});

test("a pull request from dev to main deploys to qa without an API call", async () => {
  const { environment, github } = await run({ eventName: "pull_request", payload: pullRequest("dev", "main") });
  assert.equal(environment, "qa");
  assert.equal(github.calls.length, 0);
});

test("a pull request from a hotfix to main deploys to qa", async () => {
  const { environment } = await run({
    eventName: "pull_request",
    payload: pullRequest("hotfix/broken-login", "main"),
  });
  assert.equal(environment, "qa");
});

test("a pull request to dev deploys to dev, even with an open release pull request", async () => {
  const { environment, github } = await run({
    eventName: "pull_request",
    payload: pullRequest("feature/x", "dev"),
    openPullRequestHeads: ["dev"],
  });
  assert.equal(environment, "dev");
  assert.equal(github.calls.length, 0);
});

test("a pull_request_target is treated like a pull request", async () => {
  const { environment } = await run({ eventName: "pull_request_target", payload: pullRequest("dev", "main") });
  assert.equal(environment, "qa");
});

test("a push to a branch with an open pull request to main deploys to qa", async () => {
  const { environment } = await run({ eventName: "push", refName: "dev", openPullRequestHeads: ["dev"] });
  assert.equal(environment, "qa");
});

test("a workflow_dispatch deploys to dev without an API call, even on main", async () => {
  const { environment, github } = await run({ eventName: "workflow_dispatch", refName: "main" });
  assert.equal(environment, "dev");
  assert.equal(github.calls.length, 0);
});

test("a workflow_run without any branch deploys to dev without an API call", async () => {
  const { environment, github } = await run({ eventName: "workflow_run", payload: workflowRun(null) });
  assert.equal(environment, "dev");
  assert.equal(github.calls.length, 0);
});

test("a failing API call fails the action instead of guessing an environment", async () => {
  const github = { rest: { pulls: { list: async () => Promise.reject(new Error("Bad credentials")) } } };
  const core = buildCore();
  const context = { eventName: "workflow_run", payload: workflowRun("dev"), repo: { owner: "o", repo: "r" } };
  await assert.rejects(determineEnvironment({ github, context, core, env: {} }), /Bad credentials/);
  assert.equal(core.outputs.environment, undefined);
});
