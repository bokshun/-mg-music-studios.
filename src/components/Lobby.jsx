import { useEffect, useMemo, useState } from 'react';
import { fetchProjects, signedUrl } from '../lib/data.js';
import Player from './Player.jsx';

const KIND_LABEL = { master_audio: 'Recording', artwork: 'Artwork', stem: 'Stem', midi: 'MIDI', video: 'Video', lyrics: 'Lyrics', storydrop_manifest: 'Story Drop', release_export: 'Release export', other: 'Other' };

function fmtDuration(s) {
  if (s == null) return '';
  const n = Math.round(Number(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
function fmtSize(b) {
  if (b == null) return '';
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}

function Artwork({ asset }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setSrc(null);
    setError("");
    signedUrl(asset).then((u) => live && setSrc(u)).catch((err) => { if (live) setError(err.message || "Artwork unavailable"); });
    return () => { live = false; };
  }, [asset]);
  return src ? <img className="art" src={src} alt={asset.file_name} /> : <div className="art placeholder" role="status" aria-label={error || "Loading artwork"}>{error && <span className="muted">Artwork unavailable</span>}</div>;
}

export default function Lobby({ mock = false, projects: mockProjects, email, onSignOut }) {
  const [projects, setProjects] = useState(mock ? mockProjects : null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [track, setTrack] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (mock) return;
    fetchProjects().then(setProjects).catch((e) => setError(e.message || 'Could not load projects.'));
  }, [mock]);

  const project = useMemo(() => projects?.find((p) => p.id === selectedId) ?? null, [projects, selectedId]);
  const audio = project?.mgp_assets.filter((a) => a.kind === 'master_audio') ?? [];
  const art = project?.mgp_assets.filter((a) => a.kind === 'artwork') ?? [];

  return (
    <div className="lobby">
      <header className="bar">
        <div>
          <p className="eyebrow">Marianas Grown Productions</p>
          <h1>MG Music Studios</h1>
        </div>
        <div className="who">
          {mock && <span className="badge">Demo data</span>}
          <span className="muted">{email}</span>
          {onSignOut && <button className="ghost" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {!projects && !error && <p className="muted">Loading your music…</p>}

      {projects && !project && (
        <section>
          <h2>Your music</h2>
          {projects.length === 0 && <p className="muted">No projects yet.</p>}
          <div className="grid">
            {projects.map((p) => {
              const cover = p.mgp_assets.find((a) => a.kind === 'artwork');
              return (
                <button key={p.id} className="card project" onClick={() => { setSelectedId(p.id); setTrack(null); }}>
                  {cover ? <Artwork asset={cover} /> : <div className="art placeholder" />}
                  <strong>{p.title}</strong>
                  <span className="muted">{p.creator_name || 'Unassigned artist'} · {p.status}</span>
                  <span className="muted">{p.mgp_assets.filter((a) => a.kind === 'master_audio').length} recording(s)</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {project && (
        <section>
          <button className="ghost" onClick={() => { setSelectedId(null); setTrack(null); }}>← Back to your music</button>
          <h2>{project.title}</h2>
          <p className="muted">
            {project.creator_name || 'Unassigned artist'} · {project.status} · v{project.version}
            {showDetails && project.bpm ? ` · ${project.bpm} BPM` : ''}
            {showDetails && project.musical_key ? ` · ${project.musical_key}` : ''}
          </p>
          <label className="toggle"><input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} /> Show technical details</label>

          <h3>Recordings</h3>
          {audio.length === 0 && <p className="muted">No recordings in this project.</p>}
          <ul className="tracks">
            {audio.map((a) => (
              <li key={a.id}>
                <button className={`track ${track?.id === a.id ? 'active' : ''}`} onClick={() => setTrack(a)}>
                  <span>▶ {a.file_name}</span>
                  <span className="muted">
                    {fmtDuration(a.duration_seconds)}
                    {showDetails && ` · ${a.mime_type ?? ''} · ${fmtSize(a.size_bytes)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {track && <Player key={track.id} asset={track} />}

          {art.length > 0 && (
            <>
              <h3>Artwork</h3>
              <div className="grid small">
                {art.map((a) => (
                  <figure key={a.id}><Artwork asset={a} /><figcaption className="muted">{a.file_name}</figcaption></figure>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <footer className="muted foot">Milestone 1 · read-only Studio Lobby. Mixing, AI Producer, Mastering and Release rooms are coming next.</footer>
    </div>
  );
}
