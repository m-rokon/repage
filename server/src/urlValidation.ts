/**
 * Basic abuse/SSRF prevention (plan §4.6): only public http(s) URLs.
 * String-level checks — not a substitute for network-level isolation in
 * production, where the Playwright runner should live in a sandboxed container.
 */

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local / cloud metadata
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 ULA
  /^\[?fe80:/i, // IPv6 link-local
  /\.local$/i,
  /\.internal$/i,
];

export function validateTargetUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter a URL.' };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs with embedded credentials are not supported.' };
  }
  const host = parsed.hostname;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, error: 'Local and private-network addresses cannot be extracted.' };
  }
  if (!host.includes('.') && !host.startsWith('[')) {
    return { ok: false, error: 'Enter a full public hostname (e.g. example.com).' };
  }
  return { ok: true, url: parsed.href };
}
