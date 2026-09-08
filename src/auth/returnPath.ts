const appPaths = new Set(['/today', '/planner', '/goals', '/goals/legacy', '/review', '/review/legacy', '/settings', '/plans', '/admin', '/onboarding']);

/** OIDC state is not a license to redirect outside the application. */
export function safeAppReturnTo(candidate: unknown): string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return '/today';
  // Reject URL-normalization tricks, including encoded backslashes and control bytes.
  if (/[\\\u0000-\u0020\u007f]/.test(candidate) || /%(?:0[0-9a-f]|1[0-9a-f]|20|2f|5c|7f)/i.test(candidate)) return '/today';
  try {
    const url = new URL(candidate, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid' || !appPaths.has(url.pathname)) return '/today';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/today';
  }
}

export function oidcStateReturnTo(state: unknown, fallback = '/today'): string {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return safeAppReturnTo(fallback);
  return safeAppReturnTo(state.returnTo);
}

/** Notify BrowserRouter too: replaceState alone leaves its route at /auth/callback. */
export function replaceAuthLocation(target: string): void {
  window.history.replaceState(window.history.state, '', safeAppReturnTo(target));
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}
