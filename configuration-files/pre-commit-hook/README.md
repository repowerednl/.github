# Pre-commit hook Python code
In order to keep our Python code clean in one company standard way, we use a pre-commit hook. This pre-commit hook runs an automatic linter and formatter before each commit to keep a consistent style across our code base.

## Initial Setup
1. Copy the `.pre-commit-config.yaml` to the root of your project directory
2. Add the following dependencies to your `pyproject.toml`
    ```toml
    [tool.poetry.group.linting.dependencies]
    pre-commit = "^3.1.1"
    black = "^23.1.0"
    freezegun = "^1.2.2"
    ```
3. Enable the pre-commit hook (for yourself) by running `poetry run pre-commit install`
4. [Optional] Add 'step 3' with info to your repository's README.md