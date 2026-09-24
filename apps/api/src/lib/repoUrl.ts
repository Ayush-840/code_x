import { HttpError } from "../middleware/errors";

/**
 * Parse a GitHub repository URL into `{ owner, repo }`.
 *
 * Accepts the common shapes users paste:
 *   https://github.com/owner/repo
 *   https://www.github.com/owner/repo/
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main   (branch sub-paths ignored)
 *   git@github.com:owner/repo.git
 *
 * Repo names may contain dots (mrdoob/three.js, vercel/next.js) — the repo
 * segment must not stop at the first dot; a *trailing* `.git` suffix is the
 * only dot sequence that gets stripped.
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = String(url ?? "")
    .trim()
    .match(/github\.com[/:]([^/\s#?]+)\/([^/\s#?]+)/);
  if (!match) {
    throw new HttpError(
      400,
      "INVALID_GITHUB_URL",
      "Provided URL is not a valid GitHub repository URL"
    );
  }
  let repo = match[2];
  if (repo.toLowerCase().endsWith(".git")) {
    repo = repo.slice(0, -4);
  }
  return { owner: match[1], repo };
}
