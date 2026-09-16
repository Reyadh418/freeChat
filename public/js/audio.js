// Zero-dependency Synthetic Web Audio Sound Effects for freeChat
let audioCtx = null;
let soundEnabled = typeof localStorage !== 'undefined'
  ? localStorage.getItem('freechat_sound_enabled') !== 'false'
  : true;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Unlock audio on first user gesture to comply with browser autoplay policies
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('click', unlockAudio, true);
    window.removeEventListener('keydown', unlockAudio, true);
    window.removeEventListener('touchstart', unlockAudio, true);
  };
  window.addEventListener('click', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  window.addEventListener('touchstart', unlockAudio, true);
}

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('freechat_sound_enabled', String(soundEnabled));
  }
  return soundEnabled;
}

export function toggleSoundEnabled() {
  return setSoundEnabled(!soundEnabled);
}

// Outgoing message sound: subtle 380Hz -> 620Hz sine pop with rapid exponential decay
export function playSentSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.07);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  } catch (e) {
    // AudioContext blocked or not supported
  }
}

// Incoming message sound: pleasant dual-tone ascending harmonic chime (G5 784Hz -> C6 1046.5Hz)
export function playReceivedSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const tones = [
      { freq: 784, start: 0, dur: 0.09, vol: 0.16 },     // G5
      { freq: 1046.5, start: 0.06, dur: 0.14, vol: 0.18 } // C6
    ];

    tones.forEach(({ freq, start, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + dur + 0.01);
    });
  } catch (e) {
    // AudioContext blocked or not supported
  }
}
