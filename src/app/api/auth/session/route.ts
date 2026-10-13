import { getSessionUser } from '@/lib/auth';
import { ensureDatabase, getPool } from '@/lib/database';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    return Response.json({ user });
  } catch (error) {
    console.error('Session lookup error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'ตรวจสอบ session ไม่สำเร็จ' }, { status: 500 });
  }
}