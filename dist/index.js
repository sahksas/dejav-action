"use strict";

// src/github-action/outcome.ts
var EXIT_CODE_FOR_OUTCOME = {
  passed: 0,
  failed: 1,
  incomplete: 2,
  timed_out: 3,
  stopped: 4,
  error: 5,
  rejected: 6
};
var UNEXPECTED_ERROR_EXIT_CODE = 7;
var CHECK_CONCLUSION_FOR_OUTCOME = {
  passed: "success",
  failed: "failure",
  incomplete: "action_required",
  timed_out: "timed_out",
  stopped: "cancelled",
  error: "failure",
  rejected: "failure"
};
var CHECK_TITLE_FOR_OUTCOME = {
  passed: "All test cases passed",
  failed: "Test cases failed",
  incomplete: "Some test cases could not be judged",
  timed_out: "Timed out waiting for the run",
  stopped: "The run was stopped",
  error: "The run ended in an internal error",
  rejected: "The run could not be started"
};
function actionResult(outcome) {
  return {
    outcome,
    exitCode: EXIT_CODE_FOR_OUTCOME[outcome],
    conclusion: CHECK_CONCLUSION_FOR_OUTCOME[outcome],
    title: CHECK_TITLE_FOR_OUTCOME[outcome]
  };
}
function outcomeForTerminalStatus(status) {
  if (status.status === "stopped") return "stopped";
  if (status.status !== "completed") return "error";
  if (status.verdictCounts.failed > 0) return "failed";
  if (status.verdictCounts.incomplete > 0) return "incomplete";
  return "passed";
}
function countsSummary(status) {
  const { passed, failed, incomplete } = status.verdictCounts;
  const unjudged = Math.max(
    0,
    incomplete - status.blockedIncomplete - status.checkSkippedIncomplete
  );
  const appBugs = status.failureCategoryCounts.app_bug ?? 0;
  return [
    `| Result | Test cases |`,
    `| --- | --- |`,
    `| Passed | ${passed} |`,
    `| Failed | ${failed} (likely app bugs: ${appBugs}) |`,
    `| Incomplete: blocked by dejav | ${status.blockedIncomplete} |`,
    `| Incomplete: checks skipped | ${status.checkSkippedIncomplete} |`,
    `| Incomplete: could not be judged | ${unjudged} |`,
    `| Quarantined failures (not counted) | ${status.quarantinedFailed} |`
  ].join("\n");
}

// src/github-action/run-action.ts
var import_node_crypto = require("node:crypto");
var import_promises2 = require("node:fs/promises");

