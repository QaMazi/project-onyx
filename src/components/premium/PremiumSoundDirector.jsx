import { useEffect, useRef } from "react";
import { usePremium } from "../../context/PremiumContext";

const PACKS = {
  glass: { base: 640, spread: 90, wave: "sine" },
  relic: { base: 360, spread: 55, wave: "triangle" },
  whisper: { base: 520, spread: 35, wave: "sine" },
};

function playTone(audioContext, baseFrequency, spread, waveType, duration, gainValue) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = waveType;
  oscillator.frequency.value = baseFrequency + Math.random() * spread;
  gainNode.gain.value = gainValue;

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start();
  gainNode.gain.exponentialRampToValueAtTime(
    0.0001,
    audioContext.currentTime + duration
  );
  oscillator.stop(audioContext.currentTime + duration);
}

function PremiumSoundDirector() {
  const { equippedBySlot } = usePremium();
  const audioContextRef = useRef(null);

  const uiPack = equippedBySlot?.ui_sound_pack?.metadata?.styleId || "glass";
  const clickPack = equippedBySlot?.menu_click_sound_pack?.metadata?.styleId || uiPack;
  const hoverPack = equippedBySlot?.menu_hover_sound_pack?.metadata?.styleId || uiPack;

  useEffect(() => {
    function ensureAudioContext() {
      if (!audioContextRef.current) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return null;
        audioContextRef.current = new AudioContextCtor();
      }

      return audioContextRef.current;
    }

    function handlePointerDown(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("button, a, [role='button'], input, select, textarea")) return;

      const context = ensureAudioContext();
      if (!context) return;

      const pack = PACKS[clickPack] || PACKS.glass;
      playTone(context, pack.base, pack.spread, pack.wave, 0.14, 0.022);
    }

    function handlePointerOver(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("button, a, [role='button']")) return;

      const context = ensureAudioContext();
      if (!context) return;

      const pack = PACKS[hoverPack] || PACKS.glass;
      playTone(context, pack.base + 90, pack.spread, pack.wave, 0.09, 0.012);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerover", handlePointerOver);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerover", handlePointerOver);
    };
  }, [clickPack, hoverPack]);

  return null;
}

export default PremiumSoundDirector;
