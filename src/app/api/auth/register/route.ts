import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createSession, hashPassword } from '@/lib/auth';
import { authErrorResponse, authSuccessResponse, readAuthPayload } from '@/lib/auth-http';
import { ensureDatabase, getPool } from '@/lib/database';
import { normalizeGmailAddress } from '@/lib/email';

export const runtime = 'nodejs';

type ExistingUserRow = RowDataPacket & { id: number; username: string; email: string | null };

function isDuplicateUser(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && error.code === 'ER_DUP_ENTRY');
}

export async function POST(request: Request): Promise<Response> {
  let connection;
  try {
    const { input } = await readAuthPayload(request);
    if (!input) return authErrorResponse(request, '/register', 'invalid_form', 400, 'ข้อมูลสมัครสมาชิกไม่ถูกต้อง');
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const email = normalizeGmailAddress(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : null;
    if (!/^[a-z0-9_]{3,32}$/.test(username)) {
      return authErrorResponse(request, '/register', 'invalid_username', 400, 'Username ใช้ a-z, 0-9 หรือ _ ความยาว 3–32 ตัวอักษร');
    }
    if (!email) {
      return authErrorResponse(request, '/register', 'invalid_email', 400, 'กรอกอีเมล Gmail ที่ถูกต้อง');
    }
    if (password.length < 8 || password.length > 128) {
      return authErrorResponse(request, '/register', 'invalid_password', 400, 'Password ต้องมีความยาว 8–128 ตัวอักษร');
    }
    if (!/^[A-Za-z0-9@_-]+$/.test(password)) {
      return authErrorResponse(request, '/register', 'invalid_password', 400, 'Password ใช้ได้เฉพาะอักษรภาษาอังกฤษ ตัวเลข และอักขระ @, _ หรือ -');
    }
    if (confirmPassword !== null && confirmPassword !== password) {
      return authErrorResponse(request, '/register', 'password_mismatch', 400, 'ยืนยัน password ไม่ตรงกัน');
    }

    const pool = getPool();
    await ensureDatabase(pool);
    const [existingUsers] = await pool.execute<ExistingUserRow[]>(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email],
    );
    if (existingUsers.length > 0) {
      return authErrorResponse(request, '/register', 'account_exists', 409, 'Username หรืออีเมลนี้ถูกใช้งานแล้ว');
    }

    const passwordHash = await hashPassword(password);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, 'user'],
    );
    const user = { id: result.insertId, username, role: 'user' as const };
    await connection.execute(
      'INSERT INTO study_categories (user_id, name) VALUES (?, ?)',
      [user.id, 'แผนการอ่านหนังสือ'],
    );
    const cookie = await createSession(connection, user);
    await connection.commit();

    const response = authSuccessResponse(request, user, cookie);
    if (request.headers.get('content-type')?.includes('application/json')) {
      return Response.json({ user }, { status: 201, headers: { 'Set-Cookie': cookie } });
    }
    return response;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        console.error('Register transaction rollback failed');
      }
    }
    if (isDuplicateUser(error)) {
      return authErrorResponse(request, '/register', 'account_exists', 409, 'Username หรืออีเมลนี้ถูกใช้งานแล้ว');
    }
    console.error('Register error:', error instanceof Error ? error.message : 'Unknown error');
    return authErrorResponse(request, '/register', 'server_error', 500, 'สมัครสมาชิกไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล');
  } finally {
    connection?.release();
  }
}