import { createLogger } from '../../_logger';

const logger = createLogger('session:start');
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function readJsonBody(context: any): Record<string, unknown> {
  try {
    const body = context.request?.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function pickString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function onRequestPost(context: any): Promise<Response> {
  const body = readJsonBody(context);
  const language = pickString(body, 'language');
  const level = pickString(body, 'level');
  const mode = pickString(body, 'mode');

  if (!language || !level || !mode) {
    return jsonResponse({ error: 'language, level, and mode are required' }, 400);
  }

  const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const profile = { language, level, mode };

  try {
    await context.store.set(`session:${sessionId}:profile`, JSON.stringify(profile));
    logger.log(`[session/start] created ${sessionId}`);
    return jsonResponse({ sessionId, profile });
  } catch (error) {
    logger.error('[session/start] failed', error);
    return jsonResponse({ error: 'failed to create session profile' }, 500);
  }
}
