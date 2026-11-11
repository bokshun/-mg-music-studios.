import { useCallback, useEffect, useRef, useState } from 'react';
import { VocalEngine, blobToWav } from '../lib/vocalEngine.js';
import { FX_DEFAULTS, FX_RANGES, PRESETS, formatTime } from '../lib/fxMath.js';

const GROUPS = [
  { title: 'Input', keys: ['inputGainDb', 'lowCutHz'] },
  { title: 'Tone', keys: ['warmthDb', 'presenceDb', 'airDb'] },
  { title: 'Dynamics', keys: ['compAmount'] },
  { title: 'Echo', keys: ['delayMix', 'delayMs', 'delayFeedback'] },
  { title: 'Reverb', keys: ['reverbMix', 'reverbSeconds'] },
  { title: 'Output', keys: ['outputDb'] },
];

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function VocalRoom({ onBack }) {
  const engine = useRef(null);
  const [state, setState] = useState('off'); // off | starting | live | error
  const [error, setError] = useState('');
  const [fx, setFx] = useState(FX_DEFAULTS);
  const [preset, setPreset] = useState('');
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(-120);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [takes, setTakes] = useState([]);
  const takesRef = useRef([]);
  takesRef.current = takes;
  const supported = VocalEngine.isSupported();

  const turnOn = useCallback(async () => {
    setState('starting'); setError('');
    try {
      const e = new VocalEngine();
      await e.start();
      e.setSettings(fx);
      engine.current = e;
      setState('live');
    } catch (err) {
      setState('error');
      setError(err?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser address bar, then try again.'
        : err?.name === 'NotFoundError' ? 'No microphone was found. Plug one in and try again.'
        : err?.message || 'Could not start the microphone.');
    }
  }, [fx]);

  const turnOff = useCallback(async () => {
    const e = engine.current; engine.current = null;
    setMonitor(false); setRecording(false); setLevel(-120);
    if (e) { try { await e.stop(); } catch { /* already closed */ } }
    setState('off');
  }, []);

  // Level meter and recording clock.
  useEffect(() => {
    if (state !== 'live') return undefined;
    let raf; let t0 = null;
    const tick = () => {
      const e = engine.current; if (!e) return;
      setLevel(e.getInputPeakDb());
      if (e.isRecording) { t0 ??= performance.now(); setElapsed((performance.now() - t0) / 1000); } else t0 = null;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  // Release the microphone and free take URLs when leaving the room.
  useEffect(() => () => {
    engine.current?.stop().catch(() => {});
    takesRef.current.forEach((t) => { URL.revokeObjectURL(t.wetUrl); URL.revokeObjectURL(t.dryUrl); });
  }, []);

  const change = (key, value) => {
    const next = { ...fx, [key]: Number(value) };
    setFx(next); setPreset('');
    engine.current?.setSettings(next);
  };
  const applyPreset = (name) => {
    setPreset(name);
    if (!name) return;
    setFx(PRESETS[name]);
    engine.current?.setSettings(PRESETS[name]);
  };
  const toggleMonitor = (on) => { setMonitor(on); engine.current?.setMonitoring(on); };

  const startRec = () => {
    try { setElapsed(0); engine.current.startRecording(); setRecording(true); }
    catch (err) { setError(err.message || 'Could not start recording.'); }
  };
  const stopRec = async () => {
    setRecording(false);
    try {
      const take = await engine.current.stopRecording();
      if (take) {
        setTakes((list) => [{ ...take, id: crypto.randomUUID(), name: `Take ${list.length + 1}`,
          wetUrl: URL.createObjectURL(take.wetBlob), dryUrl: URL.createObjectURL(take.dryBlob) }, ...list]);
      }
    } catch (err) { setError(err.message || 'Recording failed.'); }
  };
  const removeTake = (id) => setTakes((list) => {
    const t = list.find((x) => x.id === id);
    if (t) { URL.revokeObjectURL(t.wetUrl); URL.revokeObjectURL(t.dryUrl); }
    return list.filter((x) => x.id !== id);
  });
  const saveWav = async (take, which) => {
    try { download(await blobToWav(which === 'dry' ? take.dryBlob : take.wetBlob), `${take.name}-${which === 'dry' ? 'original' : 'with-effects'}.wav`); }
    catch (err) { setError(`Could not convert to WAV: ${err.message || err}`); }
  };

  const clipping = level > -1;
  const meterPct = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));

  return (
    <div className="lobby vocal">
      <header className="bar">
        <div>
          <p className="eyebrow">Marianas Grown Productions</p>
          <h1>Vocal Practice Room</h1>
        </div>
        <button className="ghost" onClick={async () => { await turnOff(); onBack(); }}>← Studio Lobby</button>
      </header>

      {!supported && <p className="error" role="alert">This browser does not support microphone recording. Use a current Chrome, Edge, Firefox or Safari.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card" aria-label="Microphone">
        {state !== 'live' ? (
          <div className="row">
            <p className="muted">Turn the microphone on to hear and record your voice with effects. <strong>Use headphones</strong> so the speakers don't feed back into the mic.</p>
            <button className="primary" disabled={!supported || state === 'starting'} onClick={turnOn}>{state === 'starting' ? 'Starting…' : '🎤 Turn on microphone'}</button>
          </div>
        ) : (
          <div className="vocal-live">
            <div className="row">
              <div className="meter" role="meter" aria-label="Mic level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(level)}>
                <div className={clipping ? 'meter-fill clip' : 'meter-fill'} style={{ width: `${meterPct}%` }} />
              </div>
              <span className={clipping ? 'error' : 'muted'}>{clipping ? 'Too loud, lower Mic level' : `${Math.round(level)} dB`}</span>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={monitor} onChange={(e) => toggleMonitor(e.target.checked)} />
              Hear myself with effects (headphones only)
            </label>
            <div className="row">
              {!recording
                ? <button className="primary" onClick={startRec}>● Record</button>
                : <button className="primary rec" onClick={stopRec}>■ Stop ({formatTime(elapsed)})</button>}
              <button className="ghost" disabled={recording} onClick={turnOff}>Turn off microphone</button>
            </div>
          </div>
        )}
      </section>

      <section className="card fx" aria-label="Effects">
        <div className="row">
          <h2>Effects</h2>
          <label>Preset
            <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">Custom</option>
              {Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <div className="fx-grid">
          {GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend>{g.title}</legend>
              {g.keys.map((k) => {
                const r = FX_RANGES[k];
                return (
                  <label key={k}>
                    <span>{r.label}: <strong>{fx[k]}{r.unit && ` ${r.unit}`}</strong></span>
                    <input type="range" min={r.min} max={r.max} step={r.step} value={fx[k]} onChange={(e) => change(k, e.target.value)} />
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
      </section>

      <section aria-label="Takes">
        <h3>Takes</h3>
        <p className="muted">Takes stay in this browser tab only. They are not uploaded and disappear when you close or reload the page, so download the ones you want to keep.</p>
        {takes.length === 0 && <p className="muted">No takes yet. Turn on the microphone and press Record.</p>}
        <ul className="tracks">
          {takes.map((t) => (
            <li key={t.id} className="card take">
              <div className="row"><strong>{t.name}</strong><span className="muted">{formatTime(t.seconds)} · {new Date(t.createdAt).toLocaleTimeString()}</span></div>
              <label>With effects<audio controls src={t.wetUrl} /></label>
              <label>Original (no effects)<audio controls src={t.dryUrl} /></label>
              <div className="row">
                <button className="ghost" onClick={() => saveWav(t, 'wet')}>Download WAV (effects)</button>
                <button className="ghost" onClick={() => saveWav(t, 'dry')}>Download WAV (original)</button>
                <button className="ghost" onClick={() => removeTake(t.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
