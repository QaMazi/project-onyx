import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const AudioContext = createContext(null);

const TRACK_STORAGE_KEY = "onyxSelectedTrack";
const VOLUME_STORAGE_KEY = "musicVolume";
const MUTED_STORAGE_KEY = "musicMuted";

const tracks = [
  { id: "egyptian-1", name: "Egyptian 1", file: "/audio/Egyptian 1.mp3" },
  { id: "egyptian-2", name: "Egyptian 2", file: "/audio/Egyptian 2.mp3" },
  { id: "egyptian-3", name: "Egyptian 3", file: "/audio/Egyptian 3.mp3" },
  { id: "egyptian-4", name: "Egyptian 4", file: "/audio/Egyptian 4.mp3" },
  { id: "egyptian-5", name: "Egyptian 5", file: "/audio/Egyptian 5.mp3" },
  { id: "egyptian-6", name: "Egyptian 6", file: "/audio/Egyptian 6.mp3" },
  { id: "desert-of-set", name: "Desert Of Set", file: "/audio/Desert Of Set.mp3" },
  { id: "obelisk-of-thunder", name: "Obelisk of Thunder", file: "/audio/Obelisk of Thunder.mp3" },
  { id: "millennium-battle-1", name: "Millennium Battle 1", file: "/audio/Millennium Battle 1.mp3" },
  { id: "millennium-battle-2", name: "Millennium Battle 2", file: "/audio/Millennium Battle 2.mp3" },
  { id: "millennium-battle-3", name: "Millennium Battle 3", file: "/audio/Millennium Battle 3.mp3" },
  { id: "overlap", name: "Overlap", file: "/audio/Overlap.mp3" },
  { id: "shuffle", name: "Shuffle", file: "/audio/Shuffle.mp3" },
  { id: "wild-drive", name: "Wild Drive", file: "/audio/Wild Drive.mp3" },
  { id: "warriors", name: "Warriors", file: "/audio/Warriors.mp3" },
  { id: "voice", name: "Voice", file: "/audio/Voice.mp3" },
  { id: "eyes", name: "EYES", file: "/audio/EYES.mp3" },
  { id: "ano-hi-no-gogo", name: "Ano hi no Gogo", file: "/audio/Ano hi no Gogo.mp3" },
  { id: "afureru-kanjou-ga-tomaranai", name: "Afureru Kanjou ga Tomaranai", file: "/audio/Afureru Kanjou ga Tomaranai.mp3" },
  { id: "genki-no-shower", name: "Genki no Shower", file: "/audio/Genki no Shower.mp3" },
  { id: "going-my-way", name: "Going My Way", file: "/audio/Going My Way.mp3" },
  { id: "rakuen", name: "Rakuen", file: "/audio/Rakuen.mp3" },
  { id: "rising-weather-hallelujah", name: "Rising Weather Hallelujah", file: "/audio/Rising Weather Hallelujah.mp3" },
];

const DEFAULT_TRACK_ID = "egyptian-1";

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
  const audioRef = useRef(null);
  const unlockBoundRef = useRef(false);

  const [selectedTrackId, setSelectedTrackIdState] = useState(getInitialTrackId);
  const [volume, setVolumeState] = useState(getInitialVolume);
  const [muted, setMutedState] = useState(getInitialMuted);
  const [isReady, setIsReady] = useState(false);

  const currentTrack = useMemo(() => getTrackById(selectedTrackId), [selectedTrackId]);

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
    setSelectedTrackIdState(trackId);
  }, []);

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