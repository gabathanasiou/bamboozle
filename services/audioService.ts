
// Synthesized Sound Effects using Web Audio API
// This avoids external assets and ensures retro arcade vibes

class AudioService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  constructor() {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3; // Default volume
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  public unlock() {
    this.ensureContext();
  }

  /**
   * Mute/unmute every sound without discarding the audio context. Used by the
   * design lab so clicking around a preview stays silent by default.
   */
  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 0.3;
    }
  }

  public isMuted() {
    return this.muted;
  }

  private ensureContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(type: 'CLICK' | 'JOIN' | 'START' | 'TICK' | 'SUCCESS' | 'FAILURE' | 'SWOOSH' | 'DRUMROLL' | 'POP' | 'REVEAL') {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.ensureContext();
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.masterGain);

    switch (type) {
      case 'CLICK':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
        break;

      case 'POP':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
        break;

      case 'JOIN':
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.linearRampToValueAtTime(440, t + 0.1);
        osc.frequency.linearRampToValueAtTime(880, t + 0.2);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0.1, t + 0.2);
        gain.gain.linearRampToValueAtTime(0, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
        break;

      case 'START':
        // Major Chord Arpeggio
        this.playNote(440, t, 'triangle'); // A4
        this.playNote(554, t + 0.1, 'triangle'); // C#5
        this.playNote(659, t + 0.2, 'triangle'); // E5
        this.playNote(880, t + 0.3, 'square', 0.5); // A5
        break;

      case 'TICK':
        // Woodblock sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.05);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.start(t);
        osc.stop(t + 0.05);
        break;

      case 'SUCCESS': // Points / Correct
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, t); // C5
        osc.frequency.setValueAtTime(659.25, t + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, t + 0.2); // G5
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
        break;

      case 'FAILURE': // Tricked
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(100, t + 0.3);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
        break;

      case 'SWOOSH': // Phase change
        const noiseBufferSize = this.ctx.sampleRate * 0.5;
        const noiseBuffer = this.ctx.createBuffer(1, noiseBufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseBufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(200, t);
        noiseFilter.frequency.linearRampToValueAtTime(2000, t + 0.2);
        noiseFilter.frequency.linearRampToValueAtTime(100, t + 0.5);

        noise.connect(noiseFilter);
        noiseFilter.connect(gain);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        noise.start(t);
        break;

      case 'REVEAL':
        // Suspenseful low boom
        osc.type = 'sine';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 1.5);
        gain.gain.setValueAtTime(0.8, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
        osc.start(t);
        osc.stop(t + 1.5);
        break;

      case 'DRUMROLL':
        // Rapid snare hits
        for (let i = 0; i < 10; i++) {
          const snare = this.ctx.createOscillator();
          const snareGain = this.ctx.createGain();
          snare.type = 'triangle';
          snare.connect(snareGain);
          snareGain.connect(this.masterGain);
          snare.frequency.setValueAtTime(200, t + (i * 0.05));
          snareGain.gain.setValueAtTime(0.1, t + (i * 0.05));
          snareGain.gain.exponentialRampToValueAtTime(0.01, t + (i * 0.05) + 0.05);
          snare.start(t + (i * 0.05));
          snare.stop(t + (i * 0.05) + 0.05);
        }
        break;
    }
  }

  private playNote(freq: number, time: number, type: OscillatorType, duration: number = 0.2) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(this.masterGain);
    gain.gain.setValueAtTime(0.1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
    osc.start(time);
    osc.stop(time + duration);
  }
}

export const sfx = new AudioService();
