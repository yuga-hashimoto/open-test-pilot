import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@monaco-editor/react";
import { generatePlaywright } from "@open-test-pilot/generator";
import type { Manifest } from "@open-test-pilot/manifest-schema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createApi,
  getApiConfig,
  type ApiAiWorker,
  type ApiAiWorkerJob,
  type ApiAuditEvent,
  type ApiBranch,
  type ApiBranchComparison,
  type ApiChangeRequest,
  type ApiMember,
  type ApiProject,
  type ApiRepository,
  type ApiRun,
  type ApiRunner,
  type ApiSchedule,
  type ApiSecret,
  type ApiStoragePolicy,
  type ApiTest,
  type ApiTestManifest,
  type TestPilotApi,
} from "./api.js";
import "./style.css";

type Status = "passed" | "failed" | "running" | "cancelled";
interface Run {
  id: string;
  test: string;
  branch: string;
  duration: string;
  status: Status;
  time: string;
}

const demoRuns: Run[] = [
  {
    id: "run-9f31",
    test: "Checkout / guest payment",
    branch: "main",
    duration: "01:42",
    status: "passed",
    time: "2 min ago",
  },
  {
    id: "run-9f2c",
    test: "Account / sign in",
    branch: "feat/auth-refresh",
    duration: "00:38",
    status: "failed",
    time: "18 min ago",
  },
  {
    id: "run-9f1a",
    test: "Catalog / search filters",
    branch: "main",
    duration: "00:54",
    status: "passed",
    time: "42 min ago",
  },
  {
    id: "run-9ee8",
    test: "Account / sign in",
    branch: "main",
    duration: "00:12",
    status: "running",
    time: "Now",
  },
];

const manifest = [
  "name: Account / sign in",
  "type: web",
  "baseUrl: https://staging.shop.test",
  "steps:",
  "  - id: open-login",
  "    action: navigate",
  "    url: /login",
  "  - id: submit-login",
  "    action: click",
  '    target: getByRole(button, { name: "Sign in" })',
  "  - id: verify-home",
  "    action: expectVisible",
  '    target: getByText("Welcome back")',
];

function Icon({ name }: { name: string }) {
  return <span className={`icon icon-${name}`} aria-hidden="true" />;
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" />
      {status}
    </span>
  );
}

