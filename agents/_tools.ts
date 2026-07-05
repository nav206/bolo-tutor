/**
 * Agent Tools — private module (starts with _), not mapped as a route.
 */

import { tool } from '@openai/agents';
import { z } from 'zod';

interface StoreLike {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

function buildSessionKey(sessionId: string, suffix: string): string {
  return `session:${sessionId}:${suffix}`;
}

async function readStoredArray(store: StoreLike, key: string): Promise<unknown[]> {
  const raw = await store.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function logCorrectionEntry(
  store: StoreLike,
  { original, corrected, explanation, topic, sessionId }: { original: string; corrected: string; explanation: string; topic: string; sessionId?: string },
) {
  const mistakesKey = sessionId ? buildSessionKey(sessionId, 'mistakes') : 'session:current:mistakes';
  const existing = await readStoredArray(store, mistakesKey);
  const repeated = existing.some(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return record.topic === topic && record.corrected === corrected;
  });
  const entry = { original, corrected, explanation, topic, timestamp: new Date().toISOString(), repeated };
  const next = [...existing, entry];
  await store.set(mistakesKey, JSON.stringify(next));
  return entry;
}

export async function logVocabularyEntry(
  store: StoreLike,
  { word, translation, transliteration, sessionId }: { word: string; translation: string; transliteration?: string | null; sessionId?: string },
) {
  const vocabKey = sessionId ? buildSessionKey(sessionId, 'vocab') : 'session:current:vocab';
  const existing = await readStoredArray(store, vocabKey);
  const next = [...existing, { word, translation, transliteration }];
  await store.set(vocabKey, JSON.stringify(next));
  return next;
}

const logCorrection = tool({
  name: 'log_correction',
  description: 'Store a tutor correction and mark it repeated when the same topic appears again.',
  parameters: z.object({
    original: z.string(),
    corrected: z.string(),
    explanation: z.string(),
    topic: z.string(),
    sessionId: z.string().optional(),
  }),
  execute: ({ original, corrected, explanation, topic, sessionId }, context: unknown) => {
    const store = (context && typeof context === 'object' && 'store' in context && (context as { store?: StoreLike }).store)
      ? (context as { store: StoreLike }).store
      : (context as StoreLike);
    return logCorrectionEntry(store, { original, corrected, explanation, topic, sessionId });
  },
});

const logVocab = tool({
  name: 'log_vocab',
  description: 'Store a new vocabulary item introduced in the tutoring session.',
  parameters: z.object({
    word: z.string(),
    translation: z.string(),
    transliteration: z.string().nullable().optional(),
    sessionId: z.string().optional(),
  }),
  execute: ({ word, translation, transliteration, sessionId }, context: unknown) => {
    const store = (context && typeof context === 'object' && 'store' in context && (context as { store?: StoreLike }).store)
      ? (context as { store: StoreLike }).store
      : (context as StoreLike);
    return logVocabularyEntry(store, { word, translation, transliteration, sessionId });
  },
});

export function createTools() {
  return [logCorrection, logVocab];
}
