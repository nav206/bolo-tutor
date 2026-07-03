import { createLogger } from '../../_logger';

const logger = createLogger('session:summary');
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export async function onRequestGet(context: any): Promise<Response> {
  const sessionId = context.params?.id ?? context.request?.params?.id ?? '';
  const queryId = context.request?.query?.sessionId ?? context.request?.url?.split('sessionId=')?.[1]?.split('&')?.[0] ?? '';
  const resolvedSessionId = sessionId || queryId;

  if (!resolvedSessionId) {
    return jsonResponse({ error: 'session id is required' }, 400);
  }

  try {
    const [vocabRaw, mistakesRaw] = await Promise.all([
      context.store.get(`session:${resolvedSessionId}:vocab`),
      context.store.get(`session:${resolvedSessionId}:mistakes`),
    ]);

    const vocab = vocabRaw ? JSON.parse(vocabRaw) : [];
    const mistakes = mistakesRaw ? JSON.parse(mistakesRaw) : [];
    return jsonResponse({ vocab, mistakes });
  } catch (error) {
    logger.error('[session/summary] failed', error);
    return jsonResponse({ error: 'failed to load summary' }, 500);
  }
}
