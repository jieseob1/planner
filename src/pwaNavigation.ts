// Server-owned routes must never fall back to the cached planner shell.
export const navigationFallbackDenylist = [/^\/api(?:\/|$|\?)/, /^\/idp(?:\/|$|\?)/, /^\/ops(?:\/|$|\?)/];