// src/lib/dejav-api-client.ts
var DejavApiError = class extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "DejavApiError";
  }
};
var DEJAV_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
function requireId(name, value) {
  if (!DEJAV_ID_PATTERN.test(value)) {
    throw new DejavApiError(
      400,
      "INVALID_ID",
      `${name} must contain only letters, digits, "-", or "_" (got: ${JSON.stringify(value)})`
    );
  }
  return value;
}
var DejavClient = class {
  constructor(options) {
    this.options = options;
  }
  buildUrl(path) {
    const base = new URL(this.options.baseUrl);
    const url = new URL(path, base);
    if (url.origin !== base.origin) {
      throw new DejavApiError(
        400,
        "INVALID_URL",
        `Refused to request a different origin than the configured base URL: ${url.origin}`
      );
    }
    return url;
  }
  async request(method, path, body) {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = this.buildUrl(path);
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    let text;
    try {
      text = await res.text();
    } catch {
      throw new DejavApiError(
        502,
        "INCOMPLETE_RESPONSE",
        "The API response was interrupted before it finished. Retry a read; check the result before resending a write."
      );
    }
    let json;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok)
          throw new DejavApiError(
            502,
            "INVALID_JSON_RESPONSE",
            "The API returned invalid or truncated JSON. Check the result before resending a write."
          );
      }
    }
    if (!res.ok) {
      const errorBody = json ?? {};
      throw new DejavApiError(
        res.status,
        errorBody.code,
        errorBody.error ?? `Request failed with status ${res.status}`,
        errorBody.details
      );
    }
    if (json === void 0 || json === null) {
      throw new DejavApiError(
        502,
        "INVALID_JSON_RESPONSE",
        "The API returned an empty JSON response."
      );
    }
    return json;
  }
  startExecution(input2) {
    return this.request(
      "POST",
      "/api/executions",
      input2
    );
  }
  async getRunStatus(runId) {
    return this.request(
      "GET",
      `/api/runs/${encodeURIComponent(requireId("runId", runId))}/status`
    );
  }
  async stopRun(runId) {
    return this.request(
      "DELETE",
      `/api/runs/${encodeURIComponent(requireId("runId", runId))}`
    );
  }
  async listTestCases(projectId) {
    return this.request(
      "GET",
      `/api/test-cases?projectId=${encodeURIComponent(requireId("projectId", projectId))}`
    );
  }
  async listTestCasesWithProject(projectId) {
    return this.request(
      "GET",
      `/api/test-cases?projectId=${encodeURIComponent(requireId("projectId", projectId))}&includeProject=true`
    );
  }
  async importTestCasesCsv(projectId, csv) {
    return this.request(
      "POST",
      "/api/test-cases/import-definitions-csv",
      { projectId, csv }
    );
  }
  async exportTestCasesCsv(projectId) {
    const res = await this.fetchUnparsed(
      `/api/test-cases/export-csv?projectId=${encodeURIComponent(requireId("projectId", projectId))}`,
      "CSV export failed"
    );
    return res.text();
  }
  async getTestCase(testCaseId) {
    return this.request(
      "GET",
      `/api/test-cases/${encodeURIComponent(requireId("testCaseId", testCaseId))}`
    );
  }
  async createTestCases(input2) {
    return this.request(
      "POST",
      "/api/test-cases",
      input2
    );
  }
  async updateTestCase(testCaseId, input2) {
    return this.request(
      "PATCH",
      `/api/test-cases/${encodeURIComponent(requireId("testCaseId", testCaseId))}`,
      input2
    );
  }
  async exportRunResultsCsv(runId) {
    const res = await this.fetchUnparsed(
      `/api/runs/${encodeURIComponent(requireId("runId", runId))}/export/csv`
    );
    return res.text();
  }
  async exportRunResultsJUnit(runId) {
    const res = await this.fetchUnparsed(
      `/api/runs/${encodeURIComponent(requireId("runId", runId))}/export/junit`
    );
    return res.text();
  }
  async openRunEventsStream(runId, signal) {
    return this.fetchUnparsed(
      `/api/runs/${encodeURIComponent(requireId("runId", runId))}/events`,
      "Request failed",
      signal
    );
  }
  async fetchUnparsed(path, failure = "Request failed", signal) {
    const res = await (this.options.fetchImpl ?? fetch)(this.buildUrl(path), {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      signal
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
    }
    throw new DejavApiError(
      res.status,
      json.code,
      json.error ?? `${failure} with status ${res.status}`
    );
  }
};
function buildRunUrl(baseUrl, projectSlug, runId) {
  if (!projectSlug) return null;
  if (!DEJAV_ID_PATTERN.test(projectSlug) || !DEJAV_ID_PATTERN.test(runId)) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(projectSlug)}/runs/${encodeURIComponent(runId)}`;
}

// src/lib/dejav-run-outcome.ts
var TERMINAL_RUN_STATUSES = /* @__PURE__ */ new Set(["completed", "stopped", "error"]);
function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(status);
}
function classifyRunOutcome(status) {
  if (status.status === "completed") {
    if (status.verdictCounts.failed === 0 && status.verdictCounts.incomplete === 0) {
      return "ok";
    }
    if ((status.failureCategoryCounts.app_bug ?? 0) > 0) {
      return "app_bug";
    }
    return "other_failure";
  }
  return "not_completed";
}

// src/cli/github-actions-output.ts
var import_promises = require("node:fs/promises");
function isGithubActions(env = process.env) {
  return env.GITHUB_ACTIONS === "true";
}
function escapeWorkflowCommandValue(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function workflowCommand(level, message) {
  return `::${level}::${escapeWorkflowCommandValue(message)}`;
}
function escapeMarkdownTableCell(value) {
  return value.replace(/\|/g, "\\|");
}
function buildAnnotationLines(status, outcome, runUrl) {
  const { passed, failed, incomplete } = status.verdictCounts;
  const detail = [
    `${passed} passed`,
    `${failed} failed`,
    `${incomplete} incomplete (${status.blockedIncomplete} blocked, ${status.checkSkippedIncomplete} check skipped)`,
    `${status.quarantinedFailed} quarantined (not counted as failures)`
  ].join(", ");
  const link = runUrl ? ` ${runUrl}` : "";
  if (outcome === "ok") {
    return [
      workflowCommand("notice", `dejav run ${status.runId}: ${detail}.${link}`)
    ];
  }
  if (outcome === "not_completed") {
    return [
      workflowCommand(
        "error",
        `dejav run ${status.runId} did not complete (status=${status.status}): ${detail}.${link}`
      )
    ];
  }
  const level = outcome === "app_bug" ? "error" : "warning";
  return [
    workflowCommand(level, `dejav run ${status.runId}: ${detail}.${link}`)
  ];
}
function emitAnnotations(status, outcome, runUrl, env = process.env) {
  if (!isGithubActions(env)) return;
  for (const line of buildAnnotationLines(status, outcome, runUrl)) {
    process.stdout.write(`${line}
