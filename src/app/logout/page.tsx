import Link from 'next/link';

export default function LogoutPage() {
  return (
    <main className="auth-shell">
      <section className="auth-panel logout-panel">
        <p className="eyebrow">SMART STUDY PLANNER</p>
        <h1>ออกจากระบบ</h1>
        <p className="auth-intro">ยืนยันเพื่อออกจากบัญชีนี้</p>
        <form action="/api/auth/logout" method="post">
          <button className="auth-submit" type="submit">ยืนยันออกจากระบบ</button>
        </form>
        <p className="auth-switch">
          <Link href="/">กลับหน้าตาราง</Link>
        </p>
      </section>
    </main>
  );
}