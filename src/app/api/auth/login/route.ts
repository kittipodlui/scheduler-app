import type { RowDataPacket } from 'mysql2/promise';
import { createSession, verifyPassword, type AuthUser } from '@/lib/auth';
import { authErrorResponse, authSuccessResponse, readAuthPayload } from '@/lib/auth-http';
import { ensureDatabase, getPool } from '@/lib/database';
import { normalizeGmailAddress } from '@/lib/email';

export const runtime = 'nodejs';
type UserRow = RowDataPacket & AuthUser & { password_hash: string; active: number };

export async function POST(request: Request): Promise<Response> {
  try {
    const { input } = await readAuthPayload(request);
    if (!input) return authErrorResponse(request, '/login', 'invalid_form', 400, 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
    const identifier = typeof input.identifier === 'string'
      ? input.identifier.trim().toLowerCase()
      : typeof input.email === 'string'
        ? input.email.trim().toLowerCase()
        : typeof input.username === 'string'
          ? input.username.trim().toLowerCase()
          : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!identifier || !password) return authErrorResponse(request, '/login', 'missing_credentials', 400, 'กรอกอีเมลหรือ Username และ Password ให้ครบ');
    const pool = getPool();
    await ensureDatabase(pool);
    const email = normalizeGmailAddress(identifier);
    const [rows] = email
      ? await pool.execute<UserRow[]>(
        'SELECT id, username, password_hash, role, active FROM users WHERE email = ? OR (email IS NULL AND username = ?) LIMIT 1',
        [email, identifier],
      )
      : await pool.execute<UserRow[]>(
        'SELECT id, username, password_hash, role, active FROM users WHERE email IS NULL AND username = ? LIMIT 1',
        [identifier],
      );
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return authErrorResponse(request, '/login', 'invalid_credentials', 401, 'อีเมล Gmail หรือ Username ไม่ถูกต้อง');
    }
    if (!user.active) return authErrorResponse(request, '/login', 'invalid_credentials', 403, 'บัญชีนี้ถูกปิดการใช้งาน');
    const safeUser = { id: user.id, username: user.username, role: user.role };
    const cookie = await createSession(pool, safeUser);
    return authSuccessResponse(request, safeUser, cookie);
  } catch (error) {
    console.error('Login error:', error instanceof Error ? error.message : 'Unknown error');
    return authErrorResponse(request, '/login', 'server_error', 500, 'เข้าสู่ระบบไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล');
  }
}
