import { useState, type FormEvent } from 'react';
import { API_URL } from '../../lib/config';
import { setOperator, type Operator } from '../../lib/auth';

/** 운영자(행사 진행자) 로그인. 참여자는 로그인하지 않는다 */
export default function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '로그인하지 못했습니다.');
      setOperator(data as Operator);
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.replace(next && next.startsWith('/') ? next : '/host');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <form className="card" onSubmit={onSubmit} style={{ width: '100%', maxWidth: 380, padding: 28 }}>
        <h2 style={{ marginBottom: 6 }}>운영자 로그인</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' }}>출제 · 진행 · 관객 화면은 운영자 계정이 필요합니다.</p>
        <label className="field">
          <span>아이디</span>
          <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus />
        </label>
        {error && <p style={{ color: 'var(--no)', fontSize: 14, margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy}>로그인</button>
      </form>
    </div>
  );
}
