import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MixEngine } from '../lib/mixEngine.js';
import { TRACK_LIMITS, makeTrack, mixdown, normalizeCutList, parseCutListText, formatClock } from '../lib/mixMath.js';
import { encodeWav } from '../lib/fxMath.js';

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const EXAMPLE = `# One line per section:  start-end  voice name
0:11-0:25 Flomar
0:53-1:14 Flomar`;

export default function MixingRoom({ onBack }) {
  const engine = useRef(null);
  const supported = MixEngine.isSupported();
  const [tracks, setTracks] = useState([]);
  const [defaultId, setDefaultId] = useState('');
  const [cutText, setCutText] = useState('');
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const tracksRef = useRef(tracks); tracksRef.current = tracks;

  const getEngine = () => {
    if (!engine.current) {
      engine.current = new MixEngine();
      engine.current.onEnded = () => { setPlaying(false); setPos(0); };
    }
    return engine.current;
  };
  useEffect(() => () => { engine.current?.close(); engine.current = null; }, []);

  const voices = useMemo(() => tracks.filter((t) => t.role === 'voice'), [tracks]);
  const effectiveDefault = voices.some((v) => v.id === defaultId) ? defaultId : voices[0]?.id ?? '';

  const parsed = useMemo(() => {
    const names = {}; const dupes = new Set();
    for (const v of voices) {
      const key = v.name.trim().toLowerCase();
      if (names[key]) dupes.add(v.name); names[key] = v.id;
    }
    const { rows, problems } = parseCutListText(cutText, names);
    for (const d of dupes) problems.push(`Two voice tracks are both named "${d}". Rename one so the list can tell them apart.`);
    return { rows: normalizeCutList(rows, duration || Infinity), problems };
  }, [cutText, voices, duration]);

  const nameOf = (id) => tracks.find((t) => t.id === id)?.name ?? '?';

  const restart = useCallback(async (from) => {
    const e = engine.current; if (!e) return;
    await e.play({ tracks: tracksRef.current, cutList: parsed.rows, defaultId: effectiveDefault, from });
  }, [parsed.rows, effectiveDefault]);

  // Clock for the playhead.
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setPos(engine.current?.position() ?? 0), 100);
    return () => clearInterval(id);
  }, [playing]);

  // Changes that need the audio re-planned (mute, solo, role, nudge, cut list) while playing.
  const planKey = useMemo(() => JSON.stringify([
    tracks.map((t) => [t.id, t.role, t.mute, t.solo, t.offsetMs, t.role === 'voice' ? t.volumeDb : 0]), parsed.rows, effectiveDefault,
  ]), [tracks, parsed.rows, effectiveDefault]);
  const firstPlan = useRef(true);
  useEffect(() => {
    if (firstPlan.current) { firstPlan.current = false; return; }
    if (engine.current?.playing) restart(engine.current.position()).catch((e) => setError(e.message));
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume and pan on ordinary tracks can follow the sliders live.
  useEffect(() => { if (engine.current?.playing) engine.current.applyLive(tracks); }, [tracks]);

  async function addFiles(fileList) {
    setError('');
    const e = getEngine();
    const files = Array.from(fileList || []);
    for (const file of files) {
      setBusy(`Loading ${file.name}…`);
      try {
        const { buffer } = await e.decode(file);
        const t = makeTrack(file.name.replace(/\.[^.]+$/, ''));
        e.setAudio(t.id, buffer);
        setTracks((prev) => [...prev, t]);
      } catch (err) {
        setError(`Could not read ${file.name}. ${err?.message ?? 'Try a WAV or MP3 file.'}`);
      }
    }
    setBusy('');
    setDuration(e.duration);
  }

  function update(id, patch) { setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))); }
  function remove(id) {
    engine.current?.removeAudio(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
    setDuration(engine.current?.duration ?? 0);
  }

  async function togglePlay() {
    const e = getEngine();
    setError('');
    try {
      if (playing) { setPos(e.pause()); setPlaying(false); return; }
      await restart(pos >= duration - 0.05 ? 0 : pos);
      setPlaying(true);
    } catch (err) { setError(err?.message || 'Playback could not start.'); }
  }
  function stopAll() { engine.current?.stop(); setPlaying(false); setPos(0); }
  async function seek(v) {
    const t = Number(v); setPos(t);
    if (playing) await restart(t); else if (engine.current) engine.current.from = t;
  }

  async function exportWav() {
    setError('');
    const e = engine.current;
    if (!e || !tracks.length) { setError('Load at least one track first.'); return; }
    setBusy('Mixing down…');
    await new Promise((r) => setTimeout(r, 30)); // let the message paint
    try {
      const out = mixdown(
        tracks.map((t) => ({ track: t, channels: e.channelsOf(t.id) })),
        { cutList: parsed.rows, defaultId: effectiveDefault, sampleRate: e.sampleRate },
      );
      download(new Blob([encodeWav(out.channels, out.sampleRate)], { type: 'audio/wav' }), 'MG-mix.wav');
      if (out.scaled) setError('Saved. The mix was too loud, so its level was lowered slightly to avoid distortion.');
    } catch (err) { setError(err?.message || 'Could not export.'); }
    setBusy('');
  }

  if (!supported) return <div className="lobby"><button className="ghost" onClick={onBack}>← Back to the lobby</button><p className="error" role="alert">This browser cannot play multitrack audio. Try a current Chrome, Edge, Safari or Firefox.</p></div>;

  return (
    <div className="lobby mixing">
      <header className="bar">
        <div><p className="eyebrow">Marianas Grown Productions</p><h1>Mixing Room</h1></div>
        <button className="ghost" onClick={onBack}>← Back to the lobby</button>
      </header>
      <p className="muted">Load the files for your song, balance them, and choose which voice sings each section. Everything stays on your device. Nothing is uploaded.</p>

      <section className="card">
        <label>Add audio files (WAV or MP3)
          <input type="file" accept="audio/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {busy && <p className="muted" role="status">{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {tracks.length > 0 && (
        <>
          <section className="card transport">
            <div className="row">
              <button className="primary" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
              <button className="ghost" onClick={stopAll}>Stop</button>
              <span className="muted">{formatClock(pos)} / {formatClock(duration)}</span>
              <button className="ghost" onClick={exportWav} disabled={!!busy}>Save mix as WAV</button>
            </div>
            <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(pos, duration || 1)} onChange={(e) => seek(e.target.value)} aria-label="Song position" />
          </section>

          <section>
            <h3>Tracks</h3>
            <ul className="tracks">
              {tracks.map((t) => (
                <li key={t.id} className="card mixrow">
                  <div className="row">
                    <input className="trackname" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} aria-label="Track name" />
                    <select value={t.role} onChange={(e) => update(t.id, { role: e.target.value })} aria-label="How this track is used">
                      <option value="always">Plays the whole song</option>
                      <option value="voice">Voice option (picked by section)</option>
                    </select>
                    <button className={`ghost ${t.mute ? 'on' : ''}`} onClick={() => update(t.id, { mute: !t.mute })} aria-pressed={t.mute}>Mute</button>
                    <button className={`ghost ${t.solo ? 'on' : ''}`} onClick={() => update(t.id, { solo: !t.solo })} aria-pressed={t.solo}>Solo</button>
                    <button className="ghost" onClick={() => remove(t.id)} aria-label={`Remove ${t.name}`}>Remove</button>
                  </div>
                  <div className="sliders">
                    <label>Volume {t.volumeDb > 0 ? '+' : ''}{t.volumeDb.toFixed(1)} dB
                      <input type="range" min={TRACK_LIMITS.volumeDb.min} max={TRACK_LIMITS.volumeDb.max} step="0.5" value={t.volumeDb} onChange={(e) => update(t.id, { volumeDb: Number(e.target.value) })} />
                    </label>
                    <label>Pan {t.pan === 0 ? 'centre' : t.pan < 0 ? `${Math.round(-t.pan * 100)}% left` : `${Math.round(t.pan * 100)}% right`}
                      <input type="range" min="-1" max="1" step="0.05" value={t.pan} onChange={(e) => update(t.id, { pan: Number(e.target.value) })} />
                    </label>
                    <label>Nudge {t.offsetMs} ms (lines the track up)
                      <input type="range" min={TRACK_LIMITS.offsetMs.min} max={TRACK_LIMITS.offsetMs.max} step="10" value={t.offsetMs} onChange={(e) => update(t.id, { offsetMs: Number(e.target.value) })} />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3>Voice by section</h3>
            {voices.length < 2 ? (
              <p className="muted">To swap voices, set two or more tracks to “Voice option” (for example, one file with Bokshun 1 singing and one with Flomar singing). Keep the band and backing files on “Plays the whole song”.</p>
            ) : (
              <>
                <label>Voice everywhere not listed below
                  <select value={effectiveDefault} onChange={(e) => setDefaultId(e.target.value)}>
                    {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
                <label>Sections (one per line, like 0:11-0:25 Flomar)
                  <textarea rows="6" value={cutText} placeholder={EXAMPLE} onChange={(e) => setCutText(e.target.value)} spellCheck="false" />
                </label>
                {parsed.problems.map((p) => <p key={p} className="error" role="alert">{p}</p>)}
                {parsed.rows.length > 0 && (
                  <ul className="cuts muted">
                    {parsed.rows.map((r) => <li key={`${r.start}-${r.trackId}`}>{formatClock(r.start)} – {formatClock(r.end)}: {nameOf(r.trackId)}</li>)}
                  </ul>
                )}
                <p className="muted">Each change crossfades over a fraction of a second so there are no clicks. If a swap sounds slightly early or late, use that track’s Nudge.</p>
              </>
            )}
          </section>
        </>
      )}
      <footer className="muted foot">Mixing Room · milestone 1. Saving projects and reloading a mix are coming later.</footer>
    </div>
  );
}
