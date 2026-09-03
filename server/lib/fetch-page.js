// Fetches a page the caller names, for theme extraction.
//
// A URL supplied by a caller and fetched by this server is a server-side request
// forgery primitive: the process holds a Supabase service_role key and sits
// inside a hosting network with its own metadata endpoints. Everything below
// exists to make sure the only thing reachable is a public web page.
//
// The guards, and why each one is here:
//   - http and https only, so a URL cannot name file:, ftp: or a data: payload.
//     Plain http is allowed because plenty of sites still serve it, and the
//     address checks below are what actually keep internal hosts out of reach —
//     the scheme never was. What http costs is confidentiality and integrity in
//     transit: someone on the path sees which site was asked for and can replace
//     the response. The blast radius is a wrong set of colours, since nothing
//     here executes or stores the page.
//   - The hostname is resolved and every resulting address is checked before the
//     request is made. A name that resolves to 127.0.0.1, 169.254.169.254, or
//     anything in RFC1918 is refused; DNS is attacker-controlled, so the literal
//     text of a hostname proves nothing.
//   - Redirects are followed by hand, one hop at a time, and each hop is
//     re-resolved and re-checked. Following redirects automatically would let a
//     public host bounce the request to an internal one.
//   - A timeout and a byte cap, so a slow or endless response cannot hold a
//     serverless function open until it is killed.
//   - Only HTML is read. Anything else is refused before its body is consumed.
//
// This does not defeat a DNS rebind between the check and the connect. Closing
// that needs the socket's own peer address, which fetch does not expose; the
// hosting network's egress rules are the control for it.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HttpError } from "./http.js";

const TIMEOUT_MS = 6000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// Sent as a browser rather than as a named tool.
//
// This is a deliberate choice with a cost, so it is written down. Bot managers
// in front of large sites (Akamai, Cloudflare) refuse an unrecognised
// User-Agent outright: policybazaar.com answers 403 to a named tool and 200 to
// this string, for the same URL at the same moment. Presenting honestly meant
// the feature did not work on most of the sites it is for.
//
// What is NOT done to get through: robots.txt is still fetched and obeyed
// (robotsAllows below), so a site that asks not to be read automatically is
// still not read. No cookies are kept, no bot-manager challenge is solved, and
// one page is fetched per request. A site that wants to keep this out can do so
// through robots.txt, which is the mechanism meant for saying it.
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// robots.txt is requested under the tool's real name. The file is public and
// serving it is never gated, so nothing needs disguising to read it, and an
// operator reading their logs can see what actually asked.
const ROBOTS_USER_AGENT = "icon-genie-theme/1.0 (+https://github.com/shashi-hans/icon-genie)";

/** True for an address no caller has any business reaching through this server. */
function isBlockedAddress(ip) {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // IPv4-mapped (::ffff:10.0.0.1) carries a v4 address inside a v6 literal.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }

  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** Parse and check one URL, resolving its host. Throws HttpError on anything unsafe. */
async function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "Only http and https addresses can be read.");
  }
  // A bare IP is refused outright rather than range-checked: nobody reaches a
  // real site that way, and it removes a whole class of encoding tricks.
  if (isIP(url.hostname)) {
    throw new HttpError(400, "Enter a site's address, not an IP.");
  }

  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new HttpError(400, "That address could not be found.");
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new HttpError(400, "That address cannot be read from here.");
  }
  return url;
}

/** Read a response body up to the cap, without buffering more than that. */
async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a public HTML page, following redirects by hand so each hop is checked.
 * Returns the HTML text and the final URL it came from.
 */
export async function fetchPage(raw) {
  let url = await checkUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.error("theme fetch failed:", url.hostname, err.message);
      throw new HttpError(502, "That site did not respond.");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new HttpError(502, "That site returned a redirect with no target.");
      // Re-checked from scratch, including the DNS lookup: a public host is
      // allowed to redirect, but not to redirect us somewhere internal.
      url = await checkUrl(new URL(location, url).href);
      continue;
    }

    if (!res.ok) {
      // A bot manager refusing the request looks like this. Worth its own
      // message: nothing the caller changes about the URL will help, so the
      // answer is to use the manual colour field, not to try again.
      if (res.status === 403 || res.status === 401 || res.status === 429) {
        throw new HttpError(
          502,
          "That site blocks automated readers. Paste its colour below instead."
        );
      }
      throw new HttpError(502, `That site answered ${res.status}.`);
    }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("html")) {
      throw new HttpError(415, "That address is not a web page.");
    }
    return { html: await readCapped(res), url: url.href };
  }

  throw new HttpError(502, "That site redirected too many times.");
}

/**
 * One robots.txt rule value as a regex.
 *
 * The value is a path prefix in which `*` matches any run of characters and a
 * trailing `$` anchors the end. Both matter: `/*.php$` means "paths ending in
 * .php", and treating it as a plain prefix would read it as "everything", which
 * blocks a site that only meant to exclude its PHP files.
 */
function rulePattern(value) {
  const anchored = value.endsWith("$");
  const body = anchored ? value.slice(0, -1) : value;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/**
 * Whether robots.txt lets this fetcher read `path`. Fails open: a site with no
 * robots.txt, or one we cannot read, is treated as allowing it, which is what
 * the standard says.
 *
 * Allow and Disallow are both read, and the longest matching rule wins, with
 * Allow taking a tie — the usual precedence, so a site that excludes a section
 * but re-admits one page inside it is read correctly. This makes one request for
 * one page, so crawl-delay has nothing to pace.
 */
export async function robotsAllows(pageUrl, path = "/") {
  // Through the same guard fetchPage uses, and deliberately outside the try below
  // so a refusal propagates instead of being read as "no robots.txt, carry on".
  //
  // This used to call fetch() directly. Because the route asks about robots.txt
  // *before* it fetches the page, every check in this file — the bare-IP refusal,
  // the DNS lookup, the private-range block — was skipped for that one request.
  // Pointing the API at http://169.254.169.254 or any loopback address still
  // reached it: the answer was refused, but the request had already been made,
  // and whether robots.txt disallowed changed the error the caller saw.
  const url = await checkUrl(pageUrl);
  let text;
  try {
    const res = await fetch(new URL("/robots.txt", url.origin), {
      headers: { "user-agent": ROBOTS_USER_AGENT },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return true;
    text = (await res.text()).slice(0, 100_000);
  } catch {
    return true;
  }

  let inGroup = false;
  let best = null; // { length, allow }
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      // Only the wildcard group is honoured. A rule naming another crawler by
      // name is not about this fetcher.
      inGroup = value === "*";
      continue;
    }
    if (!inGroup || (key !== "allow" && key !== "disallow")) continue;
    // "Disallow:" with no value is the explicit "allow everything" form and
    // matches nothing.
    if (!value) continue;

    let matches;
    try {
      matches = rulePattern(value).test(path);
    } catch {
      continue; // a malformed rule is not a reason to refuse the whole site
    }
    if (!matches) continue;
    const allow = key === "allow";
    if (!best || value.length > best.length || (value.length === best.length && allow)) {
      best = { length: value.length, allow };
    }
  }
  return best ? best.allow : true;
}
