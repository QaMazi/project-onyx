import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import themes, { DEFAULT_THEME_ID } from "../data/themes.js";
import { getThemePremiumCode } from "../data/premiumCatalog.js";
import { usePremium } from "./PremiumContext";

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

function setThemeCssVariables(root, theme) {
  const accentRgb = hexToRgb(theme.accent);
  const accent2Rgb = hexToRgb(theme.accent2);
  const accent3Rgb = hexToRgb(theme.accent3);

  root.style.setProperty("--theme-accent", theme.accent);
  root.style.setProperty("--theme-accent-2", theme.accent2);
  root.style.setProperty("--theme-accent-3", theme.accent3);

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

  /* Shared launcher/panel theme variables.
     These are additive only and let future pages inherit the same accent logic
     without each page inventing its own theme math. */
  root.style.setProperty(
    "--onyx-accent-soft-rgb",
    `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`
  );
  root.style.setProperty(
    "--onyx-accent-soft",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.12)`
  );
  root.style.setProperty(
    "--onyx-accent-soft-2",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.18)`
  );
  root.style.setProperty(
    "--onyx-accent-border",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.28)`
  );
  root.style.setProperty(
    "--onyx-accent-border-strong",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.42)`
  );
  root.style.setProperty(
    "--onyx-accent-glow-soft",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16)`
  );
  root.style.setProperty(
    "--onyx-accent-glow",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.26)`
  );
  root.style.setProperty(
    "--onyx-accent-glow-strong",
    `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.4)`
  );
  root.style.setProperty(
    "--onyx-accent-secondary-soft",
    `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.14)`
  );
  root.style.setProperty(
    "--onyx-accent-secondary-border",
    `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.32)`
  );
  root.style.setProperty(
    "--onyx-accent-secondary-glow",
    `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.22)`
  );
  root.style.setProperty(
    "--onyx-accent-tertiary-soft",
    `rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.16)`
  );
  root.style.setProperty(
    "--onyx-accent-tertiary-border",
    `rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.28)`
  );
  root.style.setProperty(
    "--onyx-accent-tertiary-glow",
    `rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.22)`
  );
  root.style.setProperty(
    "--onyx-accent-spectrum",
    `linear-gradient(135deg, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.92) 0%, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.88) 48%, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.9) 100%)`
  );
  root.style.setProperty(
    "--onyx-title-gradient",
    `linear-gradient(90deg, ${theme.accent2} 0%, #ffffff 42%, ${theme.accent} 76%, ${theme.accent2} 100%)`
  );
  root.style.setProperty(
    "--onyx-title-shadow",
    `0 3px 18px rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.28), 0 0 22px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16)`
  );
  root.style.setProperty(
    "--onyx-surface-raised",
    `linear-gradient(180deg, rgba(8, 11, 16, 0.9), rgba(3, 5, 8, 0.97)), linear-gradient(135deg, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.18), transparent 42%), radial-gradient(circle at top left, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16) 0%, transparent 46%), radial-gradient(circle at top right, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.12) 0%, transparent 38%)`
  );
  root.style.setProperty(
    "--onyx-surface-soft",
    `linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.022)), linear-gradient(135deg, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.12), transparent 52%), radial-gradient(circle at top left, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.12) 0%, transparent 58%), radial-gradient(circle at bottom right, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.1) 0%, transparent 44%)`
  );
  root.style.setProperty(
    "--onyx-surface-accent",
    `linear-gradient(135deg, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.24) 0%, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.18) 44%, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.28) 100%), linear-gradient(180deg, rgba(9, 12, 18, 0.94), rgba(2, 4, 8, 0.98))`
  );
  root.style.setProperty(
    "--onyx-input-bg",
    `linear-gradient(180deg, rgba(7, 10, 15, 0.94), rgba(12, 16, 22, 0.96)), linear-gradient(135deg, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.1), transparent 58%), radial-gradient(circle at top right, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.08), transparent 36%)`
  );
  root.style.setProperty(
    "--onyx-button-primary-bg",
    `linear-gradient(135deg, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.96) 0%, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.92) 48%, rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.9) 100%)`
  );
  root.style.setProperty(
    "--onyx-button-secondary-bg",
    `linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03)), linear-gradient(135deg, rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.12), rgba(${accent3Rgb.r}, ${accent3Rgb.g}, ${accent3Rgb.b}, 0.14))`
  );
  root.style.setProperty(
    "--onyx-focus-ring",
    `0 0 0 3px rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.16)`
  );
  root.style.setProperty(
    "--onyx-panel-shadow",
    `0 22px 60px rgba(0, 0, 0, 0.42), 0 0 30px rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.04)`
  );
  root.style.setProperty(
    "--onyx-panel-shadow-hover",
    `0 18px 46px rgba(0, 0, 0, 0.56), 0 0 28px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16), 0 0 34px rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, 0.12)`
  );
  root.style.setProperty(
    "--onyx-text-accent",
    `color-mix(in srgb, ${theme.accent2} 78%, white)`
  );
}

export function ThemeProvider({ children }) {
  const { catalogByCode, equippedBySlot, equipItem } = usePremium();
  const [selectedThemeId, setSelectedThemeIdState] = useState(getInitialThemeId);

  const currentTheme = useMemo(() => {
    return getThemeById(selectedThemeId);
  }, [selectedThemeId]);

  useEffect(() => {
    const equippedThemeId = equippedBySlot?.theme?.metadata?.themeId;

    if (equippedThemeId) {
      setSelectedThemeIdState(equippedThemeId);
    } else if (!selectedThemeId || !isThemeOwned(selectedThemeId)) {
      setSelectedThemeIdState(DEFAULT_THEME_ID);
    }
  }, [equippedBySlot, selectedThemeId, catalogByCode]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, selectedThemeId);
  }, [selectedThemeId]);

  useEffect(() => {
    if (!currentTheme) return;

    const root = document.documentElement;
    setThemeCssVariables(root, currentTheme);
  }, [currentTheme]);

  const selectPremiumTheme = useCallback(
    async (themeId) => {
      const premiumItem = catalogByCode.get(getThemePremiumCode(themeId));

      if (themeId === DEFAULT_THEME_ID) {
        setSelectedThemeIdState(themeId);
        if (premiumItem?.is_owned) {
          await equipItem(premiumItem.id);
        }
        return;
      }

      if (!premiumItem?.is_owned) {
        throw new Error("Theme is locked. Purchase it in Premium Store first.");
      }

      await equipItem(premiumItem.id);
      setSelectedThemeIdState(themeId);
    },
    [catalogByCode, equipItem]
  );

  const isThemeOwned = useCallback(
    (themeId) => {
      if (themeId === DEFAULT_THEME_ID) return true;
      return Boolean(catalogByCode.get(getThemePremiumCode(themeId))?.is_owned);
    },
    [catalogByCode]
  );

  const value = useMemo(
    () => ({
      themes,
      currentTheme,
      selectedThemeId,
      setSelectedThemeId: selectPremiumTheme,
      isThemeOwned,
    }),
    [currentTheme, selectedThemeId, selectPremiumTheme, isThemeOwned]
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
