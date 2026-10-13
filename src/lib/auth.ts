import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export const SESSION_COOKIE_NAME = 'study_planner_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_KEY_LENGTH = 64;

export type AuthUser = { id: number; username: string; role: 'user' | 'admin' };
type AuthUserRow = RowDataPacket & AuthUser & { active: number };

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16); const key = await derivePasswordKey(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex'); const expected = Buffer.from(keyHex, 'hex');
    if (salt.length !== 16 || expected.length !== PASSWORD_KEY_LENGTH) return false;
    return timingSafeEqual(await derivePasswordKey(password, salt), expected);
  } catch { return false; }
}
function getCookieValue(request: Request): string | null {
  const header = request.headers.get('cookie'); if (!header) return null;
  const cookie = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1)) : null;
}
export async function createSession(connection: Pool | PoolConnection, user: AuthUser): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await connection.execute('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, user.id, expiresAt]);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
}
export async function getSessionUser(request: Request, connection: Pool | PoolConnection): Promise<AuthUser | null> {
  return getSessionUserFromToken(getCookieValue(request), connection);
}
export async function getSessionUserFromToken(token: string | null | undefined, connection: Pool | PoolConnection): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [rows] = await connection.execute<AuthUserRow[]>(
    'SELECT users.id, users.username, users.role, users.active FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > CURRENT_TIMESTAMP AND users.active = 1 LIMIT 1', [tokenHash],
  );
  return rows[0] ? { id: rows[0].id, username: rows[0].username, role: rows[0].role } : null;
}
export async function requireAdmin(request: Request, connection: Pool | PoolConnection): Promise<AuthUser | null> {
  const user = await getSessionUser(request, connection); return user?.role === 'admin' ? user : null;
}
export async function deleteSession(request: Request, connection: Pool | PoolConnection): Promise<void> {
  const token = getCookieValue(request); if (!token) return;
  await connection.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [createHash('sha256').update(token).digest('hex')]);
}
export function expiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
