/**
 * Light / dark / system theme. The preference lives in localStorage (never any document content);
 * the resolved theme lives on <html data-theme> and is the single source for all styling.
 */
export type ThemePreference = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "lx-theme";
const CHANGE = "lx-theme-change";

/** Runs in <head> before the first paint, so the page never flashes the wrong palette. Mirrors applyTheme(). */
export const THEME_SCRIPT = `(function(){var p;try{p=localStorage.getItem("${KEY}")}catch(e){}var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),t=d?"dark":"light",r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t})()`;

/** Holds the choice for this page when storage is unavailable (private modes, blocked site data). */
let fallback: ThemePreference | null = null;

export function readPreference(): ThemePreference {
  if (fallback) return fallback;
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === "system" ? (systemDark ? "dark" : "light") : preference;

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function applyTheme(preference: ThemePreference = readPreference()) {
  const theme = resolveTheme(preference, systemDark());
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function setPreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
    fallback = null;
  } catch {
    fallback = preference;
  }
  const run = () => {
    applyTheme(preference);
    window.dispatchEvent(new Event(CHANGE));
  };
  // One coordinated cross-fade of the whole page instead of per-element colour transitions.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && typeof document.startViewTransition === "function" && document.visibilityState === "visible") document.startViewTransition(run);
  else run();
}

/** Notifies on a new choice here, in another tab, or (while "system" is chosen) an OS change. */
export function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (readPreference() === "system") applyTheme("system");
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    applyTheme();
    onChange();
  };
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onSystem);
  };
}
