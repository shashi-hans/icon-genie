// The one way any page talks to this site's API, plus the toast it uses to say
// what happened.
//
// Same-origin with credentials, because the session and guest cookies are the
// point: the server decides who you are, and a role decided in the browser is a
// role the browser can change.

/**
 * Call the API and return its JSON. Throws an Error carrying the server's own
 * message, so callers can show it verbatim rather than inventing one.
 */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer = null;

/** Brief confirmation at the bottom of the page. Creates its own node if needed. */
export function showToast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

/** Hand the browser a file to save. */
export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next turn of the event loop: doing it synchronously can
  // cancel the download in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
