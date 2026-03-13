import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "./ThemeContext";

const AudioContext = createContext(null);

export function useAudio() {
  const context = useContext(AudioContext);

  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }

  return context;
}

function getInitialVolume() {
  const saved = localStorage.getItem("musicVolume");
  const parsed = saved !== null ? Number(saved) : 0.5;

  if (Number.isNaN(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function getInitialMuted() {
  return localStorage.getItem("musicMuted") === "true";
}

export function AudioProvider({ children }) {
  const { currentTheme } = useTheme();

  const audioRef = useRef(null);
  const unlockBoundRef = useRef(false);

  const [volume, setVolumeState] = useState(getInitialVolume);
  const [muted, setMuted] = useState(getInitialMuted);
  const [isReady, setIsReady] = useState(false);

  /* ---------- helpers ---------- */

  const applyVolume = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  const tryPlay = useCallback(async () => {
    if (!audioRef.current) return;

    try {
      await audioRef.current.play();
      setIsReady(true);
    } catch {
      setIsReady(false);
    }
  }, []);

  /* ---------- fade helpers ---------- */

  const fadeVolume = (audio, target, duration = 800) =>
    new Promise((resolve) => {
      const start = audio.volume;
      const diff = target - start;
      const startTime = performance.now();

      function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        audio.volume = start + diff * progress;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }

      requestAnimationFrame(step);
    });

  /* ---------- autoplay unlock ---------- */

  const bindUnlockListeners = useCallback(() => {
    if (unlockBoundRef.current) return;
    unlockBoundRef.current = true;

    const unlock = async () => {
      await tryPlay();

      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);

      unlockBoundRef.current = false;
    };

    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("pointerdown", unlock, { once: true });
  }, [tryPlay]);

  /* ---------- create audio instance ---------- */

  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";

    audioRef.current = audio;
    applyVolume();

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [applyVolume]);

  /* ---------- volume persistence ---------- */

  useEffect(() => {
    localStorage.setItem("musicVolume", String(volume));
    applyVolume();
  }, [volume, applyVolume]);

  useEffect(() => {
    localStorage.setItem("musicMuted", String(muted));
    applyVolume();
  }, [muted, applyVolume]);

  /* ---------- theme music change ---------- */

  useEffect(() => {
    if (!audioRef.current || !currentTheme?.music) return;

    const audio = audioRef.current;
    const nextSrc = new URL(currentTheme.music, window.location.origin).href;

    if (audio.src === nextSrc) {
      applyVolume();
      tryPlay().catch(() => {});
      return;
    }

    const switchTrack = async () => {
      /* fade out old track */

      if (!audio.paused) {
        await fadeVolume(audio, 0, 600);
      }

      audio.pause();

      /* switch source */

      audio.src = currentTheme.music;
      audio.load();

      /* start silent */

      audio.volume = 0;

      await tryPlay();

      /* fade in */

      const target = muted ? 0 : volume;
      await fadeVolume(audio, target, 1000);
    };

    switchTrack();

    bindUnlockListeners();
  }, [currentTheme, volume, muted, applyVolume, tryPlay, bindUnlockListeners]);

  /* ---------- API ---------- */

  const setVolume = useCallback((nextValue) => {
    const safeValue = Math.min(1, Math.max(0, Number(nextValue) || 0));
    setVolumeState(safeValue);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({
      volume,
      setVolume,
      muted,
      setMuted,
      toggleMuted,
      isReady,
    }),
    [volume, setVolume, muted, toggleMuted, isReady]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}