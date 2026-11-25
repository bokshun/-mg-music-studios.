import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(signInError.message || "Sign-in failed.");
    } catch (err) {
      setError(err.message || "Unable to reach the studio. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card signin" onSubmit={submit}>
        <p className="eyebrow">Marianas Grown Productions</p>
        <h1>MG Music Studios</h1>
        <p className="muted">Sign in to open your studio.</p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Enter the studio'}</button>
      </form>
    </div>
  );
}
