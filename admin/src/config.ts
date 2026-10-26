export const frontendUrl =
  import.meta.env.VITE_FRONTEND_URL ||
  (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5173` : '/');
