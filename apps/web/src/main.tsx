import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createApi, getApiConfig, type ApiRun, type ApiSchedule, type ApiTest, type ApiTestManifest, type TestPilotApi } from './api.js';
import './style.css';

type Status = 'passed' | 'failed' | 'running';
interface Run { id: string; test: string; branch: string; duration: string; status: Status; time: string; }

const demoRuns: Run[] = [
  { id: 'run-9f31', test: 'Checkout / guest payment', branch: 'main', duration: '01:42', status: 'passed', time: '2 min ago' },
  { id: 'run-9f2c', test: 'Account / sign in', branch: 'feat/auth-refresh', duration: '00:38', status: 'failed', time: '18 min ago' },
  { id: 'run-9f1a', test: 'Catalog / search filters', branch: 'main', duration: '00:54', status: 'passed', time: '42 min ago' },
  { id: 'run-9ee8', test: 'Account / sign in', branch: 'main', duration: '00:12', status: 'running', time: 'Now' },
];

const manifest = ['name: Account / sign in', 'type: web', 'baseUrl: https://staging.shop.test', 'steps:', '  - id: open-login', '    action: navigate', '    url: /login', '  - id: submit-login', '    action: click', '    target: getByRole(button, { name: "Sign in" })', '  - id: verify-home', '    action: expectVisible', '    target: getByText("Welcome back")'];

function Icon({ name }: { name: string }) { return <span className={`icon icon-${name}`} aria-hidden="true" />; }

function StatusPill({ status }: { status: Status }) { return <span className={`pill pill-${status}`}><span className="dot" />{status}</span>; }

