// The repository's star count, fetched once per build (the deploy workflow
// rebuilds daily, so it stays current without any request from visitors).
// Returns null when GitHub is unreachable; the link then shows no count.
const REPO = 'gojargo/jargo';
let stars: Promise<number | null> | undefined;

export function githubStars(): Promise<number | null> {
  stars ??= (async () => {
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        console.warn(`github: stars unavailable (${res.status})`);
        return null;
      }
      const { stargazers_count } = await res.json();
      return typeof stargazers_count === 'number' ? stargazers_count : null;
    } catch (err) {
      console.warn(`github: stars unavailable (${(err as Error).message})`);
      return null;
    }
  })();
  return stars;
}

/** 109 → "109", 1234 → "1.2k", 12345 → "12k". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

export const githubUrl = `https://github.com/${REPO}`;
