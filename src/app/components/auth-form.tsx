'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';

type AuthFormProps = {
  mode: 'login' | 'register';
  initialError?: string;
};

export default function AuthForm({ mode, initialError = '' }: AuthFormProps) {
  const isRegister = mode === 'register';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [error, setError] = useState(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (isRegister && !/^[A-Za-z0-9@_-]+$/.test(password)) {
      setError('Password ใช้ได้เฉพาะอักษรภาษาอังกฤษ ตัวเลข และอักขระ @, _ หรือ -');
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setError('ยืนยัน password ไม่ตรงกัน');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isRegister
          ? { username, email, password, confirmPassword }
          : { identifier, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ดำเนินการไม่สำเร็จ');
      window.location.replace(result.user?.role === 'admin' ? '/admin' : '/');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'ดำเนินการไม่สำเร็จ');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p><br /></p>
        <h1 style={{ textAlign: 'center' }}>{isRegister ? 'สร้างบัญชี' : 'Smart Study Planner'}</h1>
        <p className="auth-intro">
          {isRegister ? 'เริ่มบันทึกแผนอ่านหนังสือของคุณ' : ''}
        </p>

        <form className="auth-form" method="post" action={`/api/auth/${mode}`} onSubmit={submit}>
          {isRegister ? (
            <>
              <label className="auth-label" htmlFor="username">Username</label>
              <input
                className="auth-input"
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_]{3,32}"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <label className="auth-label" htmlFor="email">อีเมล Gmail</label>
              <input
                className="auth-input"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </>
          ) : (
            <>
              <label className="auth-label" htmlFor="identifier">อีเมล Gmail</label>
              <input
                className="auth-input"
                id="identifier"
                name="identifier"
                type="text"
                autoComplete="email"
                autoCapitalize="none"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </>
          )}

          <label className="auth-label" htmlFor="password">Password</label>
          <div className="auth-password-field">
            <input
              className={`auth-input ${isPasswordVisible ? 'auth-password-input' : ''}`}
              id="password"
              name="password"
              type={isPasswordVisible ? 'text' : 'password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength={8}
              maxLength={128}
              required
              value={password}
              pattern="[A-Za-z0-9@_-]+"
              onChange={(event) => setPassword(event.target.value.replace(/[^A-Za-z0-9@_-]/g, ''))}
            />
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={isPasswordVisible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              aria-pressed={isPasswordVisible}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              {isPasswordVisible ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>

          {isRegister && (
            <>
              <label className="auth-label" htmlFor="confirm-password">ยืนยัน Password</label>
              <div className="auth-password-field">
                <input
                  className={`auth-input ${isConfirmPasswordVisible ? 'auth-password-input' : ''}`}
                  id="confirm-password"
                  name="confirmPassword"
                  type={isConfirmPasswordVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirmPassword}
                  pattern="[A-Za-z0-9@_-]+"
                  onChange={(event) => setConfirmPassword(event.target.value.replace(/[^A-Za-z0-9@_-]/g, ''))}
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={isConfirmPasswordVisible ? 'ซ่อนรหัสผ่านที่ยืนยัน' : 'แสดงรหัสผ่านที่ยืนยัน'}
                  aria-pressed={isConfirmPasswordVisible}
                  onClick={() => setIsConfirmPasswordVisible((visible) => !visible)}
                >
                  {isConfirmPasswordVisible ? 'ซ่อน' : 'แสดง'}
                </button>
              </div>
            </>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'กำลังตรวจสอบ...' : isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? 'มีบัญชีแล้ว?' : 'ยังไม่มีบัญชี?'}{' '}
          <Link href={isRegister ? '/login' : '/register'}>
            {isRegister ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
          </Link>
        </p>
      </section>
    </main>
  );
}