# Contributing a PR 🥇

Hello 👋 !

Here is a typical workflow for contributing...

1. Decide what you want to work on w.r.t. a Jira ticket and clone the repository
2. Create a branch
    - We recommend starting your branch name with Jira ticket number you are working on (i.e. REP-XXX)
    - We also recommend giving your branch a helpful name
    - A good branch name is `REP-1234-fix-lint-errors`; a bad one is `fix-stuff`
3. Make your code changes
    - This is the really fun part 😃
    - Per commit, write a summary of what you have done and don't make the changes too big
4. Make sure your code is tested
5. Run SonarLint locally (see information below)
6. Push your changes and create a pull request to branch '**dev**'
7. Make sure the tests and quality gate passes and you add reviewers

### Sonar - the quality gate checker
SonarQube offers reports on duplicated code, coding standards, unit tests, code coverage, code complexity, comments, bugs, and security recommendations. The analysis is done in the cloud and comments on your pull request with it's finding and a link to the cloud's environment.

#### Access cloud and enable project analysis
1. Go to [Sonarcloud](https://sonarcloud.io/projects) and login with your github account
   - For more information you can refer to the [Getting Started](https://docs.sonarsource.com/sonarcloud/getting-started/github/) and [First analysis](https://docs.sonarsource.com/sonarcloud/getting-started/first-analysis/)
2. Analyse a new project by clicking the '+' icon next to your profile picture. A list of available repositories is available
   - Note that you need to be an owner of the repository to enable this
3. Contribute by:
   - Inspecting, resolving and assigning quality errors
   - Update the [Quality profile](https://docs.sonarsource.com/sonarcloud/standards/overview/)
4. Code coverage analysis can _also_ be done be updating Github's workflow as done here using [Sonar's guide](https://docs.sonarsource.com/sonarcloud/enriching/test-coverage/overview/). 
   - Currently, the code coverage analysis is already done via the [Python Coverage Comment](https://github.com/marketplace/actions/python-coverage-comment)

#### Sonarlint
The Sonarlint plugin for your IDE is your local checker for your code quality. It's recommended to use this to catch issues early.
- Connected mode setup [tutorial](https://docs.sonarsource.com/sonarlint/vs-code/team-features/connected-mode-setup/)
- Or use the json file (if any) in the ```.sonarlint/``` folder