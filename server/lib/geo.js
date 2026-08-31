// The visitor's country, from whatever the platform in front of us already knows.
//
// Every source here is a request header set by an edge that saw the connection.
// Nothing in this file reads, stores, forwards or logs an IP address, and no
// third-party geolocation service is called — which is the point. Sending a
// visitor's IP to an external lookup to fill in a tally would turn an aggregate
// counter into something that needs a purpose, a processor agreement and a
// retention window.
//
// The consequence is that a country is only known where a CDN supplies one.
// Running locally, or behind a plain reverse proxy, there is no country to be
// had and the store records 'ZZ' — the ISO code reserved for unknown. That is
// not a bug to be worked around; it is the absence of information.

// Checked in order. The first that looks like an ISO 3166-1 alpha-2 code wins.
const HEADERS = [
  "x-vercel-ip-country", // Vercel
  "cf-ipcountry", // Cloudflare
  "x-geo-country", // Fastly, and several proxies by convention
  "x-appengine-country", // Google App Engine
  "x-country-code", // Netlify and others
];

/**
 * A two-letter country code for this request, or "" when nothing supplied one.
 *
 * DEV_COUNTRY exists so the admin tally can be exercised without deploying:
 * it is read only when no edge header is present, so it can never override a
 * real visitor's country in production.
 */
export function visitorCountry(req) {
  for (const name of HEADERS) {
    const raw = req.headers[name];
    const value = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toUpperCase();
    // Cloudflare sends 'XX' for a client it cannot place, and 'T1' for Tor.
    if (/^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  const dev = String(process.env.DEV_COUNTRY ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(dev) ? dev : "";
}
