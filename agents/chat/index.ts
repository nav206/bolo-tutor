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
import { createTools } from '../_tools';
import { sseResponse } from '../_sse';

const logger = createLogger('chat');
const DEFAULT_MODEL = '@makers/deepseek-v4-flash';

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

  // Create OpenAI Agent
  const agent = new Agent({
    name: 'Assistant',
    instructions:
      'You are an EdgeOne Makers OpenAI Agents SDK (TypeScript) starter example: an out-of-the-box Agent template that helps developers quickly run through and validate platform capabilities.\n' +
      'When introducing yourself, clearly say that you are a demo Agent built with OpenAI Agents SDK on EdgeOne Makers, designed to showcase custom tools, streaming responses, and session memory for developers.\n' +
      'Use the four custom tools when they help you answer the user concretely. Otherwise answer directly and keep the response brief.',
    tools: createTools(),
    model: model,
  });

  // Map an SDK stream event to a business SSE event, or null to skip.
  const toSseEvent = (e: any) => {
    if (e.type === 'raw_model_stream_event' && e.data?.type === 'output_text_delta') {
      const delta = e.data.delta as string;
      logger.log(`[stream] text_delta: ${JSON.stringify(delta)}`);
      return { event: 'text_delta', data: { delta } };
    }
    if (e.type === 'run_item_stream_event' && e.name === 'tool_called') {
      const tool = e.item?.name ?? e.item?.rawItem?.name;
      if (tool) {
        logger.log(`[stream] tool_called: ${tool}`);
        return { event: 'tool_called', data: { tool } };
      }
    }
    return null;
  };

  // Convert SDK stream events into business SSE events.
  return sseResponse(
    async function* () {
      const result = await run(agent, message, { stream: true, signal, session });
      for await (const event of result.toStream()) {
        if (signal?.aborted) break;
        const sse = toSseEvent(event);
        if (sse) yield sse;
      }
    },
    { signal, logger },
  );
}
