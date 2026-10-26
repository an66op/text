export function safeReturnTo(value: string | null | undefined, fallback = '/account') {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    return fallback;
  }
  try {
    const url = new URL(value, 'https://gongming.local');
    if (url.origin !== 'https://gongming.local' || /^\/(login|register)(\/|$)/.test(url.pathname)) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export const loginPath = (returnTo: string) =>
  `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
