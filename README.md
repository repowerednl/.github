# .github

This is a special repository for the default community health files. The files within this repository are shared within the organization. For reference please visit [Github docs](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file#supported-file-types) about this. 

## Workflows
We use reusable workflows: [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
If you want to create/update one, there are a few rules to adhere:
- Make sure they are backwards compatible (if that is not possible; make sure you update all the repositories where this workflow is used)
- Add proof of a successfull workflow run to the PR description (backwards compatability including if applicable)
- Do not use bash scripting unless it is _really_ needed. Use actions/tools/github-script instead
- Create/update the accompanying workflow template (_see below_)

### Workflow Templates
To have consistent workflows that can easily be maintained, templates have been created under the folder 'workflow_templates'. 
- Templates have one goal and can be modified to specific needs. Current goals are; `deploy to ..`, `test stack ..`, `release package pypi/npm`
- For creating such a template here: [Create template](https://docs.github.com/en/actions/sharing-automations/creating-workflow-templates-for-your-organization)
- For using such a template in a repository: [Use template](https://docs.github.com/en/actions/writing-workflows/using-workflow-templates)
- For testing such a template including explanations: [workflow-tests](https://github.com/repowerednl/workflow-tests)

### GitHub App token
Bot actions (pushing a commit, creating a pull request, merging it) are done with a token of our GitHub App instead of `secrets.GITHUB_TOKEN`. That keeps the action traceable to the app, gives it the rights it needs on protected branches and - unlike `GITHUB_TOKEN` - the events it creates do trigger other workflows. The use of personal access tokens (PATs) is not allowed.
- The token is generated inside the reusable workflow with [actions/create-github-app-token](https://github.com/actions/create-github-app-token)
- The caller only passes `app-id: ${{ vars.APP_ID }}` and `private-key: ${{ secrets.APP_PRIVATE_KEY }}`
- Never write the token to a file, an output or a log; only pass it to the step that needs it

### Composite actions
Script logic that is too long to read inside a `script:` block lives in its own file next to the [composite action](composite-actions) that uses it, like [merge-main-to-dev](composite-actions/merge-main-to-dev). Running an action checks out its repository, so the action passes its own directory to `actions/github-script` and requires the file from there - no checkout needed in the caller:
```yaml
env:
  ACTION_PATH: ${{ github.action_path }}  # Not GITHUB_ACTION_PATH: that points to github-script itself
with:
  script: |
    const merge = require(`${process.env.ACTION_PATH}/merge-main-to-dev.js`);
    await merge({ github, context, core });
```
The file exports one function that receives `{ github, context, core }`, which makes it unit testable. Run those tests with `yarn test` in the action's folder (no CI yet available).

### Test workflow locally
It can be very frustrating to check if a workflow on GitHub is valid/runs. There are two tools that can be installed to check locally:
### actionlint
This is a github action linter and works pretty well. It is [open source](https://github.com/rhysd/actionlint)
The [installation instructions](https://github.com/rhysd/actionlint/blob/v1.7.9/docs/install.md) for every OS

_Linux install:_ Download and unpack in `usr/local/bin`: https://github.com/rhysd/actionlint/releases

### act
This runs your workflows locally using the Docker API (so the Docker Engine needs to be installed). It is [open-source](https://github.com/nektos/act) with well defined [docs](https://nektosact.com/) including installations instructions for every OS.

💡 **Install act using the `medium` sized image.** If there are actions that cannot be installed using this image, the action should _not_ be used. Note that any workflow that uses cloud tooling (like SonarCloud or Github artifacts), will not work locally
