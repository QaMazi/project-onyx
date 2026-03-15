import { createContext, useContext, useEffect, useMemo, useState } from "react";
import themes, { DEFAULT_THEME_ID } from "../data/themes";

const ThemeContext = createContext(null);

const THEME_STORAGE_KEY = "onyxSelectedTheme";

function getThemeById(themeId) {
  return themes.find((theme) => theme.id === themeId) || themes[0];
}

function getInitialThemeId() {
  return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_ID;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  const value = parseInt(full, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function ThemeProvider({ children }) {
  const [selectedThemeId, setSelectedThemeId] = useState(getInitialThemeId);

  const currentTheme = useMemo(() => {
    return getThemeById(selectedThemeId);
  }, [selectedThemeId]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, selectedThemeId);
  }, [selectedThemeId]);

  useEffect(() => {
    if (!currentTheme) return;

    const root = document.documentElement;
    const accentRgb = hexToRgb(currentTheme.accent);
    const accent2Rgb = hexToRgb(currentTheme.accent2);
    const accent3Rgb = hexToRgb(currentTheme.accent3);

    root.style.setProperty("--theme-accent", currentTheme.accent);
    root.style.setProperty("--theme-accent-2", currentTheme.accent2);
    root.style.setProperty("--theme-accent-3", currentTheme.accent3);

    root.style.setProperty(
      "--theme-accent-rgb",
      `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`
    );
    root.style.setProperty(
      "--theme-accent-2-rgb",
      `${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}`
    );
    root.style.setProperty(
      "--theme-accent-3-rgb",
      `${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}`
    );
  }, [currentTheme]);

  const value = useMemo(
    () => ({
      themes,
      currentTheme,
      selectedThemeId,
      setSelectedThemeId,
    }),
    [currentTheme, selectedThemeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}