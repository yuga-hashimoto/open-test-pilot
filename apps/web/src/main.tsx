import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@monaco-editor/react";
import { generatePlaywright } from "@open-test-pilot/generator";
import type { Manifest } from "@open-test-pilot/manifest-schema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createApi,
  createAuthApi,
  getApiConfig,
  getApiServerBaseUrl,
  type ApiAiWorker,
  type ApiAiWorkerJob,
  type ApiAuditEvent,
  type ApiBranch,
  type ApiBranchComparison,
  type ApiChangeRequest,
  type ApiMember,
  type ApiProject,
  type ApiPullRequestSummary,
  type ApiRepository,
  type ApiRun,
  type ApiRunResult,
  type ApiRunner,
  type ApiSchedule,
  type ApiSecret,
  type ApiStoragePolicy,
  type ApiTest,
  type ApiTestManifest,
  type ApiManifestVersion,
  type ApiOrganization,
  type LoginCompleteResult,
  type TestPilotApi,
} from "./api.js";
import { getOrganizationDisplayName } from "./organization.js";
import { LocaleContext, translate, useLocale, useLocaleState, type LocaleApi } from "./i18n.js";
import "./style.css";
import "./usability.css";

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

const SESSION_KEY = "opentestpilot-session";
type StoredLoginSession = LoginCompleteResult & { organizationId?: string; organizationName?: string };
function getStoredSession(): StoredLoginSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return undefined;
    return JSON.parse(raw) as StoredLoginSession;
  } catch { return undefined; }
}
function storeSession(session: StoredLoginSession) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function LoginPage({ serverBaseUrl, onLogin }: { serverBaseUrl: string; onLogin: (session: LoginCompleteResult) => void; }) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const startLogin = () => {
    setLoading(true);
    setError(undefined);
    const redirectUri = `${window.location.origin}/auth/github/callback`;
    void createAuthApi(serverBaseUrl).startLogin(redirectUri)
      .then((result) => { window.location.href = result.authorizationUrl; })
      .catch((e) => { setError(e instanceof Error ? e.message : t("login.failedToStart")); setLoading(false); });
  };
  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">O</div>
          <div>
            <strong>OpenTestPilot</strong>
            <small>{t("brand.subtitle")}</small>
          </div>
        </div>
        <h1>{t("login.title")}</h1>
        <p>{t("login.subtitle")}</p>
        <button className="login-github-button" onClick={startLogin} disabled={loading}>
          <span className="login-github-icon" aria-hidden="true" />
          {loading ? t("login.redirecting") : t("login.button")}
        </button>
        {error !== undefined && <span className="login-error">{error}</span>}
      </div>
    </div>
  );
}

function CallbackPage({ serverBaseUrl, onLogin }: { serverBaseUrl: string; onLogin: (session: LoginCompleteResult) => void; }) {
  const { t } = useLocale();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code === null || state === null) { setError(t("callback.missingParams")); return; }
    void createAuthApi(serverBaseUrl).completeLogin(code, state)
      .then((session) => { storeSession(session); onLogin(session); })
      .catch((e) => { setError(e instanceof Error ? e.message : t("callback.failedToComplete")); });
  }, [serverBaseUrl, onLogin, t]);
  if (error !== undefined) {
    return (
      <div className="login-root">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-brand-mark">O</div>
            <div><strong>OpenTestPilot</strong></div>
          </div>
          <h1>{t("callback.failedTitle")}</h1>
          <p>{error}</p>
          <button className="login-github-button" onClick={() => { window.location.href = "/"; }}>
            {t("callback.tryAgain")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">O</div>
          <div><strong>OpenTestPilot</strong></div>
        </div>
        <h1>{t("callback.completingTitle")}</h1>
        <p>{t("callback.completingBody")}</p>
      </div>
    </div>
  );
}

function OrganizationPage({ serverBaseUrl, session, onSelect }: { serverBaseUrl: string; session: StoredLoginSession; onSelect: (organizationId: string, organizationName: string) => void }) {
  const { t } = useLocale();
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const authApi = useMemo(() => createAuthApi(serverBaseUrl), [serverBaseUrl]);
  const load = useCallback(() => {
    setLoading(true);
    void authApi.listOrganizations(session.sessionToken)
      .then(setOrganizations)
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("organization.listFailed")))
      .finally(() => setLoading(false));
  }, [authApi, session.sessionToken, t]);
  useEffect(() => { load(); }, [load]);
  const create = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setLoading(true);
    void authApi.createOrganization(session.sessionToken, trimmed)
      .then((organization) => onSelect(organization.id, organization.name))
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("organization.createFailed")))
      .finally(() => setLoading(false));
  };
  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-brand"><div className="login-brand-mark">O</div><div><strong>OpenTestPilot</strong><small>{t("brand.subtitle")}</small></div></div>
        <h1>{t("organization.title")}</h1>
        <p>{t("organization.subtitle")}</p>
        {organizations.map((organization) => <button key={organization.id} className="login-github-button organization-choice" onClick={() => onSelect(organization.id, organization.name)}>{organization.name}</button>)}
        <div className="organization-create">
          <input aria-label={t("organization.nameLabel")} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("organization.namePlaceholder")} />
          <button className="login-github-button" onClick={create} disabled={loading || name.trim().length === 0}>{t("organization.create")}</button>
        </div>
        {loading && organizations.length === 0 && <p>{t("organization.loading")}</p>}
        {error !== undefined && <span className="login-error">{error}</span>}
      </div>
    </div>
  );
}

const NAV_I18N_KEYS: Record<string, string> = {
  Overview: "nav.overview",
  Tests: "nav.tests",
  Runs: "nav.runs",
  Runners: "nav.runners",
  Schedules: "nav.schedules",
  GitHub: "nav.github",
  Settings: "nav.settings",
};

