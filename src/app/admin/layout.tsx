import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAuthenticatedUser } from '@/lib/auth-page';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthenticatedUser();
  if (user.role !== 'admin') redirect('/');

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span>STUDY SCHEDULER</span>
          <strong>ADMIN</strong>
        </div>
        <nav className="admin-nav">
          <Link href="/admin" className="admin-nav-link">Dashboard</Link>
          <a href="#users" className="admin-nav-link">User Management</a>
        </nav>
        <div className="admin-sidebar-account">
          <span>เข้าสู่ระบบในชื่อ</span>
          <strong>{user.username}</strong>
          <Link href="/admin">กลับ Admin Dashboard</Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="admin-logout-button">ออกจากระบบ</button>
          </form>
        </div>
      </aside>
      <section className="admin-content">{children}</section>
    </div>
  );
}
