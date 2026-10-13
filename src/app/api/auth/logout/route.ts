import { deleteSession, expiredSessionCookie } from '@/lib/auth';
import { getPool } from '@/lib/database';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    await deleteSession(request, getPool());
  } catch (error) {
    console.error('Logout error:', error instanceof Error ? error.message : 'Unknown error');
  }

  return new Response(null, {
    status: 303,
    headers: {
      // Use a relative path so the browser keeps the current working host.
      // request.url may contain 0.0.0.0, which is not a browser destination.
      Location: '/login',
      'Set-Cookie': expiredSessionCookie(),
    },
  });
}
