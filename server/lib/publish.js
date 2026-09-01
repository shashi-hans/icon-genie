// Publishing an approved icon: getting its centerline file to where the build
// picks it up, at raw-svgs/<name>/<name>.centerline.svg.
//
// That path is the package's source of truth. `npm run build:icons` turns it
// into src/icons/<Component>.tsx and adds the export, and `prepublishOnly` runs
// the same build, so a file committed here ships with the next release.
//
// Two strategies, because "write the file" means different things per
// environment:
//
//   local   the working tree is writable (a developer running `npm run dev`),
//           so the file is written straight into raw-svgs/. Immediate, and the
//           next build includes it.
//   github  a deployed function cannot persist a file — the filesystem is
//           read-only apart from /tmp and is rebuilt on every deploy — so the
//           file is committed to the repo over the GitHub API instead.
//
// Approval is the only gate. Neither strategy opens a pull request: the admin
// has already reviewed the icon, and a second merge step would strand approved
// icons in a queue.
//
// Neither runs `build:icons`: it optimizes 9k SVGs and rewrites src/, which is
// far too much to do inside a request. Committing the source file is the durable
// step; the build happens on the next deploy or release.
import { mkdir, writeFile, access, rm, rmdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toCenterlineSvg } from "./validate.js";
import { SOURCE_WEIGHTS } from "./icons.js";
import "./env.js";

// server/lib -> server -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo-relative path of an icon's source file. */
function iconFilePath(name) {
  return `raw-svgs/${name}/${name}.centerline.svg`;
}

