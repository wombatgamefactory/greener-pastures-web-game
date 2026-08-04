/**
 * The capture transport: a file, downloaded by the browser.
 *
 * Ticket 31 weighed three options and settled on this one. The alternative that
 * lost was a dev-server endpoint writing straight into a gitignored folder,
 * which is smoother locally - but it only exists under `npm run dev`, and the
 * live Pages build is where a publisher demo and most real solo playtesting
 * will happen. A button that quietly does nothing on the deployed game is worse
 * than one that costs a drag out of Downloads.
 *
 * So: no server code, no endpoint, identical behaviour in dev, in `preview` and
 * on Pages. Where the file then lives is a human decision, which is why the
 * replay CLI takes a path rather than assuming one.
 */

/** Pretty-printed on purpose: a capture is meant to be read and diffed. */
export function toJsonBlob(value: unknown): Blob {
  return new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
}

/**
 * Save `value` as `filename`.
 *
 * The object URL is revoked on the next frame rather than immediately: revoking
 * synchronously after `click()` races the download in some browsers, and a
 * capture that silently fails to save is the one failure mode this whole ticket
 * exists to avoid.
 */
export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(toJsonBlob(value));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
