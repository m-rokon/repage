import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadUrl,
  getJob,
  getOutput,
  startExtraction,
  type JobStatus,
  type OutputMode,
  type SerializerResult,
} from './api';
import CodePanel from './components/CodePanel';
import Preview from './components/Preview';

const PHASE_STEPS = [
  { key: 'fetching', label: 'Fetching page' },
  { key: 'extracting', label: 'Extracting DOM & CSS' },
  { key: 'cleaning', label: 'Cleaning & building IR' },
] as const;

type Tab = OutputMode | 'preview';

export default function App() {
  const [url, setUrl] = useState('');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('static');
  const [activeFile, setActiveFile] = useState(0);
  const [outputs, setOutputs] = useState<Partial<Record<OutputMode, SerializerResult>>>({});
  const [outputError, setOutputError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      setOutputs({});
      setOutputError(null);
      setJob(null);
      stopPolling();
      try {
        const { jobId } = await startExtraction(url);
        const poll = async () => {
          try {
            const status = await getJob(jobId);
            setJob(status);
            if (status.phase === 'done' || status.phase === 'error') stopPolling();
          } catch (err) {
            setSubmitError(err instanceof Error ? err.message : String(err));
            stopPolling();
          }
        };
        await poll();
        pollRef.current = window.setInterval(poll, 900);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    },
    [url],
  );

  useEffect(() => stopPolling, []);

  // lazily fetch serializer output when a mode tab becomes active
  useEffect(() => {
    if (!job || job.phase !== 'done' || activeTab === 'preview') return;
    if (outputs[activeTab]) return;
    setOutputError(null);
    getOutput(job.jobId, activeTab)
      .then((result) => setOutputs((prev) => ({ ...prev, [activeTab]: result })))
      .catch((err) => setOutputError(err instanceof Error ? err.message : String(err)));
  }, [job, activeTab, outputs]);

  useEffect(() => setActiveFile(0), [activeTab]);

  const busy =
    job !== null && job.phase !== 'done' && job.phase !== 'error';
  const current = activeTab !== 'preview' ? outputs[activeTab] : undefined;

  return (
    <div className="app">
      <header className="hero">
        <h1>
          <span className="logo">Repage</span>
        </h1>
        <p className="tagline">
          Paste a URL, get clean, copy-paste-ready code — rebuilt from the live page.
        </p>
        <p className="scope-note">
          Repage rebuilds the <em>rendered structure</em> of a single page: markup, styles and
          site-specific scripts. It does not recreate backends, forms-to-database wiring, auth or
          checkout flows — those come out as clearly marked TODOs. Only extract pages you have the
          rights to reuse.
        </p>
        <form className="url-form" onSubmit={submit}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !url.trim()}>
            {busy ? 'Working…' : 'Extract'}
          </button>
        </form>
        {submitError && <p className="error">{submitError}</p>}
      </header>

      {job && job.phase === 'error' && (
        <section className="panel error-panel">
          <h2>Extraction failed</h2>
          <p>{job.error}</p>
          <p className="muted">
            Sites behind aggressive anti-bot protection (e.g. Cloudflare challenges) can’t be
            extracted — that’s expected, not a bug.
          </p>
        </section>
      )}

      {busy && (
        <section className="panel">
          <ol className="progress">
            {PHASE_STEPS.map((step, i) => {
              const currentIdx = PHASE_STEPS.findIndex((s) => s.key === job?.phase);
              const state =
                currentIdx === -1
                  ? i === 0
                    ? 'active'
                    : 'pending'
                  : i < currentIdx
                    ? 'done'
                    : i === currentIdx
                      ? 'active'
                      : 'pending';
              return (
                <li key={step.key} className={`step ${state}`}>
                  <span className="dot" />
                  {step.label}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {job && job.phase === 'done' && (
        <section className="panel results">
          <div className="result-head">
            <h2>{job.title}</h2>
            <span className="muted">
              {job.stats && (
                <>
                  {(job.stats.cssBytes / 1024).toFixed(1)} KB CSS · {job.stats.scripts} scripts
                  {job.stats.renamedClasses > 0 && <> · {job.stats.renamedClasses} classes renamed</>}
                </>
              )}
            </span>
          </div>

          {job.warnings && job.warnings.length > 0 && (
            <details className="warnings">
              <summary>{job.warnings.length} note(s) from extraction</summary>
              <ul>
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <nav className="tabs">
            {(job.modes ?? []).map((m) => (
              <button
                key={m.mode}
                className={activeTab === m.mode ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(m.mode)}
              >
                {m.label}
              </button>
            ))}
            <button
              className={activeTab === 'preview' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('preview')}
            >
              Preview / fidelity check
            </button>
          </nav>

          {activeTab === 'preview' ? (
            <Preview jobId={job.jobId} originalUrl={job.url} />
          ) : outputError ? (
            <p className="error">{outputError}</p>
          ) : !current ? (
            <p className="muted loading-note">Generating {activeTab} output…</p>
          ) : (
            <div className="output">
              <p className="disclaimer">{current.disclaimer}</p>
              <div className="file-row">
                <div className="file-tabs">
                  {current.files.map((f, i) => (
                    <button
                      key={f.name}
                      className={i === activeFile ? 'file-tab active' : 'file-tab'}
                      onClick={() => setActiveFile(i)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                <a className="download" href={downloadUrl(job.jobId, current.mode)}>
                  ⬇ Download .zip
                </a>
              </div>
              {current.files[activeFile] && (
                <CodePanel
                  code={current.files[activeFile].content}
                  language={current.files[activeFile].language}
                />
              )}
            </div>
          )}
        </section>
      )}

      <footer>
        <p className="muted">
          Repage extracts pages at your request — make sure you have the rights to the content you
          extract. Output is a starting point, not a finished product.
        </p>
      </footer>
    </div>
  );
}
