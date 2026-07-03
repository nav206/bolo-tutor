import { z } from 'zod';

export const TutorTurnSchema = z.object({
  reply_target_language: z.string().min(1),
  transliteration: z.string().nullable(),
  translation_en: z.string().min(1),
  correction: z.object({
    original: z.string().min(1),
    corrected: z.string().min(1),
    explanation: z.string().min(1),
  }).nullable(),
  new_vocab: z.array(z.object({
    word: z.string().min(1),
    translation: z.string().min(1),
    transliteration: z.string().nullable(),
  })),
});

export type TutorTurnPayload = z.infer<typeof TutorTurnSchema>;

export interface TutorProfile {
  language: string;
  level: string;
  mode: string;
}

export interface TutorSessionContext {
  vocab: Array<{ word: string; translation: string }>;
  mistakes: Array<{ original: string; corrected: string; explanation: string }>;
}

export function buildTutorInstructions(profile: TutorProfile, sessionContext?: TutorSessionContext): string {
  const language = profile.language || 'Hindi';
  const level = profile.level || 'Beginner';
  const mode = profile.mode || 'Guided';
  const lines: string[] = [
    `You are a warm, direct language tutor for ${language} at ${level} level, in ${mode} mode.`,
    '',
    'Rules:',
    `- Reply primarily in ${language}, matched to ${level} (short/simple for Beginner, natural pace for Advanced).`,
    `- If mode is "Guided", stay inside one realistic scenario until the user wants to switch.`,
    '- If mode is "Free chat", follow whatever the user brings up.',
    '- If the user makes a grammar or vocabulary mistake, correct it briefly and keep the conversation moving.',
    '- Use the previous turns in the conversation to build on what the user already said; do not repeat the same generic prompt every turn.',
    '- Ask one short follow-up question or offer one useful correction so the exchange feels alive and adaptive.',
    '- Never fully switch to English unless the user explicitly asks for help or seems lost.',
    '- Always return a JSON object matching the schema exactly, with no extra prose before or after it.',
  ];

  if (sessionContext) {
    const hasVocab = Array.isArray(sessionContext.vocab) && sessionContext.vocab.length > 0;
    const hasMistakes = Array.isArray(sessionContext.mistakes) && sessionContext.mistakes.length > 0;
    if (hasVocab || hasMistakes) {
      lines.push('');
      lines.push('Session context (what has already been covered):');
      if (hasVocab) {
        const vocabStr = sessionContext.vocab.map(v => `"${v.word} — ${v.translation}"`).join(', ');
        lines.push(`- Vocab already taught: ${vocabStr}`);
      }
      if (hasMistakes) {
        const mistakesStr = sessionContext.mistakes.map(m => `"${m.original} → ${m.corrected} (${m.explanation})"`).join(', ');
        lines.push(`- Corrections already made: ${mistakesStr}`);
      }
      lines.push('- Do NOT re-teach words or corrections listed above; build on the conversation so far and introduce new material or deepen existing topics.');
    }
  }

  lines.push('');
  lines.push('Return this shape exactly:');
  lines.push(JSON.stringify({
    reply_target_language: 'A short reply in the target language.',
    transliteration: 'Optional transliteration for Hindi/Nepali/Urdu/Bengali, or null for Spanish.',
    translation_en: 'English translation of the reply.',
    correction: {
      original: 'The user phrase with the mistake, or null if no correction is needed.',
      corrected: 'The corrected version.',
      explanation: 'A one-line plain-language explanation.',
    },
    new_vocab: [
      { word: 'Example word', translation: 'English meaning', transliteration: 'Optional transliteration' },
    ],
  }, null, 2));

  return lines.join('\n');
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseTutorTurn(raw: string): TutorTurnPayload | null {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    return TutorTurnSchema.parse(parsed);
  } catch {
    return null;
  }
}