function App({ sessionToken, login, organizationId, organizationName, serverBaseUrl, onLogout }: { sessionToken?: string | undefined; login?: string | undefined; organizationId?: string | undefined; organizationName?: string | undefined; serverBaseUrl?: string | undefined; onLogout?: (() => void) | undefined }) {
  const { t, locale, setLocale } = useLocale();
  const api = useMemo<TestPilotApi | undefined>(() => {
    const config = getApiConfig();
    const resolvedOrganizationId = organizationId ?? config?.organizationId;
    const resolvedBaseUrl = serverBaseUrl ?? config?.baseUrl;
    if (resolvedOrganizationId === undefined || resolvedBaseUrl === undefined) return undefined;
    return createApi({
      baseUrl: resolvedBaseUrl,
      organizationId: resolvedOrganizationId,
      ...(config?.projectId === undefined ? {} : { projectId: config.projectId }),
      ...(config?.testId === undefined ? {} : { testId: config.testId }),
      ...(sessionToken === undefined ? {} : { sessionToken }),
    });
  }, [organizationId, serverBaseUrl, sessionToken]);
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
  const [manifestVersions, setManifestVersions] = useState<ApiManifestVersion[]>(
    [],
  );
  const [connection, setConnection] = useState<"demo" | "live" | "error">(
    api === undefined ? "demo" : "live",
  );
  const [testSearchSignal, setTestSearchSignal] = useState(0);
  const nav: Array<[string, string]> = [
    ["Overview", "grid"],
    ["Tests", "layers"],
    ["Runs", "activity"],
    ["Runners", "server"],
    ["Schedules", "clock"],
    ["GitHub", "branch"],
  ];
  const workspaceName = organizationName === undefined && api === undefined ? "Shopfront" : getOrganizationDisplayName(organizationName === undefined ? undefined : { name: organizationName });
  const workspaceSubtitle = organizationName === undefined && api === undefined ? "staging" : "team";
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
          const liveRuns = runItems.map((run) => runForUi(run, testItems, t));
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
            t,
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
  const runningRef = useRef(running);
  runningRef.current = running;
  const startRunRef = useRef(startRun);
  startRunRef.current = startRun;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!runningRef.current) startRunRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
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
      setManifestVersions([]);
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
    void Promise.all([api.getManifest(test.id), api.listManifestVersions(test.id)])
      .then(([value, versions]) => {
        const initial = stringifyYaml(value);
        setManifestText(initial);
        setManifestBaseline(initial);
        setManifestVersions(versions);
        setManifestLoading(false);
      })
      .catch(() => {
        setManifestStatus(t("app.manifestLoadFailed"));
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
      setManifestStatus(t("app.yamlInvalid"));
      return;
    }
    void api
      .updateManifest(editingTest.id, parsed)
      .then(async () => {
        setManifestBaseline(stringifyYaml(parsed));
        setManifestVersions(await api.listManifestVersions(editingTest.id));
        setManifestStatus(t("app.savedToServer"));
      })
      .catch(() => setManifestStatus(t("app.saveFailed")));
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>OpenTestPilot</strong>
            <small>{t("brand.subtitle")}</small>
          </div>
        </div>
        <div className="workspace-label">{t("sidebar.workspace")}</div>
        <button className="project-select">
          <span className="project-avatar">S</span>
          <span>
            <b>{workspaceName}</b>
            <small>{workspaceSubtitle}</small>
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
              <span>{t(NAV_I18N_KEYS[label] ?? label)}</span>
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
            {t("sidebar.runnerFleet")}
          </div>
          <strong>
            {api === undefined ? 3 : runners.length}{" "}
            <small>{t("sidebar.online", { total: api === undefined ? 4 : runners.length })}</small>
          </strong>
          <div className="runner-bar">
            <i />
          </div>
          <span className="runner-caption">
            {api === undefined
              ? t("sidebar.runnerWarming")
              : t("sidebar.tenantRunners", { n: runners.length })}
          </span>
        </div>
        <button
          className={`nav-item ${active === "Settings" ? "active" : ""}`}
          onClick={() => setActive("Settings")}
        >
          <Icon name="settings" />
          <span>{t("nav.settings")}</span>
        </button>
        <button
          className="nav-item locale-switch"
          onClick={() => setLocale(locale === "ja" ? "en" : "ja")}
          title={locale === "ja" ? t("locale.switchToEnglish") : t("locale.switchToJapanese")}
        >
          <Icon name="chevron" />
          <span>{locale === "ja" ? "EN" : "日本語"}</span>
        </button>
        <div className="profile">
          <div className="profile-avatar">{login !== undefined ? login.slice(0, 2).toUpperCase() : "YK"}</div>
          <div>
            <b>{login ?? "Yu-ga Kato"}</b>
            <small>{login !== undefined ? t("sidebar.github") : t("sidebar.owner")}</small>
          </div>
          {onLogout !== undefined && (
            <button className="logout-button" onClick={onLogout} title={t("sidebar.signOut")}>
              <Icon name="more" />
            </button>
          )}
          {onLogout === undefined && <Icon name="more" />}
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">SHOPFRONT / {t(NAV_I18N_KEYS[active] ?? active).toUpperCase()}</div>
            <h1>{t(NAV_I18N_KEYS[active] ?? active)}</h1>
            <span className={`connection-state ${connection}`}>
              <span />
              {connection === "live"
                ? t("topbar.connectedLive")
                : connection === "error"
                  ? t("topbar.connectionError")
                  : t("topbar.demoData")}
            </span>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label={t("topbar.search")}
              onClick={() => {
                setActive("Tests");
                setTestSearchSignal((value) => value + 1);
              }}
            >
              <Icon name="search" />
            </button>
            <button className="icon-button" aria-label={t("topbar.notifications")}>
              <Icon name="bell" />
              <span className="notification-badge" />
            </button>
            <button
              className="run-button"
              onClick={() => startRun()}
              disabled={running}
            >
              <Icon name="play" />
              {running ? t("topbar.starting") : t("topbar.runTest")}
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
                  label={t("overview.passRate")}
                  value="94.8%"
                  change="+2.4%"
                  tone="green"
                  icon="check"
                />
                <Metric
                  label={t("overview.runsThisWeek")}
                  value="128"
                  change="+18"
                  tone="blue"
                  icon="activity"
                />
                <Metric
                  label={t("overview.medianDuration")}
                  value="01:08"
                  change="−12s"
                  tone="purple"
                  icon="clock"
                />
                <Metric
                  label={t("overview.flakyTests")}
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
                      <h2>{t("overview.recentRuns")}</h2>
                      <p>{t("overview.recentRunsSubtitle")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActive("Runs")}
                    >
                      {t("overview.viewAll")} <span>→</span>
                    </button>
                  </div>
                  <div className="run-table">
                    <div className="table-head">
                      <span>{t("table.test")}</span>
                      <span>{t("table.branch")}</span>
                      <span>{t("table.duration")}</span>
                      <span>{t("table.status")}</span>
                      <span>{t("table.when")}</span>
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
                      <h2>{t("overview.activity")}</h2>
                      <p>{t("overview.activitySubtitle")}</p>
                    </div>
                    <button className="more-button" aria-label={t("overview.moreActivity")}>
                      •••
                    </button>
                  </div>
                  <Activity
                    icon="spark"
                    title={t("overview.testGenerated")}
                    body={t("overview.accountSignIn")}
                    time={t("time.minutesAgo", { n: 8 })}
                  />
                  <Activity
                    icon="branch"
                    title={t("overview.prOpened")}
                    body={t("overview.improveCheckout")}
                    time={t("time.minutesAgo", { n: 23 })}
                  />
                  <Activity
                    icon="shield"
                    title={t("overview.runnerUpdated")}
                    body="linux-chromium-02"
                    time="1h ago"
                  />
                </div>
              </section>
              <section className="bottom-grid">
                <div className="panel editor-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{t("overview.testEditor")}</h2>
                      <p>{t("overview.sourceFirstYaml")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setEditorOpen(!editorOpen)}
                    >
                      {editorOpen ? t("overview.closeEditor") : t("overview.openEditor")}{" "}
                      <span>→</span>
                    </button>
                  </div>
                  <div className="editor-window">
                    <div className="editor-tabs">
                      <span className="active-tab">login.yaml</span>
                      <span>generated.spec.ts</span>
                      <span className="saved">● {t("overview.saved")}</span>
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
                      <h2>{t("overview.failureEvidence")}</h2>
                      <p>
                        {selectedRun?.id ?? "run-9f2c"} ·{" "}
                        {selectedRun?.test ?? t("overview.accountSignIn")}
                      </p>
                    </div>
                    <span className="evidence-label">
                      <Icon name="image" /> {t("overview.artifactsCount", { n: 6 })}
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
                      {t("overview.assertionFailed")}
                    </div>
                  </div>
                  <div className="evidence-footer">
                    <span>
                      <Icon name="clock" /> 00:38.2
                    </span>
                    <span>
                      <Icon name="code" /> line 12
                    </span>
                    <button className="text-button">{t("overview.openReport")} →</button>
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
            searchSignal={testSearchSignal}
            editingTest={editingTest}
            manifestText={manifestText}
            manifestBaseline={manifestBaseline}
            manifestStatus={manifestStatus}
            manifestLoading={manifestLoading}
            manifestVersions={manifestVersions}
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
                t,
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
            <h2>{t(NAV_I18N_KEYS[active] ?? active)}</h2>
            <p>
              {active === "Runners"
                ? t("empty.runnersDescription")
                : `${t("empty.connectPrefix")} ${t(NAV_I18N_KEYS[active] ?? active).toLowerCase()}`}
            </p>
            <button
              className="run-button"
              onClick={() => setActive("Overview")}
            >
              {t("empty.back")}
            </button>
          </section>
        )}
        <footer>
          <span>{t("footer.version")}</span>
          <span>
            <span className="online-dot" /> {t("footer.operational")}
          </span>
          <span>
            {t("footer.docs")} <span>↗</span>
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
  const { t } = useLocale();
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
          label={t("overview.passRate")}
          value={passRate}
          change={t("liveOverview.completed", { n: completed.length })}
          tone="green"
          icon="check"
        />
        <Metric
          label={t("liveOverview.runsLoaded")}
          value={String(runs.length)}
          change={t("liveOverview.liveServer")}
          tone="blue"
          icon="activity"
        />
        <Metric
          label={t("overview.medianDuration")}
          value={median}
          change={t("liveOverview.selectedOrg")}
          tone="purple"
          icon="clock"
        />
        <Metric
          label={t("liveOverview.failedRuns")}
          value={String(completed.length - passed)}
          change={t("liveOverview.liveEvidenceAvailable")}
          tone="orange"
          icon="spark"
        />
      </section>
      <section className="content-grid">
        <div className="panel runs-panel">
          <div className="panel-header">
            <div>
              <h2>{t("liveOverview.recentLiveRuns")}</h2>
              <p>{t("liveOverview.recentLiveRunsSubtitle")}</p>
            </div>
            <button className="text-button" onClick={onOpenRuns}>
              {t("liveOverview.viewEvidence")} <span>→</span>
            </button>
          </div>
          <div className="run-table">
            <div className="table-head">
              <span>{t("table.test")}</span>
              <span>{t("table.branch")}</span>
              <span>{t("table.duration")}</span>
              <span>{t("table.status")}</span>
              <span>{t("table.when")}</span>
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
              <h2>{t("liveOverview.liveActivity")}</h2>
              <p>{t("liveOverview.liveActivitySubtitle")}</p>
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
              title={t("liveOverview.runStatus", { status: run.status })}
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
              <h2>{t("liveOverview.selectedRun")}</h2>
              <p>{selectedRun?.id ?? t("liveOverview.noRunSelected")}</p>
            </div>
            <button className="text-button" onClick={onOpenRuns}>
              {t("liveOverview.openRuns")} <span>→</span>
            </button>
          </div>
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>{t("liveOverview.status")}</b>
                <span>{selectedRun?.status ?? "—"}</span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>{t("liveOverview.test")}</b>
                <span>{selectedRun?.test ?? "—"}</span>
              </div>
            </div>
            <p className="manifest-code">
              {t("liveOverview.inspectHint")}
            </p>
          </div>
        </div>
        <div className="panel evidence-panel">
          <div className="panel-header">
            <div>
              <h2>{t("liveOverview.liveEvidence")}</h2>
              <p>{selectedRun?.id ?? t("liveOverview.selectARun")}</p>
            </div>
            <span className="evidence-label">
              <Icon name="image" /> {t("liveOverview.serverBacked")}
            </span>
          </div>
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>{t("liveOverview.evidenceSource")}</b>
                <span>{t("liveOverview.evidenceSourceValue")}</span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>{t("liveOverview.nextStep")}</b>
                <span>
                  {t("liveOverview.nextStepValue")}
                </span>
              </div>
            </div>
            <button className="run-button" onClick={onOpenRuns}>
              {t("liveOverview.inspectEvidence")} →
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
  searchSignal,
  editingTest,
  manifestText,
  manifestBaseline,
  manifestStatus,
  manifestLoading,
  manifestVersions,
  onEdit,
  onManifestChange,
  onSave,
}: {
  tests: ApiTest[];
  onRun: (test: ApiTest) => void;
  live: boolean;
  searchSignal: number;
  editingTest: ApiTest | undefined;
  manifestText: string;
  manifestBaseline: string;
  manifestStatus: string | undefined;
  manifestLoading: boolean;
  manifestVersions: ApiManifestVersion[];
  onEdit: (test: ApiTest) => void;
  onManifestChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchSignal > 0) searchRef.current?.focus();
  }, [searchSignal]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTests =
    normalizedQuery === ""
      ? tests
      : tests.filter((test) =>
          [test.name, test.manifestId, test.id].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          ),
        );
  const [view, setView] = useState<
    | "natural"
    | "tree"
    | "form"
    | "yaml"
    | "generated"
    | "custom"
    | "graph"
    | "diff"
    | "versions"
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
      return t("tests.generationUnavailable", { message: error instanceof Error ? error.message : String(error) });
    }
  }, [parsed, t]);
  const updateField = (field: string, value: unknown) => {
    if (parsed === undefined) return;
    onManifestChange(stringifyYaml({ ...parsed, [field]: value }));
  };
  const apiActions = Array.isArray(parsed?.["steps"])
    ? (parsed["steps"] as Array<Record<string, unknown>>).flatMap((step) => Array.isArray(step["actions"]) ? step["actions"] as Array<Record<string, unknown>> : []).filter((action) => action["type"] === "api.request")
    : [];
  const firstApiAction = apiActions[0];
  const updateFirstApiAction = (patch: Record<string, unknown>) => {
    if (parsed === undefined || firstApiAction === undefined || !Array.isArray(parsed["steps"])) return;
    let updated = false;
    const steps = (parsed["steps"] as Array<Record<string, unknown>>).map((step) => ({
      ...step,
      ["actions"]: Array.isArray(step["actions"]) ? (step["actions"] as Array<Record<string, unknown>>).map((action) => {
        if (!updated && action["type"] === "api.request") { updated = true; return { ...action, ...patch }; }
        return action;
      }) : step["actions"],
    }));
    onManifestChange(stringifyYaml({ ...parsed, steps }));
  };
  const customCode = Array.isArray(parsed?.["customCode"])
    ? parsed["customCode"]
    : [];
  const manifestSteps = Array.isArray(parsed?.["steps"])
    ? (parsed["steps"] as Array<Record<string, unknown>>)
    : [];
  const manifestActionCount = manifestSteps.reduce(
    (total, step) => total + (Array.isArray(step["actions"]) ? step["actions"].length : 0),
    0,
  );
  const yamlHealthy = parsed !== undefined && typeof parsed === "object" && (parsed as unknown) !== null;
  return (
    <div className="tests-layout">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("tests.title")}</h2>
            <p>
              {live
                ? t("tests.subtitleLive")
                : t("tests.subtitleDemo")}
            </p>
          </div>
        </div>
        <div className="test-search">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("tests.searchPlaceholder")}
            aria-label={t("tests.searchPlaceholder")}
          />
        </div>
        {tests.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-icon">
              <Icon name="layers" />
            </div>
            <p>{t("tests.noTests")}</p>
          </div>
        ) : visibleTests.length === 0 ? (
          <p className="filter-empty">{t("tests.noMatches", { query: query.trim() })}</p>
        ) : (
          <div className="live-list-body">
            {visibleTests.map((test) => (
              <div className="live-list-row" key={test.id}>
                <div>
                  <b>{test.name}</b>
                  <span>
                    {test.manifestId} · {test.id}
                  </span>
                </div>
                <div className="row-actions">
                  <button className="text-button" onClick={() => onEdit(test)}>
                    {t("tests.edit")}
                  </button>
                  <button className="text-button" onClick={() => onRun(test)}>
                    {t("tests.run")} →
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
                {t("tests.sourceFirstEditor")} ·{" "}
                {manifestStatus ??
                  (manifestLoading ? t("tests.statusLoading") : t("tests.statusUnsaved"))}
              </p>
            </div>
            <button
              className="run-button"
              onClick={onSave}
              disabled={!live || manifestLoading}
            >
              {t("tests.save")}
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
                "versions",
                "results",
              ] as const
            ).map((item) => (
              <button
                key={item}
                className={view === item ? "selected" : ""}
                onClick={() => setView(item)}
              >
                {t(`tests.tab.${item}`)}
              </button>
            ))}
          </div>
          <div className={`manifest-health ${yamlHealthy ? "ok" : "bad"}`} role="status">
            {yamlHealthy
              ? t("tests.health.ok", { steps: manifestSteps.length, actions: manifestActionCount })
              : t("tests.health.invalid")}
          </div>
          {view === "natural" ? (
            <label className="editor-form-field">
              {t("tests.describeThisTest")}
              <textarea
                value={String(parsed?.["description"] ?? "")}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder={t("tests.describePlaceholder")}
              />
            </label>
          ) : view === "form" ? (
            <div className="editor-form">
              <label>
                {t("tests.name")}
                <input
                  value={String(parsed?.["name"] ?? "")}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </label>
              <label>
                {t("tests.type")}
                <input
                  value={String(parsed?.["type"] ?? "")}
                  onChange={(event) => updateField("type", event.target.value)}
                />
              </label>
              <label>
                {t("tests.priority")}
                <input
                  value={String(parsed?.["priority"] ?? "")}
                  onChange={(event) =>
                    updateField("priority", event.target.value)
                  }
                />
              </label>
              {firstApiAction !== undefined && (
                <fieldset className="editor-api-fields">
                  <legend>API request</legend>
                  <label>
                    Method
                    <input value={String(firstApiAction["method"] ?? "GET")} onChange={(event) => updateFirstApiAction({ method: event.target.value.toUpperCase() })} />
                  </label>
                  <label>
                    URL
                    <input value={String(firstApiAction["url"] ?? "")} onChange={(event) => updateFirstApiAction({ url: event.target.value })} />
                  </label>
                  <label>
                    Expected status
                    <input type="number" value={String(firstApiAction["expectedStatus"] ?? 200)} onChange={(event) => updateFirstApiAction({ expectedStatus: Number(event.target.value) })} />
                  </label>
                  <label>
                    Response JSON Schema
                    <textarea value={JSON.stringify(firstApiAction["responseSchema"] ?? {}, null, 2)} onChange={(event) => { try { updateFirstApiAction({ responseSchema: JSON.parse(event.target.value) }); } catch { /* keep the last valid schema until JSON is complete */ } }} />
                  </label>
                </fieldset>
              )}
            </div>
          ) : view === "tree" ? (
            <div className="manifest-tree" aria-label={t("tests.manifestTree")}>
              {parsed === undefined ? (
                <span className="editor-error">{t("tests.yamlInvalid")}</span>
              ) : (
                <Tree value={parsed} />
              )}
            </div>
          ) : view === "yaml" ? (
            <div className="monaco-editor-shell" aria-label={t("tests.manifestYaml")}>
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
            <pre className="manifest-code" aria-label={t("tests.customCode")}>
              {JSON.stringify(customCode, null, 2)}
            </pre>
          ) : view === "versions" ? (
            <div className="live-list-body" aria-label={t("tests.manifestVersions")}>
              {manifestVersions.length === 0 ? (
                <p>{t("tests.noVersions")}</p>
              ) : (
                manifestVersions.map((version) => (
                  <div className="live-list-row" key={version.id}>
                    <div>
                      <b>{t("tests.version", { n: version.version })}</b>
                      <span>
                        {version.commitSha} · {new Date(version.createdAt).toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}
                      </span>
                    </div>
                    <code>{String(version.manifest["name"] ?? version.testId)}</code>
                  </div>
                ))
              )}
            </div>
          ) : view === "results" ? (
            <div className="manifest-tree">
              <p>
                {t("tests.resultsHint1")}
              </p>
              <p>
                {t("tests.resultsHint2")}
              </p>
            </div>
          ) : (
            <pre
              className="manifest-code"
                aria-label={
                view === "generated" ? t("tests.generatedCode") : t("tests.manifestDiff")
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
  const { t } = useLocale();
  const steps = Array.isArray(manifest?.["steps"])
    ? (manifest["steps"] as Array<Record<string, unknown>>)
    : [];
  if (steps.length === 0)
    return (
      <div className="manifest-tree">
        <span className="editor-error">
          {t("tests.needStepsForGraph")}
        </span>
      </div>
    );
  return (
    <div className="manifest-graph" aria-label={t("tests.manifestGraph")}>
      {steps.map((step, index) => (
        <div className="graph-row" key={String(step["id"] ?? index)}>
          <div className="graph-node graph-step">
            <b>{String(step["id"] ?? `step-${index + 1}`)}</b>
            <small>{t("tests.step")}</small>
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
                    <small>{String(action["type"] ?? t("tests.action"))}</small>
                  </div>
                ),
              )
            ) : (
              <span className="editor-error">{t("tests.noActions")}</span>
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
  const { t } = useLocale();
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const statusCounts = runs.reduce<Record<Status, number>>(
    (counts, run) => ({ ...counts, [run.status]: counts[run.status] + 1 }),
    { passed: 0, failed: 0, running: 0, cancelled: 0 },
  );
  const visibleRuns =
    statusFilter === "all" ? runs : runs.filter((run) => run.status === statusFilter);
  const [evidence, setEvidence] = useState<{
    failures: Array<Record<string, unknown>>;
    artifacts: Array<{ id: string; key: string; size: number }>;
    report?: { status: string; reportUrl?: string };
  }>();
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
  const [runResult, setRunResult] = useState<ApiRunResult | undefined>();
  useEffect(() => {
    if (api === undefined || selectedRun === undefined) {
      setEvidence(undefined);
      setArtifactUrls({});
      setRunResult(undefined);
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
    if (api === undefined || selectedRun === undefined) return;
    let disposed = false;
    void api
      .getRunResult(selectedRun.id)
      .then((result) => {
        if (!disposed) setRunResult(result);
      })
      .catch(() => {
        if (!disposed) setRunResult(undefined);
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
            <h2>{t("runs.title")}</h2>
            <p>{t("runs.subtitle")}</p>
          </div>
        </div>
        <div className="filter-chips" role="group" aria-label={t("runs.filterAria")}>
          {(["all", "passed", "failed", "running", "cancelled"] as const).map((value) => (
            <button
              key={value}
              className={`filter-chip ${statusFilter === value ? "selected" : ""}`}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              {t(`runs.filter.${value}`)}
              <em>{value === "all" ? runs.length : statusCounts[value]}</em>
            </button>
          ))}
        </div>
        <div className="run-table">
          <div className="table-head">
            <span>{t("table.test")}</span>
            <span>{t("table.branch")}</span>
            <span>{t("table.duration")}</span>
            <span>{t("table.status")}</span>
            <span>{t("table.when")}</span>
          </div>
          {visibleRuns.length === 0 && (
            <p className="filter-empty">{t("runs.noMatches")}</p>
          )}
          {visibleRuns.map((run) => (
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
        {selectedRun !== undefined && selectedRun.status === "running" && (
          <button
            className="text-button cancel-run-button"
            onClick={() => onCancel(selectedRun.id)}
          >
            {t("runs.cancelSelected")}
          </button>
        )}
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("runs.evidence")}</h2>
            <p>{selectedRun?.id ?? t("runs.selectRun")}</p>
          </div>
        </div>
        {evidence === undefined ? (
          <div className="empty-state compact">
            <p>
              {t("runs.connectHint")}
            </p>
          </div>
        ) : (
          <div className="live-list-body">
            <div className="live-list-row">
              <div>
                <b>{t("runs.reportStatus")}</b>
                <span>{evidence.report?.status ?? t("runs.unknown")}</span>
              </div>
              {evidence.report?.reportUrl !== undefined && (
                <a
                  className="text-button"
                  href={evidence.report.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("runs.openReport")} ↗
                </a>
              )}
            </div>
            <div className="live-list-row">
              <div>
                <b>{t("runs.failures")}</b>
                <span>
                  {t("runs.failuresCount", { n: evidence.failures.length })}
                </span>
              </div>
            </div>
            <div className="live-list-row">
              <div>
                <b>{t("runs.artifactsLabel")}</b>
                <span>{t("runs.artifactsCount", { n: evidence.artifacts.length })}</span>
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
                    {t("runs.open")} ↗
                  </a>
                )}
              </div>
            ))}
            {evidence.failures.map((failure, index) => (
              <pre className="manifest-code" key={index}>
                {JSON.stringify(failure, null, 2)}
              </pre>
            ))}
            {runResult !== undefined && (
            <div className="manifest-tree" aria-label={t("runs.resultsAria")}>
                <b>{t("runs.stepsAndActions")}</b>
                {runResult.steps.map((step) => (
                  <div className="live-list-row" key={step.stepId}>
                    <div>
                      <b>{step.stepId}</b>
                      <span>
                        {step.status} · {t("runs.actionsCount", { n: step.actions.length })}
                      </span>
                      {step.actions.map((action) => (
                        <span key={action.actionId}>
                          {action.actionId} · {action.type} · {action.status}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
  const { t } = useLocale();
  return (
    <section className="panel live-list">
      <div className="panel-header">
        <div>
          <h2>{t("runners.title")}</h2>
          <p>
            {live
              ? t("runners.subtitleLive")
              : t("runners.subtitleDemo")}
          </p>
        </div>
      </div>
      {runners.length === 0 ? (
        <div className="empty-state compact">
          <div className="empty-icon">
            <Icon name="server" />
          </div>
          <p>{t("runners.noRunners")}</p>
        </div>
      ) : (
        <div className="live-list-body">
          {runners.map((runner) => (
            <div className="live-list-row" key={runner.runnerId}>
              <div>
                <b>{runner.name}</b>
                <span>
                  {runner.runnerId} · {runner.capabilities.browsers.join(", ")}{" "}
                  · {t("runners.max", { n: runner.capabilities.maxConcurrency })}
                </span>
              </div>
              <span className="pill pill-passed">
                <span className="dot" />
                {t("runners.heartbeat", { time: relativeTime(runner.heartbeatAt, t) })}
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
  const { t } = useLocale();
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
        setMessage(t("schedules.queued", { id: result.runId }));
        onRunStarted(result.runId, schedule);
      })
      .catch(() => setMessage(t("schedules.triggerFailed")))
      .finally(() => setTriggering(undefined));
  };
  return (
    <section className="panel live-list">
      <div className="panel-header">
        <div>
          <h2>{t("schedules.title")}</h2>
          <p>
            {live
              ? t("schedules.subtitleLive")
              : t("schedules.subtitleDemo")}
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
          <p>{t("schedules.noSchedules")}</p>
        </div>
      ) : (
        <div className="live-list-body">
          {schedules.map((schedule) => (
            <div className="live-list-row" key={schedule.id}>
              <div>
                <b>{testName.get(schedule.testId) ?? schedule.testId}</b>
                <span>
                  {schedule.cron} · {schedule.enabled ? t("schedules.enabled") : t("schedules.disabled")}
                </span>
              </div>
              <div className="row-actions">
                <span className="pill pill-running">
                  {schedule.enabled ? t("schedules.active") : t("schedules.paused")}
                </span>
                {schedule.enabled && (
                  <button
                    className="text-button"
                    onClick={() => trigger(schedule)}
                    disabled={triggering === schedule.id}
                  >
                    {triggering === schedule.id ? t("schedules.queueing") : `${t("schedules.runNow")} →`}
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
  const { t } = useLocale();
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
  const [pullRequests, setPullRequests] = useState<ApiPullRequestSummary[]>([]);
  const [manifestPath, setManifestPath] = useState("tests/login.yaml");
  const [manifestRef, setManifestRef] = useState("main");
  const [manifestFile, setManifestFile] = useState<{ path: string; sha: string; content: string } | undefined>();
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
          error instanceof Error ? error.message : t("github.branchListFailed"),
        ),
      );
  }, [api, selected, t]);
  useEffect(() => {
    if (api === undefined || selected === undefined) return;
    void api
      .listPullRequests(selected.id, "all")
      .then(setPullRequests)
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("github.pullRequestHistoryFailed"),
        ),
      );
  }, [api, selected, t]);
  const sync = () => {
    if (api === undefined || selected === undefined) return;
    setSyncing(true);
    setMessage(undefined);
    void api
      .syncRepository(selected.id)
      .then((updated) => {
        onRepositoryUpdated(updated);
        setMessage(t("github.syncedMsg", { name: updated.fullName, branch: updated.defaultBranch }));
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("github.repositorySyncFailed"),
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
          t("github.prCreated", { number: result.pullRequest.number, url: result.pullRequest.htmlUrl }),
        ),
      )
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : t("github.prCreateFailed"),
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
          error instanceof Error ? error.message : t("github.comparisonFailed"),
        ),
      );
  };
  const loadManifestFile = () => {
    if (api === undefined || selected === undefined || manifestPath.trim() === "") return;
    void api
      .getRepositoryFile(selected.id, manifestPath.trim(), manifestRef.trim() || undefined)
      .then((file) => {
        setManifestFile(file);
        setMessage(t("github.loadedMsg", { path: file.path, ref: manifestRef.trim() || selected.defaultBranch }));
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : t("github.fileLoadFailed")),
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
        setMessage(t("github.branchCreated", { branch: result.branch, sha: result.baseSha }));
        setBranches((current) => [
          ...current,
          { name: result.branch, sha: result.baseSha },
        ]);
        setCompareHead(result.branch);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("github.branchCreateFailed"),
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
        setMessage(t("github.committedMsg", { path: result.path, sha: result.commitSha })),
      )
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("github.fileCommitFailed"),
        ),
      );
  };
  const createChange = () => {
    if (api === undefined || changeTitle.trim() === "") return;
    void api
      .createChangeRequest(changeTitle.trim(), body)
      .then(onChangeRequestCreated)
      .then(() => setMessage(t("github.changeSaved")))
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : t("github.changeCreateFailed"),
        ),
      );
  };
  return (
    <div className="tests-layout">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("github.title")}</h2>
            <p>
              {live
                ? t("github.subtitleLive")
                : t("github.subtitleDemo")}
            </p>
          </div>
          {message !== undefined && (
            <span className="connection-state live">{message}</span>
          )}
        </div>
        {repositories.length === 0 ? (
          <div className="empty-state compact">
            <p>{t("github.noRepos")}</p>
          </div>
        ) : (
          <div className="live-list-body">
            {repositories.map((repository) => (
              <div className="live-list-row" key={repository.id}>
                <div>
                  <b>{repository.fullName}</b>
                  <span>
                    {repository.provider} · {repository.defaultBranch} ·
                    {t("github.installation", { id: repository.installationId ?? t("github.notConfigured") })}
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    className="text-button"
                    onClick={() => setSelectedRepositoryId(repository.id)}
                  >
                    {t("github.select")}
                  </button>
                  {selected?.id === repository.id && (
                    <button
                      className="text-button"
                      onClick={sync}
                      disabled={syncing}
                    >
                      {syncing ? t("github.syncing") : `${t("github.sync")} →`}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="panel-header">
          <div>
            <h2>{t("github.branchComparison")}</h2>
            <p>{t("github.branchesLoaded", { n: branches.length })}</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("github.baseBranch")}
            <input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.headBranch")}
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
            {t("github.compareBranches")} →
          </button>
          {comparison !== undefined && (
            <div className="live-list-row">
              <div>
                <b>
                  {comparison.status} · +{comparison.aheadBy} / −
                  {comparison.behindBy}
                </b>
                <span>
                  {t("github.filesChanged", { n: comparison.files.length })} ·{" "}
                  {comparison.files.map((file) => file.filename).join(", ") ||
                    t("github.noFileChanges")}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="panel-header">
          <div>
            <h2>{t("github.manifestSourceHistory")}</h2>
            <p>{t("github.pullRequestsLoaded", { n: pullRequests.length })}</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("github.manifestPath")}
            <input value={manifestPath} onChange={(event) => setManifestPath(event.target.value)} />
          </label>
          <label className="editor-form-field">
            {t("github.gitRef")}
            <input value={manifestRef} onChange={(event) => setManifestRef(event.target.value)} />
          </label>
          <button className="text-button" onClick={loadManifestFile} disabled={!live || selected === undefined}>
            {t("github.loadManifest")} →
          </button>
          {manifestFile !== undefined && (
            <div className="live-list-row">
              <div>
                <b>{manifestFile.path} · {manifestFile.sha}</b>
                <pre className="manifest-code">{manifestFile.content}</pre>
              </div>
            </div>
          )}
          {pullRequests.map((pullRequest) => (
            <div className="live-list-row" key={pullRequest.number}>
              <div>
                <b>#{pullRequest.number} · {pullRequest.title}</b>
                <span>{pullRequest.state} · {pullRequest.head} → {pullRequest.base} · {pullRequest.htmlUrl}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-header">
          <div>
            <h2>{t("github.branchWrite")}</h2>
            <p>{t("github.branchWriteSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("github.newBranch")}
            <input
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.baseSha")}
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
            {t("github.createBranch")} →
          </button>
          <label className="editor-form-field">
            {t("github.manifestPath")}
            <input
              value={commitPath}
              onChange={(event) => setCommitPath(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.commitMessage")}
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.manifestContent")}
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
            {t("github.commitFile")} →
          </button>
        </div>
        <div className="panel-header">
          <div>
            <h2>{t("github.changeRequests")}</h2>
            <p>{t("github.changeRequestsSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("github.titleLabel")}
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
            {t("github.createChangeRequest")}
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
            <h2>{t("github.draftPr")}</h2>
            <p>
              {selected?.fullName ?? t("github.selectRepoBacked")}
            </p>
          </div>
          <button
            className="run-button"
            onClick={createPr}
            disabled={!live || selected === undefined}
          >
            {t("github.createDraftPr")}
          </button>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("github.titleLabel")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.headBranch")}
            <input
              value={head}
              onChange={(event) => setHead(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("github.body")}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <p className="manifest-code">
            {t("github.appExplainer")}
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
  const { t, locale } = useLocale();
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
        setMessage(t("settings.policySaved"));
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : t("settings.policySaveFailed"),
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
          t("settings.secretSaved"),
        );
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("settings.secretSaveFailed"),
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
        setMessage(t("settings.secretRotated", { name: secret.name }));
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : t("settings.secretRotateFailed"),
        ),
      );
  };
  return (
    <div className="settings-grid">
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("settings.orgSettings")}</h2>
            <p>
              {live
                ? t("settings.tenantScoped")
                : t("settings.connectForSettings")}
            </p>
          </div>
          {message !== undefined && (
            <span className="connection-state live">{message}</span>
          )}
        </div>
        <div className="live-list-body">
          <div className="live-list-row">
            <div>
              <b>{t("settings.projects")}</b>
              <span>{t("settings.configured", { n: projects.length })}</span>
            </div>
          </div>
          <div className="live-list-row">
            <div>
              <b>{t("settings.members")}</b>
              <span>{t("settings.syncedMembers", { n: members.length })}</span>
            </div>
          </div>
          <div className="live-list-row">
            <div>
              <b>{t("settings.aiWorkers")}</b>
              <span>
                {t("settings.registeredHeartbeating", {
                  n: aiWorkers.length,
                  m: aiWorkers.filter((worker) => worker.lastHeartbeatAt !== undefined).length,
                })}
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("settings.aiWorkerJobs")}</h2>
            <p>{t("settings.aiWorkerJobsSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          {aiWorkerJobs.length === 0 ? (
            <p>{t("settings.noJobs")}</p>
          ) : (
            aiWorkerJobs.slice(0, 12).map((job) => (
              <div className="live-list-row" key={job.id}>
                <div>
                  <b>{job.operation}</b>
                  <span>
                    {job.id} · {t("settings.attempt", { n: job.attempt })}
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
            <h2>{t("settings.storageRetention")}</h2>
            <p>{t("settings.storageRetentionSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          <label className="editor-form-field">
            {t("settings.successRetention")}
            <input
              type="number"
              min="0"
              value={successDays}
              onChange={(event) => setSuccessDays(event.target.value)}
            />
          </label>
          <label className="editor-form-field">
            {t("settings.failureRetention")}
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
            {t("settings.saveRetention")}
          </button>
        </div>
      </section>
      <section className="panel live-list">
        <div className="panel-header">
          <div>
            <h2>{t("settings.auditLog")}</h2>
            <p>{t("settings.auditLogSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          {auditEvents.length === 0 ? (
            <p>{t("settings.noAuditEvents")}</p>
          ) : (
            auditEvents.slice(0, 12).map((event) => (
              <div className="live-list-row" key={event.id}>
                <div>
                  <b>{event.action}</b>
                  <span>
                    {event.resourceType} ·{" "}
                    {new Date(event.createdAt).toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}
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
            <h2>{t("settings.secrets")}</h2>
            <p>{t("settings.secretsSubtitle")}</p>
          </div>
        </div>
        <div className="live-list-body">
          <form onSubmit={(event) => { event.preventDefault(); saveSecret(); }}>
            <label className="editor-form-field">
              {t("settings.secretNameLabel")}
              <input
                value={secretName}
                onChange={(event) => setSecretName(event.target.value)}
                placeholder={t("settings.secretNamePlaceholder")}
              />
            </label>
            <label className="editor-form-field">
              {t("settings.secretValueLabel")}
              <input
                type="password"
                value={secretValue}
                onChange={(event) => setSecretValue(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button
              type="submit"
              className="run-button"
              disabled={!live || secretValue.length === 0}
            >
              {t("settings.addSecret")}
            </button>
          </form>
          {secrets.map((secret) => (
            <div className="live-list-row" key={secret.id}>
              <div>
                <b>{secret.name}</b>
                <span>
                  {secret.provider === "builtin" ? t("settings.provider.builtin") : secret.provider} · {secret.maskedValue} ·{" "}
                  {secret.rotatedAt === undefined ? t("settings.neverRotated") : t("settings.rotated")}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => rotateSecret(secret)}
                disabled={!live || secretValue.length === 0}
              >
                {t("settings.rotateWithValue")} →
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function runForUi(run: ApiRun, tests: ApiTest[] = [], t: LocaleApi["t"] = (key, params) => translate("en", key, params)): Run {
  return {
    id: run.id,
    test: tests.find((test) => test.id === run.testId)?.name ?? run.testId,
    branch: "server",
    duration:
      run.startedAt === undefined || run.endedAt === undefined
        ? "—"
        : formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt)),
    status: run.status === "queued" ? "running" : run.status,
    time: relativeTime(run.createdAt, t),
  };
}
function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function relativeTime(value: string, t: LocaleApi["t"] = (key, params) => translate("en", key, params)): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(value)) / 1000),
  );
  return seconds < 60 ? t("time.now") : t("time.minutesAgo", { n: Math.floor(seconds / 60) });
}

function Root() {
  const { t } = useLocale();
  const serverBaseUrl = useMemo(() => getApiServerBaseUrl(), []);
  const config = useMemo(() => getApiConfig(), []);
  const authRequired = import.meta.env["VITE_OPENTESTPILOT_AUTH_REQUIRED"] === "true";
  const [session, setSession] = useState<StoredLoginSession | undefined>(() => {
    if (config?.sessionToken !== undefined) return undefined;
    const stored = getStoredSession();
    if (stored !== undefined && stored.expiresAt !== undefined && new Date(stored.expiresAt) <= new Date()) { clearSession(); return undefined; }
    return stored;
  });
  const handleLogin = useCallback((result: LoginCompleteResult) => {
    storeSession(result);
    setSession(result);
    window.history.replaceState({}, "", "/");
  }, []);
  const handleOrganization = useCallback((organizationId: string, organizationName: string) => {
    setSession((current) => {
      if (current === undefined) return current;
      const updated = { ...current, organizationId, organizationName };
      storeSession(updated);
      return updated;
    });
  }, []);
  const handleLogout = useCallback(() => { clearSession(); setSession(undefined); }, []);
  if (window.location.pathname === "/auth/github/callback") {
    if (serverBaseUrl === undefined) {
      return (
        <div className="login-root">
          <div className="login-card">
            <div className="login-brand"><div className="login-brand-mark">O</div><div><strong>OpenTestPilot</strong></div></div>
            <h1>{t("serverNotConfigured.title")}</h1>
            <p>{t("serverNotConfigured.body")}</p>
            <button className="login-github-button" onClick={() => { window.location.href = "/"; }}>{t("serverNotConfigured.back")}</button>
          </div>
        </div>
      );
    }
    return <CallbackPage serverBaseUrl={serverBaseUrl} onLogin={handleLogin} />;
  }
  if (serverBaseUrl === undefined) return <App />;
  if (session === undefined && config?.sessionToken === undefined && (authRequired || config?.organizationId === undefined)) return <LoginPage serverBaseUrl={serverBaseUrl} onLogin={handleLogin} />;
  const organizationId = config?.organizationId ?? session?.organizationId;
  if (organizationId === undefined && session !== undefined) return <OrganizationPage serverBaseUrl={serverBaseUrl} session={session} onSelect={handleOrganization} />;
  return <App sessionToken={session?.sessionToken ?? config?.sessionToken} login={session?.login} organizationId={organizationId} organizationName={session?.organizationName} serverBaseUrl={serverBaseUrl} onLogout={session === undefined ? undefined : handleLogout} />;
}

function RootWithLocale() {
  const localeApi = useLocaleState();
  return (
    <LocaleContext.Provider value={localeApi}>
      <Root />
    </LocaleContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<RootWithLocale />);
