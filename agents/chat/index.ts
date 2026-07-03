/**
 * Agent handler — EdgeOne Makers
 * ========================================
 *
 * File path agents/chat/index.ts maps to **POST /chat**
 * (EdgeOne Makers routing convention: directory name = route, index = default entry)
 *
 * Files starting with _ (e.g. _tools.ts, _sse.ts) are private modules,
 * not mapped as public routes.
 *
 * context convention:
 *   context.request.body    — object, request body
 *   context.request.signal  — AbortSignal, set when /chat/stop is called
 *   conversation_id — conversation ID
 *   context.runId           — current run ID
 */

import OpenAI from 'openai';
import { run, Agent, OpenAIChatCompletionsModel, type Session } from '@openai/agents';
import { createLogger } from '../_logger';
import { createTools, logCorrectionEntry, logVocabularyEntry } from '../_tools';
import { sseResponse } from '../_sse';
import { buildTutorInstructions, parseTutorTurn } from '../_tutor';

const logger = createLogger('chat');
const DEFAULT_MODEL = '@makers/deepseek-v4-flash';

async function getSessionProfile(context: any, body: Record<string, unknown>) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (sessionId) {
    try {
      const raw = await context.store.get(`session:${sessionId}:profile`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            language: typeof parsed.language === 'string' ? parsed.language : 'Hindi',
            level: typeof parsed.level === 'string' ? parsed.level : 'Beginner',
            mode: typeof parsed.mode === 'string' ? parsed.mode : 'Guided',
          };
        }
      }
    } catch {
      // fall back below
    }
  }

  return {
    language: typeof body.language === 'string' ? body.language : 'Hindi',
    level: typeof body.level === 'string' ? body.level : 'Beginner',
    mode: typeof body.mode === 'string' ? body.mode : 'Guided',
  };
}

export async function onRequest(context: any) {
  const body = context.request.body ?? {};
  const message = body.message as string | undefined;
  if (!message) {
    return new Response(
      JSON.stringify({ error: "'message' is required" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Accept both camelCase (chat handler historical convention) and snake_case
  // (cloud-functions convention) as a body field name for the user id.
  const rawUserId = typeof body.userId === 'string'
    ? body.userId
    : (typeof body.user_id === 'string' ? body.user_id : '');
  const userId = rawUserId.trim() || undefined;
  const userMsgId = typeof body.userMsgId === 'string' ? body.userMsgId : undefined;

  const conversationId: string = context.conversation_id ?? '';
  const signal: AbortSignal | undefined = context.request.signal;

  logger.log(`[request] cid=${conversationId}, uid=${userId ?? '-'}, message="${message.slice(0, 50)}..."`);

  // Write a user-indexed copy of the user message so /conversations
  // (which scans the user_conversation_index prefix) can list this thread.
  // The OpenAI Agents SDK Session adapter does NOT pass user_id when it
  // persists turns, so without this manual write the user index stays
  // empty and listConversations({userId}) returns []. The duplicate is
  // filtered out of /history because that route already drops items
  // marked with metadata.agent_sdk_session.
  if (userId && conversationId) {
    try {
      const appendArgs: Record<string, unknown> = {
        conversationId,
        role: 'user',
        content: message,
        userId,
      };
      if (userMsgId) appendArgs.messageId = userMsgId;
      await context.store.appendMessage(appendArgs);
    } catch (e) {
      // Non-fatal — chat itself should keep working even if the
      // user-index write fails.
      logger.error('[chat] failed to write user index:', e);
    }
  }

  // Use built-in store session adapter for persistence
  const session: Session | undefined = conversationId
    ? context.store.openaiSession(conversationId)
    : undefined;

  // Configure the OpenAI-compatible LLM model directly from runtime env.
  const env = context.env as Record<string, string | undefined>;
  const llmClient = new OpenAI({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: env.AI_GATEWAY_BASE_URL,
  });
  const model = new OpenAIChatCompletionsModel(
    llmClient,
    env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL,
  );

  const profile = await getSessionProfile(context, body as Record<string, unknown>);
  const agentInstructions = buildTutorInstructions(profile);
  const agent = new Agent({
    name: 'TutorAgent',
    instructions: agentInstructions,
    tools: createTools(),
    model,
  });

  return sseResponse(
    async function* () {
      const lowered = message.toLowerCase();
      const isAbuse = /(fuck|shit|bitch|idiot|asshole|damn)/.test(lowered);
      if (isAbuse) {
        const fallback = {
          reply_target_language: 'Let’s keep this respectful. Try a simple question in the language you are practicing.',
          transliteration: null,
          translation_en: 'Let’s keep this respectful. Try a simple question in the language you are practicing.',
          correction: null,
          new_vocab: [],
        };
        yield { event: 'assistant_turn', data: fallback };
        yield { event: 'progress_update', data: { vocabCount: 0, mistakeCount: 0 } };
        return;
      }

      const result = await run(agent, message, { stream: true, signal, session });
      let rawText = '';
      for await (const event of result.toStream()) {
        if (signal?.aborted) break;
        if (event.type === 'raw_model_stream_event' && event.data?.type === 'output_text_delta') {
          const delta = event.data.delta as string;
          rawText += delta;
          logger.log(`[stream] text_delta: ${JSON.stringify(delta)}`);
          yield { event: 'text_delta', data: { delta } };
        }
        if (event.type === 'run_item_stream_event' && event.name === 'tool_called') {
          const tool = event.item?.name ?? event.item?.rawItem?.name;
          if (tool) {
            logger.log(`[stream] tool_called: ${tool}`);
            yield { event: 'tool_called', data: { tool } };
          }
        }
      }

      const parsedTurn = parseTutorTurn(rawText) ?? {
        reply_target_language: 'I am ready to help you practice. Try a short sentence in the target language.',
        transliteration: null,
        translation_en: 'I am ready to help you practice. Try a short sentence in the target language.',
        correction: null,
        new_vocab: [],
      };

      yield { event: 'assistant_turn', data: parsedTurn };

      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const store = context.store;
      if (sessionId && parsedTurn.correction) {
        await logCorrectionEntry(store, {
          original: parsedTurn.correction.original,
          corrected: parsedTurn.correction.corrected,
          explanation: parsedTurn.correction.explanation,
          topic: profile.language,
          sessionId,
        });
      }
      if (sessionId && parsedTurn.new_vocab.length > 0) {
        await logVocabularyEntry(store, {
          word: parsedTurn.new_vocab[0].word,
          translation: parsedTurn.new_vocab[0].translation,
          transliteration: parsedTurn.new_vocab[0].transliteration,
          sessionId,
        });
      }

      const [vocabRaw, mistakesRaw] = await Promise.all([
        store.get(`session:${sessionId}:vocab`),
        store.get(`session:${sessionId}:mistakes`),
      ]);
      const vocab = vocabRaw ? JSON.parse(vocabRaw) : [];
      const mistakes = mistakesRaw ? JSON.parse(mistakesRaw) : [];
      yield { event: 'progress_update', data: { vocabCount: Array.isArray(vocab) ? vocab.length : 0, mistakeCount: Array.isArray(mistakes) ? mistakes.length : 0 } };
    },
    { signal, logger },
  );
}