function App() {
  const api = useMemo<TestPilotApi | undefined>(() => { const config = getApiConfig(); return config === undefined ? undefined : createApi(config); }, []);
  const [active, setActive] = useState('Overview');
  const [runs, setRuns] = useState<Run[]>(demoRuns);
  const [tests, setTests] = useState<ApiTest[]>([]);
  const [schedules, setSchedules] = useState<ApiSchedule[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | undefined>(demoRuns[1] ?? demoRuns[0]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingTest, setEditingTest] = useState<ApiTest | undefined>();
  const [manifestText, setManifestText] = useState('');
  const [manifestStatus, setManifestStatus] = useState<string | undefined>();
  const [manifestLoading, setManifestLoading] = useState(false);
  const [connection, setConnection] = useState<'demo' | 'live' | 'error'>(api === undefined ? 'demo' : 'live');
  const nav: Array<[string, string]> = [['Overview', 'grid'], ['Tests', 'layers'], ['Runs', 'activity'], ['Runners', 'server'], ['Schedules', 'clock']];
  useEffect(() => {
    if (api === undefined) return;
    void Promise.all([api.listRuns(), api.listTests(), api.listSchedules()]).then(([runItems, testItems, scheduleItems]) => {
      setTests(testItems);
      setSchedules(scheduleItems);
      setRuns(runItems.map((run) => runForUi(run, testItems)));
      setConnection('live');
    }).catch(() => setConnection('error'));
  }, [api]);
  const startRun = (requestedTest?: ApiTest) => {
    setRunning(true);
    const config = getApiConfig();
    const test = requestedTest ?? tests.find((item) => item.id === config?.testId) ?? tests[0];
    const projectId = config?.projectId ?? test?.projectId;
    const testId = config?.testId ?? test?.id;
    if (api !== undefined && projectId !== undefined && testId !== undefined) {
      void api.startRun(projectId, testId).then((result) => {
        const run = runForUi({ id: result.runId, projectId, testId, status: result.status, createdAt: new Date().toISOString() }, tests);
        setRuns((current) => [run, ...current]);
        setSelectedRun(run);
      }).catch(() => setConnection('error')).finally(() => setRunning(false));
      return;
    }
    setTimeout(() => setRunning(false), 1800);
  };
  const openManifestEditor = (test: ApiTest) => {
    setEditingTest(test);
    setManifestStatus(undefined);
    setManifestLoading(api !== undefined);
    if (api === undefined) {
      setManifestText(stringifyYaml({ schemaVersion: '1.0.0', id: test.manifestId, name: test.name, steps: [] }));
      return;
    }
    void api.getManifest(test.id).then((value) => { setManifestText(stringifyYaml(value)); setManifestLoading(false); }).catch(() => { setManifestStatus('Manifest could not be loaded'); setManifestLoading(false); });
  };
  const saveManifest = () => {
    if (api === undefined || editingTest === undefined || manifestLoading) return;
    let parsed: ApiTestManifest;
    try { parsed = parseYaml(manifestText) as ApiTestManifest; } catch { setManifestStatus('YAML is invalid'); return; }
    void api.updateManifest(editingTest.id, parsed).then(() => setManifestStatus('Saved to team server')).catch(() => setManifestStatus('Save failed'));
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">O</div><div><strong>OpenTestPilot</strong><small>QA control plane</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="project-select"><span className="project-avatar">S</span><span><b>Shopfront</b><small>staging</small></span><Icon name="chevron" /></button>
      <nav>{nav.map(([label, icon]) => <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}><Icon name={icon} /><span>{label}</span>{label === 'Runs' && <em>12</em>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="runner-card"><div className="runner-card-head"><span className="online-dot" />Runner fleet</div><strong>3 <small>/ 4 online</small></strong><div className="runner-bar"><i /></div><span className="runner-caption">1 runner is warming up</span></div>
      <button className="nav-item"><Icon name="settings" /><span>Settings</span></button>
      <div className="profile"><div className="profile-avatar">YK</div><div><b>Yu-ga Kato</b><small>Owner</small></div><Icon name="more" /></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><div className="eyebrow">SHOPFRONT / {active.toUpperCase()}</div><h1>{active}</h1><span className={`connection-state ${connection}`}><span />{connection === 'live' ? 'Connected to team server' : connection === 'error' ? 'API connection failed' : 'Demo data'}</span></div><div className="top-actions"><button className="icon-button" aria-label="Search"><Icon name="search" /></button><button className="icon-button" aria-label="Notifications"><Icon name="bell" /><span className="notification-badge" /></button><button className="run-button" onClick={() => startRun()} disabled={running}><Icon name="play" />{running ? 'Starting…' : 'Run test'}<span className="shortcut">⌘ ↵</span></button></div></header>
      {active === 'Overview' ? <>
        <section className="metric-grid"><Metric label="Pass rate" value="94.8%" change="+2.4%" tone="green" icon="check" /><Metric label="Runs this week" value="128" change="+18" tone="blue" icon="activity" /><Metric label="Median duration" value="01:08" change="−12s" tone="purple" icon="clock" /><Metric label="Flaky tests" value="4" change="−2" tone="orange" icon="spark" /></section>
        <section className="content-grid"><div className="panel runs-panel"><div className="panel-header"><div><h2>Recent runs</h2><p>Latest executions across your test suite</p></div><button className="text-button" onClick={() => setActive('Runs')}>View all <span>→</span></button></div><div className="run-table"><div className="table-head"><span>TEST</span><span>BRANCH</span><span>DURATION</span><span>STATUS</span><span>WHEN</span></div>{runs.map((run) => <button className={`run-row ${selectedRun?.id === run.id ? 'selected' : ''}`} key={run.id} onClick={() => setSelectedRun(run)}><span className="test-name"><span className={`run-icon ${run.status}`}><Icon name={run.status === 'passed' ? 'check' : run.status === 'failed' ? 'close' : 'play'} /></span><b>{run.test}</b></span><span className="branch"><Icon name="branch" />{run.branch}</span><span className="muted">{run.duration}</span><StatusPill status={run.status} /><span className="muted">{run.time}</span></button>)}</div></div><div className="panel activity-panel"><div className="panel-header"><div><h2>Activity</h2><p>Signals from your workspace</p></div><button className="more-button" aria-label="More activity">•••</button></div><Activity icon="spark" title="Test generated" body="Account / sign in" time="8m ago" /><Activity icon="branch" title="PR #184 opened" body="Improve checkout coverage" time="23m ago" /><Activity icon="shield" title="Runner updated" body="linux-chromium-02" time="1h ago" /></div></section>
        <section className="bottom-grid"><div className="panel editor-panel"><div className="panel-header"><div><h2>Test editor</h2><p>Source-first YAML manifest</p></div><button className="text-button" onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? 'Close editor' : 'Open editor'} <span>→</span></button></div><div className="editor-window"><div className="editor-tabs"><span className="active-tab">login.yaml</span><span>generated.spec.ts</span><span className="saved">● Saved</span></div><div className="code-area">{manifest.slice(0, editorOpen ? manifest.length : 8).map((line, i) => <div className="code-line" key={`${line}-${i}`}><span>{String(i + 1).padStart(2, '0')}</span><code className={line.includes(':') ? 'syntax-key' : ''}>{line}</code></div>)}</div></div></div><div className="panel evidence-panel"><div className="panel-header"><div><h2>Failure evidence</h2><p>{selectedRun?.id ?? 'run-9f2c'} · {selectedRun?.test ?? 'Account / sign in'}</p></div><span className="evidence-label"><Icon name="image" /> 6 artifacts</span></div><div className="evidence-image"><div className="browser-chrome"><span /><span /><span /><small>staging.shop.test/login</small></div><div className="mock-page"><div className="mock-logo">shop<span>front</span></div><div className="mock-form"><b>Welcome back</b><small>Sign in to continue</small><div className="mock-input" /><div className="mock-input short" /><div className="mock-error">Unable to sign in. Please try again.</div><div className="mock-button">Sign in</div></div></div><div className="evidence-overlay">Assertion failed · verify-home</div></div><div className="evidence-footer"><span><Icon name="clock" /> 00:38.2</span><span><Icon name="code" /> line 12</span><button className="text-button">Open report →</button></div></div></section>
      </> : active === 'Tests' ? <TestsView tests={tests} onRun={startRun} live={api !== undefined} editingTest={editingTest} manifestText={manifestText} manifestStatus={manifestStatus} manifestLoading={manifestLoading} onEdit={openManifestEditor} onManifestChange={setManifestText} onSave={saveManifest} />
        : active === 'Runs' ? <RunsView runs={runs} selectedRun={selectedRun} onSelect={setSelectedRun} />
        : active === 'Schedules' ? <SchedulesView schedules={schedules} tests={tests} live={api !== undefined} />
        : <section className="panel empty-state"><div className="empty-icon"><Icon name={active === 'Runners' ? 'server' : 'layers'} /></div><h2>{active}</h2><p>{active === 'Runners' ? 'Runner registration and capability leasing are available through the tenant-safe API and runner CLI.' : `Connect a team server to load ${active.toLowerCase()} from the API.`}</p><button className="run-button" onClick={() => setActive('Overview')}>Back to overview</button></section>}
      <footer><span>OpenTestPilot v0.1.0</span><span><span className="online-dot" /> All systems operational</span><span>Docs <span>↗</span></span></footer>
    </main>
  </div>;
}

function Metric({ label, value, change, tone, icon }: { label: string; value: string; change: string; tone: string; icon: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} /></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small className={tone === 'orange' ? 'negative' : ''}>{change} <em>vs last week</em></small></div><div className="sparkline"><i /><i /><i /><i /><i /><i /><i /></div></div>; }
function Activity({ icon, title, body, time }: { icon: string; title: string; body: string; time: string }) { return <div className="activity-item"><div className="activity-icon"><Icon name={icon} /></div><div><b>{title}</b><span>{body}</span></div><time>{time}</time></div>; }

function TestsView({ tests, onRun, live, editingTest, manifestText, manifestStatus, manifestLoading, onEdit, onManifestChange, onSave }: { tests: ApiTest[]; onRun: (test: ApiTest) => void; live: boolean; editingTest: ApiTest | undefined; manifestText: string; manifestStatus: string | undefined; manifestLoading: boolean; onEdit: (test: ApiTest) => void; onManifestChange: (value: string) => void; onSave: () => void }) { return <div className="tests-layout"><section className="panel live-list"><div className="panel-header"><div><h2>Tests</h2><p>{live ? 'Tests loaded from the selected organization' : 'Connect a team server to load tests'}</p></div></div>{tests.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><Icon name="layers" /></div><p>No tests are registered for this organization yet.</p></div> : <div className="live-list-body">{tests.map((test) => <div className="live-list-row" key={test.id}><div><b>{test.name}</b><span>{test.manifestId} · {test.id}</span></div><div className="row-actions"><button className="text-button" onClick={() => onEdit(test)}>Edit</button><button className="text-button" onClick={() => onRun(test)}>Run →</button></div></div>)}</div>}</section>{editingTest !== undefined && <section className="panel manifest-editor"><div className="panel-header"><div><h2>{editingTest.name}</h2><p>Source-first Manifest editor · {manifestStatus ?? (manifestLoading ? 'loading…' : 'unsaved changes are local')}</p></div><button className="run-button" onClick={onSave} disabled={!live || manifestLoading}>Save</button></div><textarea aria-label="Manifest YAML" disabled={manifestLoading} value={manifestText} onChange={(event) => onManifestChange(event.target.value)} spellCheck={false} /></section>}</div>; }
function RunsView({ runs, selectedRun, onSelect }: { runs: Run[]; selectedRun: Run | undefined; onSelect: (run: Run) => void }) { return <section className="panel live-list"><div className="panel-header"><div><h2>Runs</h2><p>Execution records from the selected organization</p></div></div><div className="run-table"><div className="table-head"><span>TEST</span><span>BRANCH</span><span>DURATION</span><span>STATUS</span><span>WHEN</span></div>{runs.map((run) => <button className={`run-row ${selectedRun?.id === run.id ? 'selected' : ''}`} key={run.id} onClick={() => onSelect(run)}><span className="test-name"><span className={`run-icon ${run.status}`}><Icon name={run.status === 'passed' ? 'check' : run.status === 'failed' ? 'close' : 'play'} /></span><b>{run.test}</b></span><span className="branch"><Icon name="branch" />{run.branch}</span><span className="muted">{run.duration}</span><StatusPill status={run.status} /><span className="muted">{run.time}</span></button>)}</div></section>; }
function SchedulesView({ schedules, tests, live }: { schedules: ApiSchedule[]; tests: ApiTest[]; live: boolean }) { const testName = new Map(tests.map((test) => [test.id, test.name])); return <section className="panel live-list"><div className="panel-header"><div><h2>Schedules</h2><p>{live ? 'Schedules loaded from the selected organization' : 'Connect a team server to load schedules'}</p></div></div>{schedules.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><Icon name="clock" /></div><p>No schedules are configured for this organization.</p></div> : <div className="live-list-body">{schedules.map((schedule) => <div className="live-list-row" key={schedule.id}><div><b>{testName.get(schedule.testId) ?? schedule.testId}</b><span>{schedule.cron} · {schedule.enabled ? 'enabled' : 'disabled'}</span></div><span className="pill pill-running">{schedule.enabled ? 'active' : 'paused'}</span></div>)}</div>}</section>; }
function runForUi(run: ApiRun, tests: ApiTest[] = []): Run { return { id: run.id, test: tests.find((test) => test.id === run.testId)?.name ?? run.testId, branch: 'server', duration: run.startedAt === undefined || run.endedAt === undefined ? '—' : formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt)), status: run.status === 'queued' ? 'running' : run.status, time: relativeTime(run.createdAt) }; }
function formatDuration(milliseconds: number): string { if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'; const seconds = Math.round(milliseconds / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function relativeTime(value: string): string { const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000)); return seconds < 60 ? 'Now' : `${Math.floor(seconds / 60)}m ago`; }

createRoot(document.getElementById('root')!).render(<App />);
