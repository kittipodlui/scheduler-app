import type { RowDataPacket } from 'mysql2/promise';
import { requireAdmin } from '@/lib/auth';
import { ensureDatabase, getPool } from '@/lib/database';

export const runtime = 'nodejs';
type UserRow = RowDataPacket & { id: number; role: 'user' | 'admin' };

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const admin = await requireAdmin(request, pool);
    if (!admin) return Response.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
    const body = await request.json() as { userId?: number; active?: boolean };
    const userId = Number(body.userId);
    if (!Number.isSafeInteger(userId) || typeof body.active !== 'boolean') return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });
    if (userId === admin.id) return Response.json({ error: 'ไม่สามารถปิดบัญชีตัวเองได้' }, { status: 400 });
    const [rows] = await pool.execute<UserRow[]>('SELECT id, role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows[0]) return Response.json({ error: 'ไม่พบผู้ใช้งาน' }, { status: 404 });
    await pool.execute('UPDATE users SET active = ? WHERE id = ?', [body.active ? 1 : 0, userId]);
    return Response.json({ ok: true, active: body.active });
  } catch (error) {
    console.error('Admin status error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'เปลี่ยนสถานะผู้ใช้ไม่สำเร็จ' }, { status: 500 });
  }
}
