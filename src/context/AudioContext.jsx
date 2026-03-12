import { createContext, useContext, useEffect, useRef, useState } from "react";

const AudioContext = createContext();

export function AudioProvider({ children }) {
  const audioRef = useRef(null);

  const [volume, setVolume] = useState(
    Number(localStorage.getItem("launcherVolume")) || 0.35
  );

  const [muted, setMuted] = useState(false);

  useEffect(() => {
    audioRef.current = new Audio("/audio/launcher_music.mp3");
    audioRef.current.loop = true;
    audioRef.current.volume = volume;

    audioRef.current.play().catch(() => {});

    return () => {
      audioRef.current.pause();
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
      localStorage.setItem("launcherVolume", volume);
    }
  }, [volume, muted]);

  return (
    <AudioContext.Provider
      value={{
        volume,
        setVolume,
        muted,
        setMuted
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  return useContext(AudioContext);
}