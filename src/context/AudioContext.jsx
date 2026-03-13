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

function clampVolume(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function getInitialVolume() {
  const saved = localStorage.getItem("musicVolume");
  return clampVolume(saved ?? 0.5);
}

function getInitialMuted() {
  return localStorage.getItem("musicMuted") === "true";
}

export function AudioProvider({ children }) {
  const { currentTheme } = useTheme();

  const audioRef = useRef(null);
  const unlockBoundRef = useRef(false);

  const [volume, setVolumeState] = useState(getInitialVolume);
  const [muted, setMutedState] = useState(getInitialMuted);
  const [isReady, setIsReady] = useState(false);

  const getTargetVolume = useCallback(() => {
    return muted ? 0 : clampVolume(volume);
  }, [muted, volume]);

  const applyVolume = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = clampVolume(getTargetVolume());
  }, [getTargetVolume]);

  const tryPlay = useCallback(async () => {
    if (!audioRef.current) return false;

    try {
      await audioRef.current.play();
      setIsReady(true);
      return true;
    } catch {
      setIsReady(false);
      return false;
    }
  }, []);

  const fadeVolume = useCallback((audio, target, duration = 800) => {
    const safeTarget = clampVolume(target);

    return new Promise((resolve) => {
      const start = clampVolume(audio.volume);
      const diff = safeTarget - start;
      const startTime = performance.now();

      function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        audio.volume = clampVolume(start + diff * progress);

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }

      requestAnimationFrame(step);
    });
  }, []);

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

  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = clampVolume(getTargetVolume());

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [getTargetVolume]);

  useEffect(() => {
    localStorage.setItem("musicVolume", String(clampVolume(volume)));
    applyVolume();
  }, [volume, applyVolume]);

  useEffect(() => {
    localStorage.setItem("musicMuted", String(muted));
    applyVolume();
  }, [muted, applyVolume]);

  useEffect(() => {
    if (!audioRef.current || !currentTheme?.music) return;

    const audio = audioRef.current;
    const nextSrc = new URL(currentTheme.music, window.location.origin).href;

    if (audio.src === nextSrc) {
      applyVolume();
      tryPlay();
      bindUnlockListeners();
      return;
    }

    const switchTrack = async () => {
      if (!audio.paused) {
        await fadeVolume(audio, 0, 600);
      }

      audio.pause();
      audio.src = nextSrc;
      audio.load();
      audio.volume = 0;

      const played = await tryPlay();

      if (!played) {
        bindUnlockListeners();
        return;
      }

      await fadeVolume(audio, getTargetVolume(), 1000);
    };

    switchTrack();
  }, [
    currentTheme,
    applyVolume,
    tryPlay,
    bindUnlockListeners,
    fadeVolume,
    getTargetVolume,
  ]);

  const setVolume = useCallback((nextValue) => {
    setVolumeState(clampVolume(nextValue));
  }, []);

  const setMuted = useCallback((nextValue) => {
    if (typeof nextValue === "boolean") {
      setMutedState(nextValue);
      return;
    }

    setMutedState((prev) => !prev);
  }, []);

  const toggleMuted = useCallback(() => {
    setMutedState((prev) => !prev);
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
    [volume, setVolume, muted, setMuted, toggleMuted, isReady]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}