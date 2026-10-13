export type AuthPage = '/login' | '/register';

export async function readAuthPayload(request: Request): Promise<{
  input: Record<string, unknown> | null;
  wantsJson: boolean;
}> {
  const wantsJson = request.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = wantsJson ? await request.json() : await request.formData();

  if (payload instanceof FormData) {
    return {
      wantsJson,
      input: {
        username: payload.get('username'),
        email: payload.get('email'),
        identifier: payload.get('identifier'),
        password: payload.get('password'),
        confirmPassword: payload.get('confirmPassword'),
      },
    };
  }
  return {
    wantsJson,
    input: payload && typeof payload === 'object' ? payload as Record<string, unknown> : null,
  };
}

export function authErrorResponse(
  request: Request,
  page: AuthPage,
  code: string,
  status: number,
  message: string,
): Response {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ error: message }, { status });
  }

  const destination = new URL(page, request.url);
  destination.searchParams.set('error', code);
  return new Response(null, { status: 303, headers: { Location: destination.toString() } });
}

export function authSuccessResponse(
  request: Request,
  user: { id: number; username: string; role: 'user' | 'admin' },
  cookie: string,
): Response {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ user }, { headers: { 'Set-Cookie': cookie } });
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(user.role === 'admin' ? '/admin' : '/', request.url).toString(),
      'Set-Cookie': cookie,
    },
  });
}