import { ZodError } from 'zod';
import { handle } from '@/lib/commerce';

export const dynamic = 'force-dynamic';

async function route(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const { path } = await ctx.params;
    const result = await handle(req, path);
    if (result instanceof Response) return result;
    return Response.json({ success: true, data: result }, { headers });
  } catch (error: unknown) {
    const validation = error instanceof ZodError;
    const explicitStatus = error instanceof Error && 'status' in error ? error.status : undefined;
    const status = typeof explicitStatus === 'number' && explicitStatus >= 400 && explicitStatus <= 599
      ? explicitStatus : validation ? 422 : error instanceof SyntaxError ? 400 : 500;
    const message = validation
      ? error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ')
      : status === 500 || !(error instanceof Error) ? '服务暂时不可用，请稍后重试' : error.message;
    return Response.json({ success: false, error: { code: status, message } }, { status, headers });
  }
}

export const GET = route, POST = route, PATCH = route, DELETE = route;
