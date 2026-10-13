import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthUser } from './auth';
import { getSessionUserFromToken, SESSION_COOKIE_NAME } from './auth';
import { ensureDatabase, getPool } from './database';

export async function requireAuthenticatedUser(): Promise<AuthUser> {
  const pool = getPool();
  await ensureDatabase(pool);
  const cookieStore = await cookies();
  const user = await getSessionUserFromToken(cookieStore.get(SESSION_COOKIE_NAME)?.value, pool);
  if (!user) redirect('/login');
  return user;
}