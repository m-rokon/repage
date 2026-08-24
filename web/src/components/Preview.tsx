import { previewUrl } from '../api';

/**
 * Fidelity diff (plan §4.5): original page beside the rebuilt static output,
 * so users can sanity-check before copying code.
 */
export default function Preview({ jobId, originalUrl }: { jobId: string; originalUrl: string }) {
  return (
    <div className="preview-wrap">
      <p className="preview-note">
        Left: the original live page. Right: Repage’s extracted static rebuild (no JavaScript).
        Some sites refuse to load in iframes — if the left pane is blank, open the original in a
        new tab instead.
      </p>
      <div className="preview-grid">
        <div className="preview-pane">
          <div className="preview-label">
            Original{' '}
            <a href={originalUrl} target="_blank" rel="noreferrer">
              open ↗
            </a>
          </div>
          <iframe src={originalUrl} title="Original page" sandbox="allow-scripts allow-same-origin" />
        </div>
        <div className="preview-pane">
          <div className="preview-label">
            Repage rebuild{' '}
            <a href={previewUrl(jobId)} target="_blank" rel="noreferrer">
              open ↗
            </a>
          </div>
          <iframe src={previewUrl(jobId)} title="Extracted rebuild" sandbox="" />
        </div>
      </div>
    </div>
  );
}
