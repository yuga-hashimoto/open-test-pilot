import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Status = 'passed' | 'failed' | 'running';
interface Run { id: string; test: string; branch: string; duration: string; status: Status; time: string; }

const runs: Run[] = [
  { id: 'run-9f31', test: 'Checkout / guest payment', branch: 'main', duration: '01:42', status: 'passed', time: '2 min ago' },
  { id: 'run-9f2c', test: 'Account / sign in', branch: 'feat/auth-refresh', duration: '00:38', status: 'failed', time: '18 min ago' },
  { id: 'run-9f1a', test: 'Catalog / search filters', branch: 'main', duration: '00:54', status: 'passed', time: '42 min ago' },
  { id: 'run-9ee8', test: 'Account / sign in', branch: 'main', duration: '00:12', status: 'running', time: 'Now' },
];

const manifest = ['name: Account / sign in', 'type: web', 'baseUrl: https://staging.shop.test', 'steps:', '  - id: open-login', '    action: navigate', '    url: /login', '  - id: submit-login', '    action: click', '    target: getByRole(button, { name: "Sign in" })', '  - id: verify-home', '    action: expectVisible', '    target: getByText("Welcome back")'];

function Icon({ name }: { name: string }) { return <span className={`icon icon-${name}`} aria-hidden="true" />; }

function StatusPill({ status }: { status: Status }) { return <span className={`pill pill-${status}`}><span className="dot" />{status}</span>; }

function App() {
  const [active, setActive] = useState('Overview');
  const [selectedRun, setSelectedRun] = useState(runs[1]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const nav: Array<[string, string]> = [['Overview', 'grid'], ['Tests', 'layers'], ['Runs', 'activity'], ['Runners', 'server'], ['Schedules', 'clock']];
  const startRun = () => { setRunning(true); setTimeout(() => setRunning(false), 1800); };
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
      <header className="topbar"><div><div className="eyebrow">SHOPFRONT / {active.toUpperCase()}</div><h1>{active}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Search"><Icon name="search" /></button><button className="icon-button" aria-label="Notifications"><Icon name="bell" /><span className="notification-badge" /></button><button className="run-button" onClick={startRun} disabled={running}><Icon name="play" />{running ? 'Starting…' : 'Run test'}<span className="shortcut">⌘ ↵</span></button></div></header>
      {active === 'Overview' ? <>
        <section className="metric-grid"><Metric label="Pass rate" value="94.8%" change="+2.4%" tone="green" icon="check" /><Metric label="Runs this week" value="128" change="+18" tone="blue" icon="activity" /><Metric label="Median duration" value="01:08" change="−12s" tone="purple" icon="clock" /><Metric label="Flaky tests" value="4" change="−2" tone="orange" icon="spark" /></section>
        <section className="content-grid"><div className="panel runs-panel"><div className="panel-header"><div><h2>Recent runs</h2><p>Latest executions across your test suite</p></div><button className="text-button" onClick={() => setActive('Runs')}>View all <span>→</span></button></div><div className="run-table"><div className="table-head"><span>TEST</span><span>BRANCH</span><span>DURATION</span><span>STATUS</span><span>WHEN</span></div>{runs.map((run) => <button className={`run-row ${selectedRun?.id === run.id ? 'selected' : ''}`} key={run.id} onClick={() => setSelectedRun(run)}><span className="test-name"><span className={`run-icon ${run.status}`}><Icon name={run.status === 'passed' ? 'check' : run.status === 'failed' ? 'close' : 'play'} /></span><b>{run.test}</b></span><span className="branch"><Icon name="branch" />{run.branch}</span><span className="muted">{run.duration}</span><StatusPill status={run.status} /><span className="muted">{run.time}</span></button>)}</div></div><div className="panel activity-panel"><div className="panel-header"><div><h2>Activity</h2><p>Signals from your workspace</p></div><button className="more-button" aria-label="More activity">•••</button></div><Activity icon="spark" title="Test generated" body="Account / sign in" time="8m ago" /><Activity icon="branch" title="PR #184 opened" body="Improve checkout coverage" time="23m ago" /><Activity icon="shield" title="Runner updated" body="linux-chromium-02" time="1h ago" /></div></section>
        <section className="bottom-grid"><div className="panel editor-panel"><div className="panel-header"><div><h2>Test editor</h2><p>Source-first YAML manifest</p></div><button className="text-button" onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? 'Close editor' : 'Open editor'} <span>→</span></button></div><div className="editor-window"><div className="editor-tabs"><span className="active-tab">login.yaml</span><span>generated.spec.ts</span><span className="saved">● Saved</span></div><div className="code-area">{manifest.slice(0, editorOpen ? manifest.length : 8).map((line, i) => <div className="code-line" key={`${line}-${i}`}><span>{String(i + 1).padStart(2, '0')}</span><code className={line.includes(':') ? 'syntax-key' : ''}>{line}</code></div>)}</div></div></div><div className="panel evidence-panel"><div className="panel-header"><div><h2>Failure evidence</h2><p>{selectedRun?.id ?? 'run-9f2c'} · {selectedRun?.test ?? 'Account / sign in'}</p></div><span className="evidence-label"><Icon name="image" /> 6 artifacts</span></div><div className="evidence-image"><div className="browser-chrome"><span /><span /><span /><small>staging.shop.test/login</small></div><div className="mock-page"><div className="mock-logo">shop<span>front</span></div><div className="mock-form"><b>Welcome back</b><small>Sign in to continue</small><div className="mock-input" /><div className="mock-input short" /><div className="mock-error">Unable to sign in. Please try again.</div><div className="mock-button">Sign in</div></div></div><div className="evidence-overlay">Assertion failed · verify-home</div></div><div className="evidence-footer"><span><Icon name="clock" /> 00:38.2</span><span><Icon name="code" /> line 12</span><button className="text-button">Open report →</button></div></div></section>
      </> : <section className="panel empty-state"><div className="empty-icon"><Icon name="layers" /></div><h2>{active}</h2><p>The {active.toLowerCase()} workspace is connected to the same tenant-safe API. Select Overview for the live dashboard.</p><button className="run-button" onClick={() => setActive('Overview')}>Back to overview</button></section>}
      <footer><span>OpenTestPilot v0.1.0</span><span><span className="online-dot" /> All systems operational</span><span>Docs <span>↗</span></span></footer>
    </main>
  </div>;
}

function Metric({ label, value, change, tone, icon }: { label: string; value: string; change: string; tone: string; icon: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} /></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small className={tone === 'orange' ? 'negative' : ''}>{change} <em>vs last week</em></small></div><div className="sparkline"><i /><i /><i /><i /><i /><i /><i /></div></div>; }
function Activity({ icon, title, body, time }: { icon: string; title: string; body: string; time: string }) { return <div className="activity-item"><div className="activity-icon"><Icon name={icon} /></div><div><b>{title}</b><span>{body}</span></div><time>{time}</time></div>; }

createRoot(document.getElementById('root')!).render(<App />);
