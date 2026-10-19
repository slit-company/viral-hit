import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { PublicationAccountError } from '@/core/publishing/account-contract';
import { RequestBodyTooLargeError } from '@/lib/request-body-limit';

export const accountHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export const accountNonce = /^[a-zA-Z0-9_-]{43,128}$/;
export function accountCookiePolicy(provider: 'youtube' | 'instagram') {
  const path = provider === 'youtube' ? '/api/app/publishing/youtube/callback' : '/api/app/publishing/instagram';
  return {
    cookieName: (state: string) => `vh-publishing-${provider === 'instagram' ? 'instagram-' : ''}${createHash('sha256').update(state).digest('hex').slice(0, 24)}`,
    cookie: (name: string, value: string, secure: boolean, age: number) => `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`,
    binding(request: Request, name: string) {
      const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
      const value = values.length === 1 ? values[0].slice(name.length + 1) : '';
      if (!accountNonce.test(value)) throw new PublicationAccountError('invalid-callback');
      return value;
    },
  };
}
export function accountErrorResponse(error: unknown) {
  const issue = error instanceof PublicationAccountError ? error.code : error instanceof ZodError ? 'invalid-request' : error instanceof RequestBodyTooLargeError ? 'request-too-large' : 'temporarily-unavailable';
  const status = issue === 'request-too-large' ? 413 : ['configuration', 'busy', 'vault-unavailable', 'temporarily-unavailable'].includes(issue) ? 503 : issue === 'invalid-callback' ? 409 : 400;
  return Response.json({ error: `Publishing account: ${issue}`, issue }, { status, headers: accountHeaders });
}