function App() {
  const api = useMemo<TestPilotApi | undefined>(() => {
    const config = getApiConfig();
    return config === undefined ? undefined : createApi(config);
  }, []);
  const [active, setActive] = useState("Overview");
  const [runs, setRuns] = useState<Run[]>(demoRuns);
  const [tests, setTests] = useState<ApiTest[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [auditEvents, setAuditEvents] = useState<ApiAuditEvent[]>([]);
  const [storagePolicy, setStoragePolicy] = useState<
    ApiStoragePolicy | undefined
  >();
  const [aiWorkers, setAiWorkers] = useState<ApiAiWorker[]>([]);
  const [aiWorkerJobs, setAiWorkerJobs] = useState<ApiAiWorkerJob[]>([]);
  const [secrets, setSecrets] = useState<ApiSecret[]>([]);
  const [schedules, setSchedules] = useState<ApiSchedule[]>([]);
  const [runners, setRunners] = useState<ApiRunner[]>([]);
  const [repositories, setRepositories] = useState<ApiRepository[]>([]);
  const [changeRequests, setChangeRequests] = useState<ApiChangeRequest[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | undefined>(
    api === undefined ? (demoRuns[1] ?? demoRuns[0]) : undefined,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingTest, setEditingTest] = useState<ApiTest | undefined>();
  const [manifestText, setManifestText] = useState("");
  const [manifestBaseline, setManifestBaseline] = useState("");
  const [manifestStatus, setManifestStatus] = useState<string | undefined>();
  const [manifestLoading, setManifestLoading] = useState(false);
  const [connection, setConnection] = useState<"demo" | "live" | "error">(
    api === undefined ? "demo" : "live",
  );
  const nav: Array<[string, string]> = [
    ["Overview", "grid"],
    ["Tests", "layers"],
    ["Runs", "activity"],
    ["Runners", "server"],
    ["Schedules", "clock"],
    ["GitHub", "branch"],
  ];
  useEffect(() => {
    if (api === undefined) return;
    void Promise.all([
      api.listRuns(),
      api.listTests(),
      api.listProjects(),
      api.listMembers(),
      api.listAuditLogs(),
      api.getStoragePolicy(),
      api.listAiWorkers(),
      api.listAiWorkerJobs(),
      api.listSecrets(),
      api.listSchedules(),
      api.listRunners(),
      api.listRepositories(),
      api.listChangeRequests(),
    ])
      .then(
        ([
          runItems,
          testItems,
          projectItems,
          memberItems,
          auditItems,
          policy,
          workerItems,
          workerJobItems,
          secretItems,
          scheduleItems,
          runnerItems,
          repositoryItems,
          changeRequestItems,
        ]) => {
          setTests(testItems);
          setProjects(projectItems);
          setMembers(memberItems);
          setAuditEvents(auditItems);
          setStoragePolicy(policy);
          setAiWorkers(workerItems);
          setAiWorkerJobs(workerJobItems);
          setSecrets(secretItems);
          setSchedules(scheduleItems);
          setRunners(runnerItems);
          setRepositories(repositoryItems);
          setChangeRequests(changeRequestItems);
          const liveRuns = runItems.map((run) => runForUi(run, testItems));
          setRuns(liveRuns);
          setSelectedRun((current) =>
            current !== undefined &&
            liveRuns.some((run) => run.id === current.id)
              ? current
              : liveRuns[0],
          );
          setConnection("live");
        },
      )
      .catch(() => setConnection("error"));
  }, [api]);
  const startRun = (requestedTest?: ApiTest) => {
    setRunning(true);
    const config = getApiConfig();
    const test =
      requestedTest ??
      tests.find((item) => item.id === config?.testId) ??
      tests[0];
    const projectId = config?.projectId ?? test?.projectId;
    const testId = config?.testId ?? test?.id;
    if (api !== undefined && projectId !== undefined && testId !== undefined) {
      void api
        .startRun(projectId, testId)
        .then((result) => {
          const run = runForUi(
            {
              id: result.runId,
              projectId,
              testId,
              status: result.status,
              createdAt: new Date().toISOString(),
            },
            tests,
          );
          setRuns((current) => [run, ...current]);
          setSelectedRun(run);
        })
        .catch(() => setConnection("error"))
        .finally(() => setRunning(false));
      return;
    }
    setTimeout(() => setRunning(false), 1800);
  };
  const cancelRun = (runId: string) => {
    if (api === undefined) return;
    void api
      .cancelRun(runId)
      .then(() =>
        setRuns((current) =>
          current.map((run) =>
            run.id === runId ? { ...run, status: "cancelled" } : run,
          ),
        ),
      )
      .catch(() => setConnection("error"));
  };
  const openManifestEditor = (test: ApiTest) => {
    setEditingTest(test);
    setManifestStatus(undefined);
    setManifestLoading(api !== undefined);
    if (api === undefined) {
      const initial = stringifyYaml({
        schemaVersion: "1.0.0",
        id: test.manifestId,
        name: test.name,
        steps: [],
      });
      setManifestText(initial);
      setManifestBaseline(initial);
      return;
    }
    void api
      .getManifest(test.id)
      .then((value) => {
        const initial = stringifyYaml(value);
        setManifestText(initial);
        setManifestBaseline(initial);
        setManifestLoading(false);
      })
      .catch(() => {
        setManifestStatus("Manifest could not be loaded");
        setManifestLoading(false);
      });
  };
  const saveManifest = () => {
    if (api === undefined || editingTest === undefined || manifestLoading)
      return;
    let parsed: ApiTestManifest;
    try {
      parsed = parseYaml(manifestText) as ApiTestManifest;
    } catch {
      setManifestStatus("YAML is invalid");
      return;
    }
    void api
      .updateManifest(editingTest.id, parsed)
      .then(() => {
        setManifestBaseline(stringifyYaml(parsed));
        setManifestStatus("Saved to team server");
      })
      .catch(() => setManifestStatus("Save failed"));
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>OpenTestPilot</strong>
            <small>QA control plane</small>
          </div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <button className="project-select">
          <span className="project-avatar">S</span>
          <span>
            <b>Shopfront</b>
            <small>staging</small>
          </span>
          <Icon name="chevron" />
        </button>
        <nav>
          {nav.map(([label, icon]) => (
            <button
              key={label}
              className={`nav-item ${active === label ? "active" : ""}`}
              onClick={() => setActive(label)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {label === "Runs" && (
                <em>{api === undefined ? 12 : runs.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="runner-card">
          <div className="runner-card-head">
            <span className="online-dot" />
            Runner fleet
          </div>
          <strong>
            {api === undefined ? 3 : runners.length}{" "}
            <small>/ {api === undefined ? 4 : runners.length} online</small>
          </strong>
          <div className="runner-bar">
            <i />
          </div>
          <span className="runner-caption">
            {api === undefined
              ? "1 runner is warming up"
              : `${runners.length} tenant runners registered`}
          </span>
        </div>
        <button
          className={`nav-item ${active === "Settings" ? "active" : ""}`}
          onClick={() => setActive("Settings")}
        >
          <Icon name="settings" />
          <span>Settings</span>
        </button>
        <div className="profile">
          <div className="profile-avatar">YK</div>
          <div>
            <b>Yu-ga Kato</b>
            <small>Owner</small>
          </div>
          <Icon name="more" />
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">SHOPFRONT / {active.toUpperCase()}</div>
            <h1>{active}</h1>
            <span className={`connection-state ${connection}`}>
              <span />
              {connection === "live"
                ? "Connected to team server"
                : connection === "error"
                  ? "API connection failed"
                  : "Demo data"}
            </span>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search">
              <Icon name="search" />
            </button>
            <button className="icon-button" aria-label="Notifications">
              <Icon name="bell" />
              <span className="notification-badge" />
            </button>
            <button
              className="run-button"
              onClick={() => startRun()}
              disabled={running}
            >
              <Icon name="play" />
              {running ? "Starting…" : "Run test"}
              <span className="shortcut">⌘ ↵</span>
            </button>
          </div>
        </header>
        {active === "Overview" ? (
          api !== undefined ? (
            <LiveOverview
              runs={runs}
              selectedRun={selectedRun}
              onSelect={setSelectedRun}
              onOpenRuns={() => setActive("Runs")}
            />
          ) : (
            <>
              <section className="metric-grid">
                <Metric
                  label="Pass rate"
                  value="94.8%"
                  change="+2.4%"
                  tone="green"
                  icon="check"
                />
                <Metric
                  label="Runs this week"
                  value="128"
                  change="+18"
                  tone="blue"
                  icon="activity"
                />
                <Metric
                  label="Median duration"
                  value="01:08"
                  change="−12s"
                  tone="purple"
                  icon="clock"
                />
                <Metric
                  label="Flaky tests"
                  value="4"
                  change="−2"
                  tone="orange"
                  icon="spark"
                />
              </section>
              <section className="content-grid">
                <div className="panel runs-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Recent runs</h2>
                      <p>Latest executions across your test suite</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActive("Runs")}
                    >
                      View all <span>→</span>
                    </button>
                  </div>
                  <div className="run-table">
                    <div className="table-head">
                      <span>TEST</span>
                      <span>BRANCH</span>
                      <span>DURATION</span>
                      <span>STATUS</span>
                      <span>WHEN</span>
                    </div>
                    {runs.map((run) => (
                      <button
                        className={`run-row ${selectedRun?.id === run.id ? "selected" : ""}`}
                        key={run.id}
                        onClick={() => setSelectedRun(run)}
                      >
                        <span className="test-name">
                          <span className={`run-icon ${run.status}`}>
                            <Icon
                              name={
                                run.status === "passed"
                                  ? "check"
                                  : run.status === "failed"
                                    ? "close"
                                    : "play"
                              }
                            />
                          </span>
                          <b>{run.test}</b>
                        </span>
                        <span className="branch">
                          <Icon name="branch" />
                          {run.branch}
                        </span>
                        <span className="muted">{run.duration}</span>
                        <StatusPill status={run.status} />
                        <span className="muted">{run.time}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel activity-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Activity</h2>
                      <p>Signals from your workspace</p>
                    </div>
                    <button className="more-button" aria-label="More activity">
                      •••
                    </button>
                  </div>
                  <Activity
                    icon="spark"
                    title="Test generated"
                    body="Account / sign in"
                    time="8m ago"
                  />
                  <Activity
                    icon="branch"
                    title="PR #184 opened"
                    body="Improve checkout coverage"
                    time="23m ago"
                  />
                  <Activity
                    icon="shield"
                    title="Runner updated"
                    body="linux-chromium-02"
                    time="1h ago"
                  />
                </div>
              </section>
              <section className="bottom-grid">
                <div className="panel editor-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Test editor</h2>
                      <p>Source-first YAML manifest</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setEditorOpen(!editorOpen)}
                    >
                      {editorOpen ? "Close editor" : "Open editor"}{" "}
                      <span>→</span>
                    </button>
                  </div>
                  <div className="editor-window">
                    <div className="editor-tabs">
                      <span className="active-tab">login.yaml</span>
                      <span>generated.spec.ts</span>
                      <span className="saved">● Saved</span>
                    </div>
                    <div className="code-area">
                      {manifest
                        .slice(0, editorOpen ? manifest.length : 8)
                        .map((line, i) => (
                          <div className="code-line" key={`${line}-${i}`}>
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            <code
                              className={line.includes(":") ? "syntax-key" : ""}
                            >
                              {line}
                            </code>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
                <div className="panel evidence-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Failure evidence</h2>
                      <p>
                        {selectedRun?.id ?? "run-9f2c"} ·{" "}
                        {selectedRun?.test ?? "Account / sign in"}
                      </p>
                    </div>
                    <span className="evidence-label">
                      <Icon name="image" /> 6 artifacts
                    </span>
                  </div>
                  <div className="evidence-image">
                    <div className="browser-chrome">
                      <span />
                      <span />
                      <span />
                      <small>staging.shop.test/login</small>
                    </div>
                    <div className="mock-page">
                      <div className="mock-logo">
                        shop<span>front</span>
                      </div>
                      <div className="mock-form">
                        <b>Welcome back</b>
                        <small>Sign in to continue</small>
                        <div className="mock-input" />
                        <div className="mock-input short" />
                        <div className="mock-error">
                          Unable to sign in. Please try again.
                        </div>
                        <div className="mock-button">Sign in</div>
                      </div>
                    </div>
                    <div className="evidence-overlay">
                      Assertion failed · verify-home
                    </div>
                  </div>
                  <div className="evidence-footer">
                    <span>
                      <Icon name="clock" /> 00:38.2
                    </span>
                    <span>
                      <Icon name="code" /> line 12
                    </span>
                    <button className="text-button">Open report →</button>
                  </div>
                </div>
              </section>
            </>
          )
        ) : active === "Tests" ? (
          <TestsView
            tests={tests}
            onRun={startRun}
            live={api !== undefined}
            editingTest={editingTest}
            manifestText={manifestText}
            manifestBaseline={manifestBaseline}
            manifestStatus={manifestStatus}
            manifestLoading={manifestLoading}
            onEdit={openManifestEditor}
            onManifestChange={setManifestText}
            onSave={saveManifest}
          />
        ) : active === "Runs" ? (
          <RunsView
            runs={runs}
            selectedRun={selectedRun}
            onSelect={setSelectedRun}
            api={api}
            onCancel={cancelRun}
          />
        ) : active === "Runners" ? (
          <RunnersView runners={runners} live={api !== undefined} />
        ) : active === "Schedules" ? (
          <SchedulesView
            schedules={schedules}
            tests={tests}
            live={api !== undefined}
            api={api}
            onRunStarted={(runId, schedule) => {
              const run = runForUi(
                {
                  id: runId,
                  projectId: schedule.projectId,
                  testId: schedule.testId,
                  status: "queued",
                  createdAt: new Date().toISOString(),
                },
                tests,
              );
              setRuns((current) => [run, ...current]);
              setSelectedRun(run);
              setActive("Runs");
            }}
          />
        ) : active === "GitHub" ? (
          <GitHubView
            repositories={repositories}
            changeRequests={changeRequests}
            live={api !== undefined}
            api={api}
            onRepositoryUpdated={(repository) =>
              setRepositories((current) =>
                current.map((item) =>
                  item.id === repository.id ? repository : item,
                ),
              )
            }
            onChangeRequestCreated={(changeRequest) =>
              setChangeRequests((current) => [changeRequest, ...current])
            }
          />
        ) : active === "Settings" ? (
          <SettingsView
            projects={projects}
            members={members}
            auditEvents={auditEvents}
            aiWorkers={aiWorkers}
            aiWorkerJobs={aiWorkerJobs}
            secrets={secrets}
            storagePolicy={storagePolicy}
            live={api !== undefined}
            api={api}
            onPolicyUpdated={setStoragePolicy}
            onSecretUpdated={(secret) =>
              setSecrets((current) => [
                secret,
                ...current.filter((item) => item.id !== secret.id),
              ])
            }
          />
        ) : (
          <section className="panel empty-state">
            <div className="empty-icon">
              <Icon name={active === "Runners" ? "server" : "layers"} />
            </div>
            <h2>{active}</h2>
            <p>
              {active === "Runners"
                ? "Runner registration and capability leasing are available through the tenant-safe API and runner CLI."
                : `Connect a team server to load ${active.toLowerCase()} from the API.`}
            </p>
            <button
              className="run-button"
              onClick={() => setActive("Overview")}
            >
              Back to overview
            </button>
          </section>
        )}
        <footer>
          <span>OpenTestPilot v0.1.0</span>
          <span>
            <span className="online-dot" /> All systems operational
          </span>
          <span>
            Docs <span>↗</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

function LiveOverview({
  runs,
  selectedRun,
  onSelect,
  onOpenRuns,
}: {
  runs: Run[];
  selectedRun: Run | undefined;
  onSelect: (run: Run) => void;
  onOpenRuns: () => void;
}) {
  const completed = runs.filter((run) => run.status !== "running");
  const passed = completed.filter((run) => run.status === "passed").length;
  const passRate =
    completed.length === 0
      ? "—"
      : `${((passed / completed.length) * 100).toFixed(1)}%`;
  const durations = completed
    .map((run) => durationSeconds(run.duration))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const median =
    durations.length === 0
      ? "—"
      : formatDuration(
          (durations[Math.floor((durations.length - 1) / 2)] ?? 0) * 1000,
        );
  return (
    <>
      <section className="metric-grid">
        <Metric
          label="Pass rate"
          value={passRate}
          change={`${completed.length} completed`}
          tone="green"
          icon="check"
        />
        <Metric
          label="Runs loaded"
          value={String(runs.length)}
          change="live server"
          tone="blue"
          icon="activity"
        />
        <Metric
          label="Median duration"
          value={median}
          change="selected organization"
          tone="purple"
          icon="clock"
        />
        <Metric
          label="Failed runs"
          value={String(completed.length - passed)}
          change="live evidence available"
          tone="orange"
          icon="spark"
        />
      </section>
      <section className="content-grid">
        <div className="panel runs-panel">
          <div className="panel-header">
            <div>
              <h2>Recent live runs</h2>
              <p>Execution records from the selected organization</p>
            </div>
            <button className="text-button" onClick={onOpenRuns}>
              View evidence <span>→</span>
            </button>
          </div>
          <div className="run-table">
            <div className="table-head">
              <span>TEST</span>
              <span>BRANCH</span>
              <span>DURATION</span>
              <span>STATUS</span>
              <span>WHEN</span>
            </div>
            {runs.slice(0, 6).map((run) => (
              <button
                className={`run-row ${selectedRun?.id === run.id ? "selected" : ""}`}
                key={run.id}
                onClick={() => onSelect(run)}
              >
                <span className="test-name">
                  <span className={`run-icon ${run.status}`}>
                    <Icon
                      name={
                        run.status === "passed"
                          ? "check"
                          : run.status === "failed"
                            ? "close"
                            : "play"
                      }
                    />
                  </span>
                  <b>{run.test}</b>
                </span>
                <span className="branch">
                  <Icon name="branch" />
                  {run.branch}
                </span>
                <span className="muted">{run.duration}</span>
                <StatusPill status={run.status} />
                <span className="muted">{run.time}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Live activity</h2>
              <p>Latest server run signals</p>
            </div>
          </div>
          {runs.slice(0, 4).map((run) => (
            <Activity
              key={run.id}
              icon={
                run.status === "passed"
                  ? "check"
                  : run.status === "failed"
                    ? "close"
                    : "play"
              }
              title={`Run ${run.status}`}
              body={`${run.test} · ${run.id}`}
              time={run.time}
            />
          ))}
        </div>
      </section>
      <section className="bottom-grid">
        <div className="panel editor-panel">
          <div className="panel-header">
            <div>
              <h2>Selected run</h2>
              <p>{selectedRun?.id ?? "No run selected"}</p>
            </div>
            <button className="text-button" onClick={onOpenRuns}>
              Open Runs <span>→</span>
            </button>
          </div>
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>Status</b>
                <span>{selectedRun?.status ?? "—"}</span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>Test</b>
                <span>{selectedRun?.test ?? "—"}</span>
              </div>
            </div>
            <p className="manifest-code">
              Open Runs to inspect structured failures, report status, and
              uploaded artifact bodies from the team server.
            </p>
          </div>
        </div>
        <div className="panel evidence-panel">
          <div className="panel-header">
            <div>
              <h2>Live evidence</h2>
              <p>{selectedRun?.id ?? "Select a run"}</p>
            </div>
            <span className="evidence-label">
              <Icon name="image" /> server-backed
            </span>
          </div>
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>Evidence source</b>
                <span>Team API · tenant-scoped run result</span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>Next step</b>
                <span>
                  Open Runs to load artifact links and failure details
                </span>
              </div>
            </div>
            <button className="run-button" onClick={onOpenRuns}>
              Inspect evidence →
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
function durationSeconds(value: string): number | undefined {
  const match = /^(\d+):(\d{2})$/.exec(value);
  return match === null ? undefined : Number(match[1]) * 60 + Number(match[2]);
}
function Metric({
  label,
  value,
  change,
  tone,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  tone: string;
  icon: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small className={tone === "orange" ? "negative" : ""}>{change}</small>
      </div>
      <div className="sparkline">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
function Activity({
  icon,
  title,
  body,
  time,
}: {
  icon: string;
  title: string;
  body: string;
  time: string;
}) {
  return (
    <div className="activity-item">
      <div className="activity-icon">
        <Icon name={icon} />
      </div>
      <div>
        <b>{title}</b>
        <span>{body}</span>
      </div>
      <time>{time}</time>
    </div>
  );
}

function TestsView({
  tests,
  onRun,
  live,
  editingTest,
  manifestText,
  manifestBaseline,
  manifestStatus,
  manifestLoading,
  onEdit,
  onManifestChange,
  onSave,
}: {
  tests: ApiTest[];
  onRun: (test: ApiTest) => void;
  live: boolean;
  editingTest: ApiTest | undefined;
  manifestText: string;
  manifestBaseline: string;
  manifestStatus: string | undefined;
  manifestLoading: boolean;
  onEdit: (test: ApiTest) => void;
  onManifestChange: (value: string) => void;
  onSave: () => void;
}) {
  const [view, setView] = useState<
    | "natural"
    | "tree"
    | "form"
    | "yaml"
    | "generated"
    | "custom"
    | "graph"
    | "diff"
    | "results"
  >("yaml");
  const parsed = useMemo(() => {
    try {
      return parseYaml(manifestText) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, [manifestText]);
  const generated = useMemo(() => {
    if (parsed === undefined)
      return "YAML must be valid before code can be generated.";
    try {
      return generatePlaywright(parsed as unknown as Manifest).code;
    } catch (error) {
      return `Generation unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, [parsed]);
  const updateField = (field: string, value: unknown) => {
    if (parsed === undefined) return;
    onManifestChange(stringifyYaml({ ...parsed, [field]: value }));
  };
  const customCode = Array.isArray(parsed?.["customCode"])
    ? parsed["customCode"]
    : [];
  return (
    <div className="tests-layout">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Tests</h2>
            <p>
              {live
                ? "Tests loaded from the selected organization"
                : "Connect a team server to load tests"}
            </p>
          </div>
        </div>
        {tests.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-icon">
              <Icon name="layers" />
            </div>
            <p>No tests are registered for this organization yet.</p>
          </div>
        ) : (
          <div className="live-list-body">
            {tests.map((test) => (
              <div className="live-list-row" key={test.id}>
                <div>
                  <b>{test.name}</b>
                  <span>
                    {test.manifestId} · {test.id}
                  </span>
                </div>
                <div className="row-actions">
                  <button className="text-button" onClick={() => onEdit(test)}>
                    Edit
                  </button>
                  <button className="text-button" onClick={() => onRun(test)}>
                    Run →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {editingTest !== undefined && (
        <section className="panel manifest-editor">
          <div className="panel-header">
            <div>
              <h2>{editingTest.name}</h2>
              <p>
                Source-first Manifest editor ·{" "}
                {manifestStatus ??
                  (manifestLoading ? "loading…" : "unsaved changes are local")}
              </p>
            </div>
            <button
              className="run-button"
              onClick={onSave}
              disabled={!live || manifestLoading}
            >
              Save
            </button>
          </div>
          <div className="editor-view-tabs">
            {(
              [
                "natural",
                "tree",
                "form",
                "yaml",
                "generated",
                "custom",
                "graph",
                "diff",
                "results",
              ] as const
            ).map((item) => (
              <button
                key={item}
                className={view === item ? "selected" : ""}
                onClick={() => setView(item)}
              >
                {item === "natural"
                  ? "Natural language"
                  : item === "tree"
                    ? "Tree"
                    : item === "form"
                      ? "Form"
                      : item === "yaml"
                        ? "YAML"
                        : item === "generated"
                          ? "Generated TS"
                          : item === "custom"
                            ? "Custom code"
                            : item === "graph"
                              ? "Graph"
                              : item === "diff"
                                ? "Git diff"
                                : "Results"}
              </button>
            ))}
          </div>
          {view === "natural" ? (
            <label className="editor-form-field">
              Describe this test
              <textarea
                value={String(parsed?.["description"] ?? "")}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder="Describe the user journey and expected outcome"
              />
            </label>
          ) : view === "form" ? (
            <div className="editor-form">
              <label>
                Name
                <input
                  value={String(parsed?.["name"] ?? "")}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </label>
              <label>
                Type
                <input
                  value={String(parsed?.["type"] ?? "")}
                  onChange={(event) => updateField("type", event.target.value)}
                />
              </label>
              <label>
                Priority
                <input
                  value={String(parsed?.["priority"] ?? "")}
                  onChange={(event) =>
                    updateField("priority", event.target.value)
                  }
                />
              </label>
            </div>
          ) : view === "tree" ? (
            <div className="manifest-tree" aria-label="Manifest tree">
              {parsed === undefined ? (
                <span className="editor-error">YAML is invalid</span>
              ) : (
                <Tree value={parsed} />
              )}
            </div>
          ) : view === "yaml" ? (
            <div className="monaco-editor-shell" aria-label="Manifest YAML">
              <Editor
                height="520px"
                defaultLanguage="yaml"
                theme="vs-dark"
                value={manifestText}
                onChange={(value) => onManifestChange(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  wordWrap: "on",
                  readOnly: manifestLoading,
                  automaticLayout: true,
                  fontSize: 13,
                }}
              />
            </div>
          ) : view === "graph" ? (
            <ManifestGraph manifest={parsed} />
          ) : view === "custom" ? (
            <pre className="manifest-code" aria-label="Custom code references">
              {JSON.stringify(customCode, null, 2)}
            </pre>
          ) : view === "results" ? (
            <div className="manifest-tree">
              <p>
                Run results are available in the Runs view after executing this
                test.
              </p>
              <p>
                Generated code is validated from the current Manifest before
                save.
              </p>
            </div>
          ) : (
            <pre
              className="manifest-code"
              aria-label={
                view === "generated" ? "Generated TypeScript" : "Manifest diff"
              }
            >
              {view === "generated"
                ? generated
                : manifestDiff(manifestBaseline, manifestText)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

function Tree({
  value,
  path = "$",
}: {
  value: unknown;
  path?: string;
}): ReactNode {
  if (Array.isArray(value))
    return (
      <div className="tree-node">
        <b>{path}</b>
        {value.map((item, index) => (
          <Tree
            key={`${path}-${index}`}
            value={item}
            path={`${path}[${index}]`}
          />
        ))}
      </div>
    );
  if (value !== null && typeof value === "object")
    return (
      <div className="tree-node">
        {Object.entries(value).map(([key, item]) => (
          <Tree key={`${path}.${key}`} value={item} path={`${path}.${key}`} />
        ))}
      </div>
    );
  return (
    <div className="tree-leaf">
      <span>{path}</span>
      <code>{String(value)}</code>
    </div>
  );
}

function manifestDiff(before: string, after: string): string {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const result: string[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    if (oldLines[index] === newLines[index])
      result.push(`  ${oldLines[index] ?? ""}`);
    else {
      if (oldLines[index] !== undefined) result.push(`- ${oldLines[index]}`);
      if (newLines[index] !== undefined) result.push(`+ ${newLines[index]}`);
    }
  }
  return result.join("\n");
}

function ManifestGraph({
  manifest,
}: {
  manifest: Record<string, unknown> | undefined;
}): ReactNode {
  const steps = Array.isArray(manifest?.["steps"])
    ? (manifest["steps"] as Array<Record<string, unknown>>)
    : [];
  if (steps.length === 0)
    return (
      <div className="manifest-tree">
        <span className="editor-error">
          Add steps to see the execution graph.
        </span>
      </div>
    );
  return (
    <div className="manifest-graph" aria-label="Manifest graph">
      {steps.map((step, index) => (
        <div className="graph-row" key={String(step["id"] ?? index)}>
          <div className="graph-node graph-step">
            <b>{String(step["id"] ?? `step-${index + 1}`)}</b>
            <small>step</small>
          </div>
          <span className="graph-arrow">→</span>
          <div className="graph-actions">
            {Array.isArray(step["actions"]) ? (
              (step["actions"] as Array<Record<string, unknown>>).map(
                (action, actionIndex) => (
                  <div
                    className="graph-node"
                    key={String(action["id"] ?? actionIndex)}
                  >
                    <b>{String(action["id"] ?? `action-${actionIndex + 1}`)}</b>
                    <small>{String(action["type"] ?? "action")}</small>
                  </div>
                ),
              )
            ) : (
              <span className="editor-error">No actions</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
function RunsView({
  runs,
  selectedRun,
  onSelect,
  api,
  onCancel,
}: {
  runs: Run[];
  selectedRun: Run | undefined;
  onSelect: (run: Run) => void;
  api: TestPilotApi | undefined;
  onCancel: (runId: string) => void;
}) {
  const [evidence, setEvidence] = useState<{
    failures: Array<Record<string, unknown>>;
    artifacts: Array<{ id: string; key: string; size: number }>;
    report?: { status: string; reportUrl?: string };
  }>();
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (api === undefined || selectedRun === undefined) {
      setEvidence(undefined);
      setArtifactUrls({});
      return;
    }
    let disposed = false;
    void api
      .getRunEvidence(selectedRun.id)
      .then((value) => {
        if (!disposed) setEvidence(value as unknown as typeof evidence);
      })
      .catch(() => {
        if (!disposed) setEvidence(undefined);
      });
    return () => {
      disposed = true;
    };
  }, [api, selectedRun]);
  useEffect(() => {
    if (api === undefined || evidence === undefined) return;
    let disposed = false;
    const urls: Record<string, string> = {};
    void Promise.all(
      evidence.artifacts.map(async (artifact) => {
        try {
          const blob = await api.getArtifactContent(artifact.id);
          urls[artifact.id] = URL.createObjectURL(blob);
        } catch {
          /* metadata remains visible if a body is unavailable */
        }
      }),
    ).then(() => {
      if (!disposed) setArtifactUrls(urls);
      else Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      disposed = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [api, evidence]);
  return (
    <div className="runs-layout">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Runs</h2>
            <p>Execution records from the selected organization</p>
          </div>
        </div>
        <div className="run-table">
          <div className="table-head">
            <span>TEST</span>
            <span>BRANCH</span>
            <span>DURATION</span>
            <span>STATUS</span>
            <span>WHEN</span>
          </div>
          {runs.map((run) => (
            <button
              className={`run-row ${selectedRun?.id === run.id ? "selected" : ""}`}
              key={run.id}
              onClick={() => onSelect(run)}
            >
              <span className="test-name">
                <span className={`run-icon ${run.status}`}>
                  <Icon
                    name={
                      run.status === "passed"
                        ? "check"
                        : run.status === "failed"
                          ? "close"
                          : "play"
                    }
                  />
                </span>
                <b>{run.test}</b>
              </span>
              <span className="branch">
                <Icon name="branch" />
                {run.branch}
              </span>
              <span className="muted">{run.duration}</span>
              <StatusPill status={run.status} />
              <span className="muted">{run.time}</span>
            </button>
          ))}
        </div>
        {selectedRun !== undefined &&
          (selectedRun.status === "running" ||
          selectedRun.status === "cancelled" ||
          selectedRun.status === "failed"
            ? false
            : true) &&
          selectedRun.status !== "passed" && (
            <button
              className="text-button"
              onClick={() => onCancel(selectedRun.id)}
            >
              Cancel selected run
            </button>
          )}
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Evidence</h2>
            <p>{selectedRun?.id ?? "Select a run"}</p>
          </div>
        </div>
        {evidence === undefined ? (
          <div className="empty-state compact">
            <p>
              Connect to the team server to load failures, artifacts, and report
              status.
            </p>
          </div>
        ) : (
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>Report status</b>
                <span>{evidence.report?.status ?? "unknown"}</span>
              </div>
              {evidence.report?.reportUrl !== undefined && (
                <a
                  className="text-button"
                  href={evidence.report.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open report ↗
                </a>
              )}
            </div>
            <div className="live-list-row">
              <div>
                <b>Failures</b>
                <span>
                  {evidence.failures.length} structured failure records
                </span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>Artifacts</b>
                <span>{evidence.artifacts.length} uploaded artifacts</span>
              </div>
            </div>
            {evidence.artifacts.map((artifact) => (
              <div className="live-list-row" key={artifact.id}>
                <div>
                  <b>{artifact.key}</b>
                  <span>
                    {artifact.size} bytes · {artifact.id}
                  </span>
                </div>
                {artifactUrls[artifact.id] !== undefined && (
                  <a
                    className="text-button"
                    href={artifactUrls[artifact.id]}
                    download={artifact.key}
                  >
                    Open ↗
                  </a>
                )}
              </div>
            ))}
            {evidence.failures.map((failure, index) => (
              <pre className="manifest-code" key={index}>
                {JSON.stringify(failure, null, 2)}
              </pre>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
function RunnersView({
  runners,
  live,
}: {
  runners: ApiRunner[];
  live: boolean;
}) {
  return (
    <section className="panel live-list">
      <div className="panel-header">
        <div>
          <h2>Runner fleet</h2>
          <p>
            {live
              ? "Registered runners and capabilities from the selected organization"
              : "Connect to the team server to load runners"}
          </p>
        </div>
      </div>
      {runners.length === 0 ? (
        <div className="empty-state compact">
          <div className="empty-icon">
            <Icon name="server" />
          </div>
          <p>No runners are registered for this organization yet.</p>
        </div>
      ) : (
        <div className="live-list-body">
          {runners.map((runner) => (
            <div className="live-list-row" key={runner.runnerId}>
              <div>
                <b>{runner.name}</b>
                <span>
                  {runner.runnerId} · {runner.capabilities.browsers.join(", ")}{" "}
                  · max {runner.capabilities.maxConcurrency}
                </span>
              </div>
              <span className="pill pill-passed">
                <span className="dot" />
                heartbeat {relativeTime(runner.heartbeatAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function SchedulesView({
  schedules,
  tests,
  live,
  api,
  onRunStarted,
}: {
  schedules: ApiSchedule[];
  tests: ApiTest[];
  live: boolean;
  api: TestPilotApi | undefined;
  onRunStarted: (runId: string, schedule: ApiSchedule) => void;
}) {
  const testName = new Map(tests.map((test) => [test.id, test.name]));
  const [triggering, setTriggering] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const trigger = (schedule: ApiSchedule) => {
    if (api === undefined || !schedule.enabled) return;
    setTriggering(schedule.id);
    setMessage(undefined);
    void api
      .triggerSchedule(schedule.id)
      .then((result) => {
        setMessage(`Queued ${result.runId}`);
        onRunStarted(result.runId, schedule);
      })
      .catch(() => setMessage("Schedule trigger failed"))
      .finally(() => setTriggering(undefined));
  };
  return (
    <section className="panel live-list">
      <div className="panel-header">
        <div>
          <h2>Schedules</h2>
          <p>
            {live
              ? "Schedules loaded from the selected organization"
              : "Connect a team server to load schedules"}
          </p>
        </div>
        {message !== undefined && (
          <span className="connection-state live">{message}</span>
        )}
      </div>
      {schedules.length === 0 ? (
        <div className="empty-state compact">
          <div className="empty-icon">
            <Icon name="clock" />
          </div>
          <p>No schedules are configured for this organization yet.</p>
        </div>
      ) : (
        <div className="live-list-body">
          {schedules.map((schedule) => (
            <div className="live-list-row" key={schedule.id}>
              <div>
                <b>{testName.get(schedule.testId) ?? schedule.testId}</b>
                <span>
                  {schedule.cron} · {schedule.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="row-actions">
                <span className="pill pill-running">
                  {schedule.enabled ? "active" : "paused"}
                </span>
                {schedule.enabled && (
                  <button
                    className="text-button"
                    onClick={() => trigger(schedule)}
                    disabled={triggering === schedule.id}
                  >
                    {triggering === schedule.id ? "Queueing…" : "Run now →"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function GitHubView({
  repositories,
  changeRequests,
  live,
  api,
  onRepositoryUpdated,
  onChangeRequestCreated,
}: {
  repositories: ApiRepository[];
  changeRequests: ApiChangeRequest[];
  live: boolean;
  api: TestPilotApi | undefined;
  onRepositoryUpdated: (repository: ApiRepository) => void;
  onChangeRequestCreated: (changeRequest: ApiChangeRequest) => void;
}) {
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<
    string | undefined
  >(repositories[0]?.id);
  const [syncing, setSyncing] = useState(false);
  const [title, setTitle] = useState("Repair generated login test");
  const [head, setHead] = useState("testpilot/repair/repair-live-2");
  const [body, setBody] = useState(
    "Validated Manifest-only repair proposal from Codex.",
  );
  const [message, setMessage] = useState<string | undefined>();
  const [changeTitle, setChangeTitle] = useState("Review locator repair");
  const [branches, setBranches] = useState<ApiBranch[]>([]);
  const [baseBranch, setBaseBranch] = useState("main");
  const [compareHead, setCompareHead] = useState("");
  const [comparison, setComparison] = useState<
    ApiBranchComparison | undefined
  >();
  const [newBranch, setNewBranch] = useState("testpilot/repair/repair-live-2");
  const [branchBaseSha, setBranchBaseSha] = useState("");
  const [commitPath, setCommitPath] = useState("tests/repair.yaml");
  const [commitMessage, setCommitMessage] = useState("test: add repair manifest");
  const [commitContent, setCommitContent] = useState("name: Repair\n");
  const selected =
    repositories.find((repository) => repository.id === selectedRepositoryId) ??
    repositories[0];
  useEffect(() => {
    if (api === undefined || selected === undefined) return;
    void api
      .listBranches(selected.id)
      .then((items) => {
        setBranches(items);
        if (items[0] !== undefined) setBaseBranch(items[0].name);
        if (items[1] !== undefined) setCompareHead(items[1].name);
        if (items[0] !== undefined) setBranchBaseSha(items[0].sha);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Branch listing failed",
        ),
      );
  }, [api, selected]);
  const sync = () => {
    if (api === undefined || selected === undefined) return;
    setSyncing(true);
    setMessage(undefined);
    void api
      .syncRepository(selected.id)
      .then((updated) => {
        onRepositoryUpdated(updated);
        setMessage(`Synced ${updated.fullName} (${updated.defaultBranch})`);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Repository sync failed",
        ),
      )
      .finally(() => setSyncing(false));
  };
  const createPr = () => {
    if (api === undefined || selected === undefined) return;
    setMessage(undefined);
    void api
      .createGitHubPullRequest(selected.id, { title, head, body, draft: true })
      .then((result) =>
        setMessage(
          `Draft PR #${result.pullRequest.number} created: ${result.pullRequest.htmlUrl}`,
        ),
      )
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "GitHub App PR creation failed",
        ),
      );
  };
  const compare = () => {
    if (
      api === undefined ||
      selected === undefined ||
      baseBranch.trim() === "" ||
      compareHead.trim() === ""
    )
      return;
    void api
      .compareBranches(selected.id, baseBranch.trim(), compareHead.trim())
      .then((result) => setComparison(result.comparison))
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Branch comparison failed",
        ),
      );
  };
  const createBranch = () => {
    if (
      api === undefined ||
      selected === undefined ||
      newBranch.trim() === "" ||
      (branchBaseSha.trim() === "" &&
        branches.find((branch) => branch.name === baseBranch)?.sha === undefined)
    )
      return;
    const baseSha =
      branchBaseSha.trim() ||
      branches.find((branch) => branch.name === baseBranch)?.sha ||
      "";
    void api
      .createBranch(selected.id, { branch: newBranch.trim(), baseSha })
      .then((result) => {
        setMessage(`Branch ${result.branch} created from ${result.baseSha}`);
        setBranches((current) => [
          ...current,
          { name: result.branch, sha: result.baseSha },
        ]);
        setCompareHead(result.branch);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Branch creation failed",
        ),
      );
  };
  const commitFile = () => {
    if (
      api === undefined ||
      selected === undefined ||
      newBranch.trim() === "" ||
      commitPath.trim() === "" ||
      commitMessage.trim() === ""
    )
      return;
    void api
      .commitFile(selected.id, {
        branch: newBranch.trim(),
        path: commitPath.trim(),
        content: commitContent,
        message: commitMessage.trim(),
      })
      .then((result) =>
        setMessage(`Committed ${result.path} (${result.commitSha})`),
      )
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "File commit failed",
        ),
      );
  };
  const createChange = () => {
    if (api === undefined || changeTitle.trim() === "") return;
    void api
      .createChangeRequest(changeTitle.trim(), body)
      .then(onChangeRequestCreated)
      .then(() => setMessage("Change request saved to the organization"))
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Change request creation failed",
        ),
      );
  };
  return (
    <div className="tests-layout">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>GitHub integration</h2>
            <p>
              {live
                ? "Repository and change-request controls for the selected organization"
                : "Connect a team server to use GitHub integration"}
            </p>
          </div>
          {message !== undefined && (
            <span className="connection-state live">{message}</span>
          )}
        </div>
        {repositories.length === 0 ? (
          <div className="empty-state compact">
            <p>No repositories are linked yet.</p>
          </div>
        ) : (
          <div className="live-list-body">
            {repositories.map((repository) => (
              <div className="live-list-row" key={repository.id}>
                <div>
                  <b>{repository.fullName}</b>
                  <span>
                    {repository.provider} · {repository.defaultBranch} ·
                    installation {repository.installationId ?? "not configured"}
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    className="text-button"
                    onClick={() => setSelectedRepositoryId(repository.id)}
                  >
                    Select
                  </button>
                  {selected?.id === repository.id && (
                    <button
                      className="text-button"
                      onClick={sync}
                      disabled={syncing}
                    >
                      {syncing ? "Syncing…" : "Sync →"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="panel-header">
          <div>
            <h2>Branch comparison</h2>
            <p>{branches.length} branches loaded from GitHub</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            Base branch
            <input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Head branch
            <input
              value={compareHead}
              onChange={(event) => setCompareHead(event.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={compare}
            disabled={!live || selected === undefined}
          >
            Compare branches →
          </button>
          {comparison !== undefined && (
            <div className="live-list-row">
              <div>
                <b>
                  {comparison.status} · +{comparison.aheadBy} / −
                  {comparison.behindBy}
                </b>
                <span>
                  {comparison.files.length} changed files ·{" "}
                  {comparison.files.map((file) => file.filename).join(", ") ||
                    "no file changes"}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="panel-header">
          <div>
            <h2>Branch and manifest write</h2>
            <p>Create a repair branch and commit a Manifest through the GitHub App</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            New branch
            <input
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Base SHA (optional when loaded)
            <input
              value={branchBaseSha}
              onChange={(event) => setBranchBaseSha(event.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={createBranch}
            disabled={!live || selected === undefined}
          >
            Create branch →
          </button>
          <label className="editor-form-field">
            Manifest path
            <input
              value={commitPath}
              onChange={(event) => setCommitPath(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Commit message
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Manifest content
            <textarea
              value={commitContent}
              onChange={(event) => setCommitContent(event.target.value)}
            />
          </label>
          <button
            className="run-button"
            onClick={commitFile}
            disabled={!live || selected === undefined}
          >
            Commit file →
          </button>
        </div>
        <div className="panel-header">
          <div>
            <h2>Change requests</h2>
            <p>Tenant-scoped review intent</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            Title
            <input
              value={changeTitle}
              onChange={(event) => setChangeTitle(event.target.value)}
            />
          </label>
          <button
            className="run-button"
            onClick={createChange}
            disabled={!live}
          >
            Create change request
          </button>
          {changeRequests.map((changeRequest) => (
            <div className="live-list-row" key={changeRequest.id}>
              <div>
                <b>{changeRequest.title}</b>
                <span>
                  {changeRequest.status} · {changeRequest.id}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel manifest-editor">
        <div className="panel-header">
          <div>
            <h2>Draft Pull Request</h2>
            <p>
              {selected?.fullName ?? "Select a repository"} · GitHub App-backed
            </p>
          </div>
          <button
            className="run-button"
            onClick={createPr}
            disabled={!live || selected === undefined}
          >
            Create draft PR
          </button>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Head branch
            <input
              value={head}
              onChange={(event) => setHead(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Body
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <p className="manifest-code">
            The server exchanges the GitHub App installation token, creates the
            branch/PR, and stores the resulting PR URL. Missing credentials are
            surfaced as a 503 instead of being simulated.
          </p>
        </div>
      </section>
    </div>
  );
}
function SettingsView({
  projects,
  members,
  auditEvents,
  aiWorkers,
  aiWorkerJobs,
  secrets,
  storagePolicy,
  live,
  api,
  onPolicyUpdated,
  onSecretUpdated,
}: {
  projects: ApiProject[];
  members: ApiMember[];
  auditEvents: ApiAuditEvent[];
  aiWorkers: ApiAiWorker[];
  aiWorkerJobs: ApiAiWorkerJob[];
  secrets: ApiSecret[];
  storagePolicy: ApiStoragePolicy | undefined;
  live: boolean;
  api: TestPilotApi | undefined;
  onPolicyUpdated: (policy: ApiStoragePolicy) => void;
  onSecretUpdated: (secret: ApiSecret) => void;
}) {
  const [successDays, setSuccessDays] = useState(
    String(storagePolicy?.successRetentionDays ?? 30),
  );
  const [failureDays, setFailureDays] = useState(
    String(storagePolicy?.failureRetentionDays ?? 180),
  );
  const [message, setMessage] = useState<string | undefined>();
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  useEffect(() => {
    if (storagePolicy !== undefined) {
      setSuccessDays(String(storagePolicy.successRetentionDays));
      setFailureDays(String(storagePolicy.failureRetentionDays));
    }
  }, [storagePolicy]);
  const savePolicy = () => {
    if (api === undefined) return;
    void api
      .updateStoragePolicy({
        successRetentionDays: Number(successDays),
        failureRetentionDays: Number(failureDays),
      })
      .then((updated) => {
        onPolicyUpdated(updated);
        setMessage("Storage policy saved");
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Storage policy update failed",
        ),
      );
  };
  const saveSecret = () => {
    if (
      api === undefined ||
      secretName.trim() === "" ||
      secretValue.length === 0
    )
      return;
    void api
      .createSecret({
        name: secretName.trim(),
        provider: "builtin",
        value: secretValue,
      })
      .then((secret) => {
        onSecretUpdated(secret);
        setSecretName("");
        setSecretValue("");
        setMessage(
          "Secret metadata saved; value is encrypted and never displayed",
        );
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Secret save failed",
        ),
      );
  };
  const rotateSecret = (secret: ApiSecret) => {
    if (api === undefined || secretValue.length === 0) return;
    void api
      .rotateSecret(secret.id, secretValue)
      .then((updated) => {
        onSecretUpdated(updated);
        setSecretValue("");
        setMessage(`${secret.name} rotated`);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Secret rotation failed",
        ),
      );
  };
  return (
    <div className="settings-grid">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Organization settings</h2>
            <p>
              {live
                ? "Tenant-scoped administration"
                : "Connect to the team server for organization settings"}
            </p>
          </div>
          {message !== undefined && (
            <span className="connection-state live">{message}</span>
          )}
        </div>
        <div className="live-list-body">
          <div className="live-list-row">
            <div>
              <b>Projects</b>
              <span>{projects.length} configured</span>
            </div>
          </div>
          <div className="live-list-row">
            <div>
              <b>Members</b>
              <span>{members.length} synchronized GitHub members</span>
            </div>
          </div>
          <div className="live-list-row">
            <div>
              <b>AI Workers</b>
              <span>
                {aiWorkers.length} registered ·{" "}
                {
                  aiWorkers.filter(
                    (worker) => worker.lastHeartbeatAt !== undefined,
                  ).length
                }{" "}
                heartbeating
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>AI Worker jobs</h2>
            <p>Failure analysis and repair jobs leased by registered workers</p>
          </div>
        </div>
        <div className="live-list-body">
          {aiWorkerJobs.length === 0 ? (
            <p>No AI Worker jobs yet.</p>
          ) : (
            aiWorkerJobs.slice(0, 12).map((job) => (
              <div className="live-list-row" key={job.id}>
                <div>
                  <b>{job.operation}</b>
                  <span>
                    {job.id} · attempt {job.attempt}
                  </span>
                </div>
                <span
                  className={`pill pill-${job.status === "completed" ? "passed" : job.status === "failed" || job.status === "cancelled" ? "failed" : "running"}`}
                >
                  {job.status}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="panel manifest-editor">
        <div className="panel-header">
          <div>
            <h2>Storage retention</h2>
            <p>Organization-level artifact policy</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            Successful run retention (days)
            <input
              type="number"
              min="0"
              value={successDays}
              onChange={(event) => setSuccessDays(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            Failed run retention (days)
            <input
              type="number"
              min="0"
              value={failureDays}
              onChange={(event) => setFailureDays(event.target.value)}
            />
          </label>
          <button
            className="run-button"
            onClick={savePolicy}
            disabled={!live || storagePolicy === undefined}
          >
            Save retention policy
          </button>
        </div>
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Audit log</h2>
            <p>Tenant-scoped administrative events</p>
          </div>
        </div>
        <div className="live-list-body">
          {auditEvents.length === 0 ? (
            <p>No audit events yet.</p>
          ) : (
            auditEvents.slice(0, 12).map((event) => (
              <div className="live-list-row" key={event.id}>
                <div>
                  <b>{event.action}</b>
                  <span>
                    {event.resourceType} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>Secrets</h2>
            <p>
              References only; plaintext is write-only and encrypted at rest
            </p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            Name
            <input
              value={secretName}
              onChange={(event) => setSecretName(event.target.value)}
              placeholder="checkout-token"
            />
          </label>
          <label className="editor-form-field">
            Value
            <input
              type="password"
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button
            className="run-button"
            onClick={saveSecret}
            disabled={!live || secretValue.length === 0}
          >
            Add secret
          </button>
          {secrets.map((secret) => (
            <div className="live-list-row" key={secret.id}>
              <div>
                <b>{secret.name}</b>
                <span>
                  {secret.provider} · {secret.maskedValue} ·{" "}
                  {secret.rotatedAt === undefined ? "never rotated" : "rotated"}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => rotateSecret(secret)}
                disabled={!live || secretValue.length === 0}
              >
                Rotate with value →
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function runForUi(run: ApiRun, tests: ApiTest[] = []): Run {
  return {
    id: run.id,
    test: tests.find((test) => test.id === run.testId)?.name ?? run.testId,
    branch: "server",
    duration:
      run.startedAt === undefined || run.endedAt === undefined
        ? "—"
        : formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt)),
    status: run.status === "queued" ? "running" : run.status,
    time: relativeTime(run.createdAt),
  };
}
function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function relativeTime(value: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(value)) / 1000),
  );
  return seconds < 60 ? "Now" : `${Math.floor(seconds / 60)}m ago`;
}

createRoot(document.getElementById("root")!).render(<App />);
