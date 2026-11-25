// Browser playback for the Mixing room. The mixing decisions live in mixMath.js;
// this file only talks to Web Audio.
import {
  normalizeTrack, normalizeCutList, audibleTrackIds, voiceEnvelope, envelopeAt,
} from './mixMath.js';
import { dbToGain } from './fxMath.js';

export class MixEngine {
  static isSupported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.sampleRate = this.ctx.sampleRate;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.audio = new Map(); // track id -> AudioBuffer
    this.live = new Map(); // track id -> { src, gain, pan } while playing
    this.playing = false;
    this.startedAt = 0;
    this.from = 0;
    this.onEnded = null;
  }

  // Decode a File the person picked. Returns { buffer, duration }.
  async decode(file) {
    const bytes = await file.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(bytes);
    return { buffer, duration: buffer.duration };
  }

  setAudio(id, buffer) { this.audio.set(id, buffer); }
  removeAudio(id) { this.audio.delete(id); }
  channelsOf(id) {
    const b = this.audio.get(id);
    if (!b) return null;
    return Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c));
  }

  get duration() {
    let d = 0;
    this.audio.forEach((b) => { d = Math.max(d, b.duration); });
    return d;
  }

  position() {
    if (!this.playing) return this.from;
    return Math.min(this.duration, this.from + (this.ctx.currentTime - this.startedAt));
  }

  stopSources() {
    this.live.forEach(({ src, gain, pan }) => {
      src.onended = null;
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect(); gain.disconnect(); pan.disconnect();
    });
    this.live.clear();
  }

  // Start playing from `from` seconds with the current tracks and cut list.
  async play({ tracks, cutList, defaultId, from = 0 }) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stopSources();
    const ts = tracks.map(normalizeTrack);
    const total = this.duration;
    const list = normalizeCutList(cutList, total);
    const audible = audibleTrackIds(ts);
    const now = this.ctx.currentTime + 0.05;
    for (const t of ts) {
      const buffer = this.audio.get(t.id);
      if (!buffer) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = t.pan;
      const base = audible.has(t.id) ? dbToGain(t.volumeDb) : 0;
      if (t.role === 'voice') {
        const env = voiceEnvelope(t.id, list, defaultId, total);
        gain.gain.setValueAtTime(base * envelopeAt(env, from), now);
        for (const p of env) if (p.t > from) gain.gain.linearRampToValueAtTime(base * p.g, now + (p.t - from));
      } else {
        gain.gain.value = base;
      }
      src.connect(gain); gain.connect(pan); pan.connect(this.master);
      const off = t.offsetMs / 1000;
      const songStart = Math.max(0, off); // when this file begins on the song clock
      if (from >= songStart) src.start(now, Math.max(0, from - off));
      else src.start(now + (songStart - from), 0);
      this.live.set(t.id, { src, gain, pan });
    }
    this.from = from; this.startedAt = now; this.playing = true;
    // The track that ends last tells us when the song is over.
    let lastId = null; let lastEnd = -1;
    for (const t of ts) {
      const b = this.audio.get(t.id);
      if (b && this.live.has(t.id) && b.duration + t.offsetMs / 1000 > lastEnd) { lastEnd = b.duration + t.offsetMs / 1000; lastId = t.id; }
    }
    const last = lastId && this.live.get(lastId)?.src;
    if (last) last.onended = () => { if (this.playing) { this.playing = false; this.from = 0; this.stopSources(); this.onEnded?.(); } };
  }

  // Volume, pan, mute and solo can change while playing without a restart.
  applyLive(tracks) {
    const ts = tracks.map(normalizeTrack);
    const audible = audibleTrackIds(ts);
    for (const t of ts) {
      const node = this.live.get(t.id);
      if (!node) continue;
      node.pan.pan.setTargetAtTime(t.pan, this.ctx.currentTime, 0.01);
      // Voice tracks keep their scheduled automation; mute and solo are applied on the next play().
      if (t.role !== 'voice') node.gain.gain.setTargetAtTime(audible.has(t.id) ? dbToGain(t.volumeDb) : 0, this.ctx.currentTime, 0.01);
    }
  }

  pause() {
    if (!this.playing) return this.from;
    this.from = this.position();
    this.playing = false;
    this.stopSources();
    return this.from;
  }

  stop() {
    this.playing = false; this.from = 0;
    this.stopSources();
  }

  async close() {
    this.stop();
    try { await this.ctx.close(); } catch { /* already closed */ }
  }
}
