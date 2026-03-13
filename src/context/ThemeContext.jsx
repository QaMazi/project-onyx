import { createContext, useContext, useEffect, useMemo, useState } from "react";
import themes from "../data/themes";

const ThemeContext = createContext(null);

function getRandomTheme() {
  const index = Math.floor(Math.random() * themes.length);
  return themes[index];
}

function getInitialThemeMode() {
  return localStorage.getItem("themeMode") || "random";
}

function getInitialTheme(mode) {
  if (mode === "random") return getRandomTheme();

  const foundTheme = themes.find((theme) => theme.name === mode);
  return foundTheme || themes[0];
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(getInitialThemeMode);
  const [currentTheme, setCurrentTheme] = useState(() =>
    getInitialTheme(getInitialThemeMode())
  );

  useEffect(() => {
    localStorage.setItem("themeMode", themeMode);

    if (themeMode === "random") {
      setCurrentTheme(getRandomTheme());
      return;
    }

    const foundTheme = themes.find((theme) => theme.name === themeMode);
    if (foundTheme) setCurrentTheme(foundTheme);
  }, [themeMode]);

  /* push accent color to CSS */

  useEffect(() => {
    if (!currentTheme?.accent) return;

    document.documentElement.style.setProperty(
      "--theme-accent",
      currentTheme.accent
    );
  }, [currentTheme]);

  const value = useMemo(
    () => ({
      themes,
      themeMode,
      setThemeMode,
      currentTheme
    }),
    [themeMode, currentTheme]
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