async function treeIsWritable() {
  try {
    await access(join(ROOT, "raw-svgs"), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const WEIGHT_FILE_RE = new RegExp(`-(${SOURCE_WEIGHTS.join("|")})\\.svg$`);

/**
 * True when raw-svgs/<name>/ holds a hand-drawn six-weight set.
 *
 * Those directories are the package's built artwork. A contribution that happens
 * to share a name must neither write into one — the build reads a centerline
 * file in preference to the weight files, so it would replace the shipped icon —
 * nor delete one. The submission API rejects such a name up front; this is the
 * check at the point where files are actually touched.
 */
async function holdsBuiltArtwork(name) {
  try {
    const entries = await readdir(join(ROOT, "raw-svgs", name));
    return entries.some((file) => WEIGHT_FILE_RE.test(file));
  } catch {
    return false; // no such directory, so nothing built under this name
  }
}

/** Write the icon into the local working tree. */
async function publishLocal(name, paths) {
  const rel = iconFilePath(name);
  if (await holdsBuiltArtwork(name)) {
    throw new Error(`raw-svgs/${name}/ holds a built icon; refusing to write over it.`);
  }
  const abs = join(ROOT, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, toCenterlineSvg(paths), "utf8");
  return {
    mode: "local",
    filePath: rel,
    url: null,
    detail: "Written to the working tree. Run `npm run build:icons` to generate the component.",
  };
}

// --- GitHub -----------------------------------------------------------------

async function gh(method, apiPath, body) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "icon-genie-admin",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The status rides on the error rather than only in its text, so a caller can
    // tell "no such file" from a fault without reading the message for digits an
    // icon name could just as well supply.
    const err = new Error(`GitHub ${method} ${apiPath} -> ${res.status}: ${data.message || "error"}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Commit the icon straight onto the base branch. There is no pull request step:
 * the admin's approval IS the review, so requiring a second merge would leave
 * approved icons sitting in a queue nobody is watching.
 *
 * The tradeoff is explicit — nobody reviews the diff, only the drawing. It is
 * contained by what this can write: one generated file, at a path derived from a
 * kebab-cased name, holding path data the server already validated.
 */
async function publishToGitHub(name, paths, contributor) {
  const repo = process.env.GH_REPO || "shashi-hans/icon-genie";
  const base = process.env.GH_BASE || "main";
  const rel = iconFilePath(name);
  const content = Buffer.from(toCenterlineSvg(paths), "utf8").toString("base64");
  const credit = contributor && contributor !== "Anonymous" ? contributor : "an anonymous contributor";

  await gh("PUT", `/repos/${repo}/contents/${encodeURI(rel)}`, {
    message:
      `feat(icons): add ${name}\n\n` +
      `Community-contributed icon, approved in the review queue.\n` +
      `Contributed by ${credit}.`,
    content,
    branch: base,
  });

  return {
    mode: "github-commit",
    filePath: rel,
    url: `https://github.com/${repo}/blob/${base}/${rel}`,
    detail: `Committed to ${base}. It ships with the next build.`,
  };
}

/**
 * Remove the icon's source file from the local working tree.
 *
 * Only that one file: the directory may hold a built six-weight set, and
 * deleting the directory would take the shipped artwork with it.
 */
async function unpublishLocal(name) {
  const rel = iconFilePath(name);
  const abs = join(ROOT, rel);
  if (await holdsBuiltArtwork(name)) {
    return {
      mode: "none",
      filePath: rel,
      url: null,
      detail: `raw-svgs/${name}/ holds a built icon; its files were left in place.`,
    };
  }
  await rm(abs, { force: true });
  // The directory existed only to hold that file, so take it too — but with
  // rmdir, which refuses a directory that still has something in it.
  await rmdir(dirname(abs)).catch(() => {});
  return {
    mode: "local",
    filePath: rel,
    url: null,
    detail: "Source file removed. Run `npm run build:icons` to drop the component.",
  };
}

/** Delete the icon's source file from the repo. Requires its current blob sha. */
async function unpublishFromGitHub(name) {
  const repo = process.env.GH_REPO || "shashi-hans/icon-genie";
  const base = process.env.GH_BASE || "main";
  const rel = iconFilePath(name);
  const current = await gh("GET", `/repos/${repo}/contents/${encodeURI(rel)}?ref=${encodeURIComponent(base)}`);
  await gh("DELETE", `/repos/${repo}/contents/${encodeURI(rel)}`, {
    message: `feat(icons): remove ${name}\n\nRemoved from the gallery by an admin.`,
    sha: current.sha,
    branch: base,
  });
  return {
    mode: "github-commit",
    filePath: rel,
    url: null,
    detail: `Removed from ${base}. It leaves the package on the next build.`,
  };
}

/**
 * Undo publishing: take the icon's source file back out, mirroring publishIcon.
 * Like it, never throws — the record is already gone by the time this runs, so a
 * failure here needs reporting rather than a half-rolled-back delete.
 */
export async function unpublishIcon({ name }) {
  try {
    if (await treeIsWritable()) return await unpublishLocal(name);
    if (process.env.GITHUB_TOKEN) return await unpublishFromGitHub(name);
    return {
      mode: "none",
      filePath: iconFilePath(name),
      url: null,
      detail: "Removed from the gallery. The source file, if any, was left in place.",
    };
  } catch (err) {
    // A 404 means there was nothing published, which is a normal outcome for an
    // icon deleted before it was ever approved.
    const missing = err.status === 404;
    return {
      mode: missing ? "none" : "failed",
      filePath: iconFilePath(name),
      url: null,
      detail: missing
        ? "Removed from the gallery. No published source file to remove."
        : `Removed from the gallery, but the source file could not be deleted: ${err.message}`,
      error: missing ? undefined : err.message,
    };
  }
}

/**
 * Publish an approved icon, choosing the strategy that can actually persist.
 *
 * Never throws: a publishing failure must not undo an approval the admin already
 * made, so the outcome is returned either way and the caller reports it.
 */
export async function publishIcon({ name, paths, contributor }) {
  try {
    if (await treeIsWritable()) return await publishLocal(name, paths);
    if (process.env.GITHUB_TOKEN) return await publishToGitHub(name, paths, contributor);
    return {
      mode: "none",
      filePath: iconFilePath(name),
      url: null,
      detail:
        "Not written anywhere: the working tree is read-only and GITHUB_TOKEN is unset. " +
        "The icon is live in the gallery; download its source to add it to the package by hand.",
      error: "no writable target",
    };
  } catch (err) {
    return {
      mode: "failed",
      filePath: iconFilePath(name),
      url: null,
      detail: `Approved, but publishing failed: ${err.message}`,
      error: err.message,
    };
  }
}
