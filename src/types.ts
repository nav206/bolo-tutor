export interface TutorCorrectionPayload {
  original: string;
  corrected: string;
  explanation: string;
}

export interface TutorVocabularyEntry {
  word: string;
  translation: string;
  transliteration?: string | null;
}

export interface TutorTurnPayload {
  reply_target_language: string;
  transliteration?: string | null;
  translation_en: string;
  correction: TutorCorrectionPayload | null;
  new_vocab: TutorVocabularyEntry[];
}

export interface TutorMistakeEntry {
  original: string;
  corrected: string;
  explanation: string;
  topic: string;
  timestamp: string;
  repeated: boolean;
}

export interface TutorSummaryPayload {
  vocab: TutorVocabularyEntry[];
  mistakes: TutorMistakeEntry[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /**
   * True while the assistant is actively producing this message
   * (between the first text_delta and the final done/error event).
   * Drives the in-bubble blinking caret to give the user feedback
   * that more content is still streaming. Cleared once done/error fires.
   */
  streaming?: boolean;
  tutorData?: TutorTurnPayload;
}

export interface ToolLampState {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  animKey: number;   // Incremented on each activation to remount and replay animation
}

/**
 * Lightweight summary of a conversation, returned by /conversations.
 * Used to render the left sidebar — does NOT contain full message content.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  preview?: string;
  lastMessageAt?: number;
  createdAt?: number;
  userId?: string;
  messageCount?: number;
}

export interface ListConversationsParams {
  userId: string;
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
  before?: string;
}

export interface ListConversationsResponse {
  conversations: ConversationSummary[];
  nextCursor?: string;
  previousCursor?: string;
}
