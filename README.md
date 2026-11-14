# dejav run

This GitHub Action starts a dejav run from a workflow and waits for it to finish. It writes the results to a JUnit XML file and reports the outcome as a GitHub check. The tests run in dejav, and the outcome matches what the run page in dejav shows. Passwords and other secrets for the site under test stay in dejav's secret variables and are never sent to CI.

## Setup

1. In dejav, open Settings and create a key for CI under API Keys.
   - Under Permissions, select only "Start and stop runs" and "View results and test cases".
   - Under Projects, choose "Only selected projects" and select the projects you test in CI.
2. In your repository, go to Settings > Secrets and variables > Actions and save the key as `DEJAV_API_KEY`.
3. Note the project ID. dejav shows it in the example workflow right after you create the key.

## Test a pull request preview

Use this when each pull request gets its own preview deployment ([examples/pr-preview.yml](examples/pr-preview.yml)).

```yaml
name: dejav PR tests

on:
  pull_request:

permissions:
  contents: read
  checks: write

jobs:
  dejav:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: sahksas/dejav-action@v1
        with:
          api-key: ${{ secrets.DEJAV_API_KEY }}
          project-id: your-project-id
          target-url: https://pr-${{ github.event.pull_request.number }}.preview.example.com
```

`target-url` replaces the test profile's target URL for this run only. dejav sends the test profile's credentials to it only when it is on the same domain as the target URL, or on a subdomain of that domain after you have verified the domain.

To test production or staging after a deployment finishes, see [examples/deployment.yml](examples/deployment.yml).

## Pull requests from forks

- GitHub does not pass secrets to workflows run for pull requests from forks. The `if: github.event.pull_request.head.repo.full_name == github.repository` condition in the example skips the step for those pull requests. Because `DEJAV_API_KEY` is not passed, the author of a fork cannot read the key or start runs that use your credits.
- Do not use `pull_request_target` to get the key into the workflow. If the action runs on `pull_request_target` for a pull request from a fork, it exits without starting a run, and `outcome` is `rejected`.

## Inputs

| Name                    | Default                | Description                                                                                                                                  |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-key`               | (required)             | dejav API key. Pass it from a secret.                                                                                                        |
| `project-id`            | (required)             | ID of the dejav project to run.                                                                                                              |
| `base-url`              | `https://dejav.io` | dejav URL.                                                                                                                                   |
| `test-profile-id`       | empty                  | Test profile to run with. When empty, the project's default test profile is used.                                                            |
| `target-url`            | empty                  | Target URL for this run only, such as a pull request preview.                                                                                |
| `idempotency-key`       | empty                  | If a run was already started with the same key, the action uses that run instead of starting a new one. When empty, see the paragraph below. |
| `timeout-seconds`       | `1800`                 | Seconds to wait for the run to finish.                                                                                                       |
| `poll-interval-seconds` | `15`                   | Seconds between status checks.                                                                                                               |
| `junit-path`            | `dejav-results.xml`    | File to write the JUnit XML results to. When empty, no file is written.                                                                      |
| `check-name`            | `dejav`                | Name of the GitHub check.                                                                                                                    |
| `github-token`          | `${{ github.token }}`  | Token used to create the GitHub check. The job needs `permissions: checks: write`. When empty, no check is created.                          |

When `idempotency-key` is empty, the action makes one key per repository, commit, test profile, and target URL. If you re-run the workflow on the same commit, the action returns the result of the run it already started and does not start another one. To start a new run on the same commit, pass a value that changes on each attempt, such as `idempotency-key: ${{ github.sha }}-${{ github.run_attempt }}`.

## Outcomes

| `outcome`    | Exit code | Check conclusion  | Meaning                                                                                                  |
| ------------ | --------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `passed`     | 0         | `success`         | All test cases passed.                                                                                   |
| `failed`     | 1         | `failure`         | At least one test case failed.                                                                           |
| `incomplete` | 2         | `action_required` | No test case failed, but some could not be judged (blocked, checks skipped, or no verdict).              |
| `timed_out`  | 3         | `timed_out`       | The run did not finish within `timeout-seconds`. It keeps running in dejav.                              |
| `stopped`    | 4         | `cancelled`       | The run was stopped before it finished.                                                                  |
| `error`      | 5         | `failure`         | The run ended in an internal error in dejav. The check title is "The run ended in an internal error".    |
| `rejected`   | 6         | `failure`         | dejav did not accept the request: a wrong key, a project or permission outside the key, too few credits. |

Exit code 7 means the action itself failed unexpectedly.

Failures of quarantined test cases are not counted as failures. The check summary has a table of incomplete test cases: how many dejav blocked by submit avoidance or excluded paths, how many had their checks skipped, and how many could not be judged. The details link of the check opens the run page in dejav.

Later steps can read the `outcome`, `run-id`, and `run-url` outputs. To keep the job going when tests fail, add `continue-on-error: true` to the step and branch on `steps.<id>.outputs.outcome`.

## Versions

`@v1` gets updates that do not change how existing workflows behave. To review each update before you take it, pin the action to a commit SHA, such as `sahksas/dejav-action@<commit SHA>`.
