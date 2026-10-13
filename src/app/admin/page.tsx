import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth-page';
import { ensureDatabase, getPool } from '@/lib/database';
import AdminUserStatusButton from '@/app/components/admin-user-status-button';
import type { RowDataPacket } from 'mysql2/promise';

export const dynamic = 'force-dynamic';
type AdminUserRow = RowDataPacket & { id: number; username: string; role: 'user' | 'admin'; active: number; created_at: Date };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const user = await requireAuthenticatedUser();
  if (user.role !== 'admin') redirect('/');
  const { search = '' } = await searchParams;
  const keyword = search.trim();
  const pool = getPool();
  await ensureDatabase(pool);
  const [users] = await pool.execute<AdminUserRow[]>(keyword ? 'SELECT id, username, role, active, created_at FROM users WHERE username LIKE ? ORDER BY created_at DESC' : 'SELECT id, username, role, active, created_at FROM users ORDER BY created_at DESC', keyword ? [`%${keyword}%`] : []);

  return (
    <div id="users">
      <header className="admin-page-header">
        <div><span className="admin-eyebrow">ADMINISTRATION</span><h1>Admin Dashboard</h1><p>จัดการผู้ใช้งานระบบ</p></div>
        <div className="admin-user-badge"><span>ADMIN</span><strong>{user.username}</strong></div>
      </header>
      <section className="admin-section">
        <div className="admin-section-heading"><div><span className="admin-eyebrow">USERS</span><h2>User Management</h2></div><strong>{users.length} คน</strong></div>
        <form method="get" className="admin-search"><input name="search" defaultValue={keyword} placeholder="ค้นหา username..."/><button type="submit">ค้นหา</button>{keyword && <a href="/admin">ล้าง</a>}</form>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Username</th><th>Role</th><th>สถานะ</th><th>สมัครเมื่อ</th><th>จัดการ</th></tr></thead>
          <tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.username}</strong></td><td><span className={`admin-role admin-role-${item.role}`}>{item.role}</span></td><td><span className={item.active ? 'admin-status active' : 'admin-status'}>{item.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span></td><td>{new Date(item.created_at).toLocaleString('th-TH')}</td><td>{item.id === user.id ? <span className="admin-current">บัญชีปัจจุบัน</span> : <AdminUserStatusButton userId={item.id} active={Boolean(item.active)} />}</td></tr>)}</tbody>
        </table></div>
      </section>
    </div>
  );
}
