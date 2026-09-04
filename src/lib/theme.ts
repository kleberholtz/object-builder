import { useSettingsStore } from "../stores/settings-store";

/**
 * `auto` leaves `data-theme` off, so the `prefers-color-scheme` block in `theme.css`
 * decides; picking light or dark pins the attribute, which is the escape hatch that
 * stylesheet already declares.
 */
export function initTheme() {
  const apply = () => {
    const { theme } = useSettingsStore.getState();
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  };
  apply();
  useSettingsStore.subscribe(apply);
}

/** Theme this computer asks for, used by the "auto" preference. */
export function detectTheme(): "light" | "dark" {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
