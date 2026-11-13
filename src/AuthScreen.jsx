import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

export default function AuthScreen({ onLogin, onRegister, toast, api }) {
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).has('resetToken') ? 'reset' : 'login');
  const [email, setEmail] = useState('student@coursevault.local');
  const [password, setPassword] = useState('CourseVault123!');
  const [name, setName] = useState('');
  const [role, setRole] = useState('Student');
  const [departmentId, setDepartmentId] = useState('');
  const [semester, setSemester] = useState('5');
  const [departments, setDepartments] = useState([]);
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devToken, setDevToken] = useState('');

  useEffect(() => {
    api('/api/departments').then((d) => {
      setDepartments(d.items);
      if (d.items[0]) setDepartmentId(String(d.items[0].id));
    }).catch(() => {});
  }, [api]);

  const heading = mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : mode === 'request' ? 'Reset your password' : 'Choose a new password';
  const sub = mode === 'login' ? 'Sign in to access lecture notes, syllabus materials, and campus academic resources.'
    : mode === 'register' ? 'Register for your student or faculty account to access your department courses.'
    : 'We will help you recover access to your account.';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await onLogin(email, password);
      else if (mode === 'register') await onRegister({ name, email, password, role, department_id: Number(departmentId), semester: role === 'Student' ? Number(semester) : null });
      else if (mode === 'request') {
        const d = await api('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) });
        setDevToken(d.developmentToken || '');
        toast(d.message);
      } else {
        await api('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) });
        toast('Password updated. Sign in with your new password.');
        setMode('login');
      }
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };

  const action = busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Register and continue' : mode === 'request' ? 'Create reset link' : 'Update password';

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand"><i><BookOpen size={20} /></i>course<span>vault</span></div>
        <p className="auth-kicker">YOUR LEARNING LIBRARY</p>
        <h1>{heading}</h1>
        <p className="auth-sub">{sub}</p>
        {(mode === 'login' || mode === 'register') && (
          <div className="auth-tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Login</button>
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setEmail(''); setPassword(''); }}>Register</button>
          </div>
        )}
        <form onSubmit={submit}>
          {mode === 'register' && <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} /></label>}
          {mode !== 'reset' && <label>Email address<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>}
          {(mode === 'login' || mode === 'register') && <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === 'register' ? 10 : undefined} required /></label>}
          {mode === 'register' && (
            <>
              <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option>Student</option><option>Staff</option></select></label>
              <label>Department<select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              {role === 'Student' && <label>Semester<select value={semester} onChange={(e) => setSemester(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Semester {i + 1}</option>)}</select></label>}
            </>
          )}
          {mode === 'reset' && (
            <>
              <label>Reset token<input value={token} onChange={(e) => setToken(e.target.value)} required /></label>
              <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required /></label>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          {devToken && <p className="hint">Password reset verification code: <code>{devToken}</code></p>}
          <button className="primary full" disabled={busy}>{action}</button>
        </form>
        {mode === 'login' && <button className="linkbtn" onClick={() => setMode('request')}>Forgot password?</button>}
        {mode !== 'login' && mode !== 'register' && <button className="linkbtn" onClick={() => setMode('login')}>Back to sign in</button>}
        {mode === 'login' && (
          <div className="demo-box">
            <b>Demo accounts</b>
            <small>Shared password: <code>CourseVault123!</code></small>
            <div>{[['Student', 'student@coursevault.local'], ['Staff', 'staff@coursevault.local'], ['Admin', 'admin@coursevault.local']].map(([demoRole, mail]) => <button key={demoRole} onClick={() => { setEmail(mail); setPassword('CourseVault123!'); setMode('login'); }}>{demoRole}</button>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