`);
  }
}
function buildStepSummaryMarkdown(status, runUrl) {
  const rows = [
    ["Status", status.status],
    ["Passed", String(status.verdictCounts.passed)],
    ["Failed", String(status.verdictCounts.failed)],
    ["Incomplete", String(status.verdictCounts.incomplete)],
    ["Quarantined (not counted)", String(status.quarantinedFailed)],
    ["Blocked (subset of incomplete)", String(status.blockedIncomplete)],
    [
      "Check skipped (subset of incomplete)",
      String(status.checkSkippedIncomplete)
    ],
    ["Credits consumed", String(status.creditsConsumed)]
  ];
  const lines = [
    `### dejav run \`${status.runId}\``,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    ...rows.map(
      ([k, v]) => `| ${escapeMarkdownTableCell(k)} | ${escapeMarkdownTableCell(v)} |`
    )
  ];
  if (runUrl) lines.push("", `[View run details](${runUrl})`);
  return `${lines.join("\n")}
`;
}
async function emitStepSummary(status, runUrl, env = process.env) {
  if (!isGithubActions(env)) return;
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    await (0, import_promises.appendFile)(summaryPath, buildStepSummaryMarkdown(status, runUrl));
  } catch (err) {
    process.stderr.write(
      `Warning: could not write to GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
async function emitGithubActionsOutput(status, outcome, runUrl, {
  stdoutIsMachineReadable = false,
  env = process.env
} = {}) {
  if (!stdoutIsMachineReadable) {
    emitAnnotations(status, outcome, runUrl, env);
  }
  await emitStepSummary(status, runUrl, env);
}

// src/github-action/run-action.ts
var InputError = class extends Error {
};
function input(env, name) {
  const value = env[`INPUT_${name.toUpperCase()}`]?.trim();
  return value ? value : void 0;
}
function positiveSeconds(env, name, fallback) {
  const raw = input(env, name);
  if (raw === void 0) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InputError(
      `${name} must be a positive number of seconds (got: ${raw})`
    );
  }
  return n;
}
function readInputs(env) {
  const projectId = input(env, "project-id");
  if (!projectId) throw new InputError("project-id is required");
  const apiKey = input(env, "api-key");
  if (!apiKey) {
    throw new InputError(
      "api-key is empty. GitHub passes no secrets to workflows run for pull requests from forks; skip this step for them with `if: github.event.pull_request.head.repo.full_name == github.repository`."
    );
  }
  return {
    apiKey,
    projectId,
    baseUrl: input(env, "base-url") ?? "https://dejav.io",
    testProfileId: input(env, "test-profile-id"),
    targetUrl: input(env, "target-url"),
    idempotencyKey: input(env, "idempotency-key"),
    timeoutSeconds: positiveSeconds(env, "timeout-seconds", 1800),
    pollIntervalSeconds: positiveSeconds(env, "poll-interval-seconds", 15),
    junitPath: input(env, "junit-path"),
    githubToken: input(env, "github-token"),
    checkName: input(env, "check-name") ?? "dejav"
  };
}
async function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return {};
  try {
    return JSON.parse(
      await (0, import_promises2.readFile)(env.GITHUB_EVENT_PATH, "utf8")
    );
  } catch {
    return {};
  }
}
function headSha(env, event) {
  return event.pull_request?.head?.sha ?? event.deployment?.sha ?? env.GITHUB_SHA;
}
function defaultIdempotencyKey(repository, sha, inputs) {
  if (!repository || !sha) return void 0;
  const variant = (0, import_node_crypto.createHash)("sha256").update(
    JSON.stringify([inputs.testProfileId ?? "", inputs.targetUrl ?? ""])
  ).digest("hex").slice(0, 12);
  return `github:${sha}:${variant}:${repository}`.slice(0, 200);
}
function escapeCommandValue(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function isTransient(err) {
  return !(err instanceof DejavApiError) || err.status >= 500;
}
function apiErrorMessage(err) {
  if (err instanceof DejavApiError) {
    return `${err.message}${err.code ? ` (${err.code})` : ""} [HTTP ${err.status}]`;
  }
  return err instanceof Error ? err.message : String(err);
}
async function setOutputs(env, outputs) {
  if (!env.GITHUB_OUTPUT) return;
  const delimiter = `dejav_${(0, import_node_crypto.randomUUID)()}`;
  const lines = Object.entries(outputs).map(
    ([name, value]) => `${name}<<${delimiter}
${value}
${delimiter}
`
  );
  await (0, import_promises2.appendFile)(env.GITHUB_OUTPUT, lines.join(""));
}
async function createCheckRun(deps, inputs, sha, report) {
  const repository = deps.env.GITHUB_REPOSITORY;
  if (!inputs.githubToken || !repository || !sha) {
    deps.write(
      "::notice::No GitHub check was created: github-token, GITHUB_REPOSITORY, or the commit SHA is missing.\n"
    );
    return;
  }
  const apiUrl = (deps.env.GITHUB_API_URL ?? "https://api.github.com").replace(
    /\/+$/,
    ""
  );
  const body = {
    name: inputs.checkName,
    head_sha: sha,
    status: "completed",
    conclusion: report.result.conclusion,
    completed_at: new Date(deps.now()).toISOString(),
    ...report.detailsUrl ? { details_url: report.detailsUrl } : {},
    output: { title: report.result.title, summary: report.summary }
  };
  try {
    const res = await deps.fetchImpl(
      `${apiUrl}/repos/${repository}/check-runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${inputs.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok) {
      deps.write(
        `::warning::Could not create the GitHub check (HTTP ${res.status}). Give the job \`permissions: checks: write\`.
`
      );
      return;
    }
    deps.write(
      `Created the GitHub check "${inputs.checkName}": ${report.result.conclusion}
`
    );
  } catch (err) {
    deps.write(
      `::warning::Could not create the GitHub check: ${escapeCommandValue(err instanceof Error ? err.message : String(err))}
`
    );
  }
}
async function finish(deps, inputs, sha, report, outputs) {
  await createCheckRun(deps, inputs, sha, report);
  await setOutputs(deps.env, {
    outcome: report.result.outcome,
    "run-id": outputs.runId ?? "",
    "run-url": outputs.runUrl ?? ""
  });
  deps.write(
    `outcome=${report.result.outcome} exit-code=${report.result.exitCode}
`
  );
  return report.result.exitCode;
}
function rejectedReport(message) {
  return {
    result: actionResult("rejected"),
    summary: `dejav refused the request: ${message}`,
    detailsUrl: null
  };
}
async function writeJUnit(deps, client, inputs, runId) {
  if (!inputs.junitPath) return;
  try {
    await (0, import_promises2.writeFile)(
      inputs.junitPath,
      await client.exportRunResultsJUnit(runId),
      "utf8"
    );
    deps.write(`Wrote the JUnit results to ${inputs.junitPath}
`);
  } catch (err) {
    deps.write(
      `::warning::Could not write the JUnit results: ${escapeCommandValue(apiErrorMessage(err))}
`
    );
  }
}
async function runAction(deps) {
  let inputs;
  try {
    inputs = readInputs(deps.env);
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    deps.write(`::error::${escapeCommandValue(err.message)}
`);
    await setOutputs(deps.env, {
      outcome: "rejected",
      "run-id": "",
      "run-url": ""
    });
    return actionResult("rejected").exitCode;
  }
  const event = await readEvent(deps.env);
  const sha = headSha(deps.env, event);
  const headRepo = event.pull_request?.head?.repo?.full_name;
  if (deps.env.GITHUB_EVENT_NAME === "pull_request_target" && headRepo !== deps.env.GITHUB_REPOSITORY) {
    deps.write(
      "::error::Refusing to start a run for a pull request from a fork on pull_request_target: anyone could spend your credits and point the run at their own URL. Use the pull_request event.\n"
    );
    await setOutputs(deps.env, {
      outcome: "rejected",
      "run-id": "",
      "run-url": ""
    });
    return actionResult("rejected").exitCode;
  }
  const client = new DejavClient({
    baseUrl: inputs.baseUrl,
    apiKey: inputs.apiKey,
    fetchImpl: deps.fetchImpl
  });
  const idempotencyKey = inputs.idempotencyKey ?? defaultIdempotencyKey(deps.env.GITHUB_REPOSITORY, sha, inputs);
  let runId;
  try {
    const started = await client.startExecution({
      projectId: inputs.projectId,
      testProfileId: inputs.testProfileId,
      allTestCases: true,
      targetUrlOverride: inputs.targetUrl,
      idempotencyKey
    });
    runId = started.runId;
    deps.write(
      started.idempotent ? `Reusing the run already started for this idempotency key: ${runId}
` : `Run started: ${runId}
`
    );
  } catch (err) {
    const message = apiErrorMessage(err);
    deps.write(
      `::error::dejav could not start the run: ${escapeCommandValue(message)}
`
    );
    return finish(deps, inputs, sha, rejectedReport(message), {});
  }
  const deadline = deps.now() + inputs.timeoutSeconds * 1e3;
  let status = null;
  let runUrl = null;
  while (true) {
    try {
      status = await client.getRunStatus(runId);
    } catch (err) {
      const message = apiErrorMessage(err);
      if (!isTransient(err)) {
        deps.write(
          `::error::dejav refused the status request: ${escapeCommandValue(message)}
`
        );
        return finish(deps, inputs, sha, rejectedReport(message), {
          runId,
          runUrl
        });
      }
      deps.write(
        `::warning::Could not read the run status, retrying: ${escapeCommandValue(message)}
`
      );
    }
    if (status) {
      if (!runUrl) {
        runUrl = buildRunUrl(inputs.baseUrl, status.projectSlug, runId);
        if (runUrl) deps.write(`Run page: ${runUrl}
`);
      }
      deps.write(
        `status=${status.status} passed=${status.verdictCounts.passed} failed=${status.verdictCounts.failed} incomplete=${status.verdictCounts.incomplete} blocked=${status.blockedIncomplete} checkSkipped=${status.checkSkippedIncomplete} quarantined=${status.quarantinedFailed}
`
      );
      if (isTerminalRunStatus(status.status)) break;
    }
    if (deps.now() >= deadline) {
      deps.write(
        `::error::Timed out after ${inputs.timeoutSeconds}s waiting for dejav run ${runId}
`
      );
      return finish(
        deps,
        inputs,
        sha,
        {
          result: actionResult("timed_out"),
          summary: `The run did not finish within ${inputs.timeoutSeconds} seconds. It keeps running in dejav.${status ? `

${countsSummary(status)}` : ""}`,
          detailsUrl: runUrl
        },
        { runId, runUrl }
      );
    }
    await deps.sleep(inputs.pollIntervalSeconds * 1e3);
  }
  await writeJUnit(deps, client, inputs, runId);
  await emitGithubActionsOutput(status, classifyRunOutcome(status), runUrl, {
    env: deps.env
  });
  const result = actionResult(outcomeForTerminalStatus(status));
  return finish(
    deps,
    inputs,
    sha,
    {
      result,
      summary: `dejav run \`${runId}\` ended with status \`${status.status}\`.

${countsSummary(status)}${runUrl ? `

[Open the run in dejav](${runUrl})` : ""}`,
      detailsUrl: runUrl
    },
    { runId, runUrl }
  );
}

// src/github-action/index.ts
runAction({
  env: process.env,
  fetchImpl: fetch,
  write: (text) => process.stdout.write(text),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
}).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}
`
    );
    process.exitCode = UNEXPECTED_ERROR_EXIT_CODE;
  }
);
