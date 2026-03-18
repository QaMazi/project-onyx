import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import audioTracks, { DEFAULT_TRACK_ID } from "../data/audioTracks.js";
import { getMusicPremiumCode } from "../data/premiumCatalog.js";
import { usePremium } from "./PremiumContext";

const AudioContext = createContext(null);

const TRACK_STORAGE_KEY = "onyxSelectedTrack";
const VOLUME_STORAGE_KEY = "musicVolume";
const MUTED_STORAGE_KEY = "musicMuted";

const tracks = audioTracks;

function getTrackById(trackId) {
  return tracks.find((track) => track.id === trackId) || tracks[0];
}

function clampVolume(value) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) return 0.5;

  return Math.min(1, Math.max(0, parsed));
}

function getInitialVolume() {
  const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
  return clampVolume(saved ?? 0.5);
}

function getInitialMuted() {
  return localStorage.getItem(MUTED_STORAGE_KEY) === "true";
}

function getInitialTrackId() {
  return localStorage.getItem(TRACK_STORAGE_KEY) || DEFAULT_TRACK_ID;
}

export function AudioProvider({ children }) {
  const { catalogByCode, equippedBySlot, equipItem } = usePremium();
  const audioRef = useRef(null);
  const unlockBoundRef = useRef(false);

  const [selectedTrackId, setSelectedTrackIdState] = useState(getInitialTrackId);
  const [volume, setVolumeState] = useState(getInitialVolume);
  const [muted, setMutedState] = useState(getInitialMuted);
  const [isReady, setIsReady] = useState(false);

  const currentTrack = useMemo(() => getTrackById(selectedTrackId), [selectedTrackId]);

  useEffect(() => {
    const equippedTrackId = equippedBySlot?.music_track?.metadata?.trackId;

    if (equippedTrackId) {
      setSelectedTrackIdState(equippedTrackId);
    } else if (!isTrackOwned(selectedTrackId)) {
      setSelectedTrackIdState(DEFAULT_TRACK_ID);
    }
  }, [equippedBySlot, selectedTrackId, catalogByCode]);

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
    localStorage.setItem(TRACK_STORAGE_KEY, selectedTrackId);
  }, [selectedTrackId]);

  useEffect(() => {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(clampVolume(volume)));
    applyVolume();
  }, [volume, applyVolume]);

  useEffect(() => {
    localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
    applyVolume();
  }, [muted, applyVolume]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack?.file) return;

    const audio = audioRef.current;
    const nextSrc = new URL(currentTrack.file, window.location.origin).href;

    if (audio.src === nextSrc) {
      applyVolume();
      tryPlay();
      bindUnlockListeners();
      return;
    }

    const switchTrack = async () => {
      if (!audio.paused) {
        await fadeVolume(audio, 0, 500);
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

      await fadeVolume(audio, getTargetVolume(), 900);
    };

    switchTrack();
  }, [
    currentTrack,
    applyVolume,
    tryPlay,
    bindUnlockListeners,
    fadeVolume,
    getTargetVolume,
  ]);

  const setSelectedTrackId = useCallback((trackId) => {
    const premiumItem = catalogByCode.get(getMusicPremiumCode(trackId));

    if (trackId === DEFAULT_TRACK_ID) {
      setSelectedTrackIdState(trackId);
      if (premiumItem?.is_owned) {
        void equipItem(premiumItem.id);
      }
      return;
    }

    if (!premiumItem?.is_owned) {
      throw new Error("Track is locked. Purchase it in Premium Store first.");
    }

    setSelectedTrackIdState(trackId);
    void equipItem(premiumItem.id);
  }, [catalogByCode, equipItem]);

  const isTrackOwned = useCallback(
    (trackId) => {
      if (trackId === DEFAULT_TRACK_ID) return true;
      return Boolean(catalogByCode.get(getMusicPremiumCode(trackId))?.is_owned);
    },
    [catalogByCode]
  );

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
      tracks,
      currentTrack,
      selectedTrackId,
      setSelectedTrackId,
      volume,
      setVolume,
      muted,
      setMuted,
      toggleMuted,
      isReady,
      isTrackOwned,
    }),
    [
      currentTrack,
      selectedTrackId,
      setSelectedTrackId,
      volume,
      setVolume,
      muted,
      setMuted,
      toggleMuted,
      isReady,
      isTrackOwned,
    ]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio() {
  const context = useContext(AudioContext);

  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }

  return context;
}
