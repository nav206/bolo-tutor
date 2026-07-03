import { useCallback, useMemo, useRef, useState } from 'react';
import type { Message, TutorSummaryPayload, TutorTurnPayload } from './types';
import { getSessionSummary, sendMessageStream, startSession, stopAgent } from './api';
import ChatInput from './components/ChatInput';
import ChatWindow from './components/ChatWindow';
import { I18nProvider, LangToggle } from './i18n';
import styles from './App.module.css';

type Screen = 'setup' | 'chat' | 'summary';

const INITIAL_PROFILE = {
  language: 'Hindi',
  level: 'Beginner',
  mode: 'Guided',
};

export default function App() {
  return (
    <I18nProvider>
      <LangToggle />
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [summary, setSummary] = useState<TutorSummaryPayload>({ vocab: [], mistakes: [] });
  const [progress, setProgress] = useState({ vocabCount: 0, mistakeCount: 0 });
  const [status, setStatus] = useState('Pick a language and begin a short tutor session.');
  const [sessionError, setSessionError] = useState('');
  const botMsgIdRef = useRef<string>('');
  const abortCtrlRef = useRef<AbortController | null>(null);

  const updateBotMessage = useCallback((updater: (content: string) => string) => {
    setMessages(prev => prev.map(message => (message.id === botMsgIdRef.current ? { ...message, content: updater(message.content) } : message)));
  }, []);

  const clearBotStreaming = useCallback(() => {
    setMessages(prev => prev.map(message => (message.id === botMsgIdRef.current ? { ...message, streaming: undefined } : message)));
  }, []);

  const handleStartSession = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setSessionError('');
    setStatus('Starting your tutor session...');
    try {
      const created = await startSession(profile);
      setSessionId(created.sessionId);
      setConversationId(crypto.randomUUID());
      setMessages([]);
      setProgress({ vocabCount: 0, mistakeCount: 0 });
      setSummary({ vocab: [], mistakes: [] });
      setScreen('chat');
      setStatus(`Session ready for ${profile.language} (${profile.level}, ${profile.mode}).`);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not start the session.');
      setStatus('The tutor session could not be started.');
    }
  }, [profile]);

  const handleSend = useCallback(async (text: string) => {
    if (!sessionId) {
      setSessionError('Start a session before chatting.');
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const botId = crypto.randomUUID();
    botMsgIdRef.current = botId;
    const botMessage: Message = {
      id: botId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setMessages(prev => [...prev, userMessage, botMessage]);
    setLoading(true);
    setStatus('The tutor is streaming a reply...');

    const ctrl = sendMessageStream(text, {
      onTextDelta(delta) {
        updateBotMessage(content => content + delta);
      },
      onToolCalled() {
        setStatus('The tutor is updating your lesson notes...');
      },
      onAssistantTurn(turn: TutorTurnPayload) {
        setMessages(prev => prev.map(message => (message.id === botId ? { ...message, tutorData: turn } : message)));
      },
      onProgressUpdate(payload) {
        setProgress(payload);
      },
      onDone() {
        clearBotStreaming();
        setLoading(false);
        setStatus('Your tutor reply is ready.');
      },
      onError(err) {
        clearBotStreaming();
        updateBotMessage(content => content || `The tutor hit an error: ${err.message}`);
        setLoading(false);
        setStatus('The tutor hit an error.');
      },
    }, conversationId, {
      sessionId,
      profile,
    });

    abortCtrlRef.current = ctrl;
  }, [clearBotStreaming, profile, sessionId, updateBotMessage]);

  const handleStop = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    setLoading(false);
    setStatus('The tutor stream was stopped.');
    void stopAgent(conversationId);
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setProgress({ vocabCount: 0, mistakeCount: 0 });
    setSummary({ vocab: [], mistakes: [] });
    setSessionId('');
    setConversationId('');
    setScreen('setup');
    setStatus('Pick a language and begin a short tutor session.');
    setSessionError('');
  }, []);

  const handleEndSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const nextSummary = await getSessionSummary(sessionId);
      setSummary(nextSummary);
      setScreen('summary');
      setStatus('Session summary ready.');
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not load the summary.');
    }
  }, [sessionId]);

  const progressSummary = useMemo(() => `${progress.vocabCount} vocab · ${progress.mistakeCount} corrections`, [progress]);

  return (
    <div className={styles.shell}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.stage}>
        <div className={styles.leftPanel}>
          <div className={styles.heroCard}>
            <p className={styles.eyebrow}>Bolo</p>
            <h1>Conversational language tutor</h1>
            <p>Practice Hindi, Nepali, Urdu, Bengali, or Spanish with live corrections and a session log.</p>
          </div>

          {screen === 'setup' ? (
            <form className={styles.panelCard} onSubmit={handleStartSession}>
              <label className={styles.fieldLabel}>
                Language
                <select
                  value={profile.language}
                  onChange={event => setProfile(prev => ({ ...prev, language: event.target.value }))}
                  className={styles.select}
                >
                  <option value="Hindi">Hindi</option>
                  <option value="Nepali">Nepali</option>
                  <option value="Urdu">Urdu</option>
                  <option value="Bengali">Bengali</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </label>

              <div className={styles.fieldLabel}>Level</div>
              <div className={styles.radioRow}>
                {['Beginner', 'Intermediate', 'Advanced'].map(level => (
                  <label key={level} className={styles.radioOption}>
                    <input
                      type="radio"
                      name="level"
                      value={level}
                      checked={profile.level === level}
                      onChange={() => setProfile(prev => ({ ...prev, level }))}
                    />
                    <span>{level}</span>
                  </label>
                ))}
              </div>

              <div className={styles.fieldLabel}>Mode</div>
              <div className={styles.toggleRow}>
                {['Guided', 'Free chat'].map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={profile.mode === mode ? styles.toggleActive : styles.toggle}
                    onClick={() => setProfile(prev => ({ ...prev, mode }))}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button className={styles.primaryButton} type="submit">Start session</button>
              {sessionError ? <p className={styles.errorText}>{sessionError}</p> : null}
            </form>
          ) : (
            <div className={styles.panelCard}>
              <div className={styles.statusRow}>
                <div>
                  <div className={styles.statusLabel}>Current session</div>
                  <div className={styles.statusValue}>{profile.language} · {profile.level} · {profile.mode}</div>
                </div>
                <div className={styles.progressBadge}>{progressSummary}</div>
              </div>
              <div className={styles.statusText}>{status}</div>
              <div className={styles.inlineActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setScreen('setup')}>
                  Back to setup
                </button>
                <button type="button" className={styles.secondaryButton} onClick={handleEndSession} disabled={!sessionId || loading}>
                  End session
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.chatPanel}>
          {screen === 'summary' ? (
            <div className={styles.summaryPanel}>
              <div className={styles.summaryHeader}>
                <div>
                  <p className={styles.eyebrow}>Session summary</p>
                  <h2>{profile.language} session</h2>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={() => setScreen('chat')}>Back to chat</button>
              </div>
              <div className={styles.summaryGrid}>
                <section className={styles.summaryCard}>
                  <h3>Vocab learned</h3>
                  {summary.vocab.length === 0 ? <p>No vocab logged yet.</p> : (
                    <ul>
                      {summary.vocab.map(item => (
                        <li key={`${item.word}-${item.translation}`}>
                          <strong>{item.word}</strong> — {item.translation}
                          {item.transliteration ? ` · ${item.transliteration}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className={styles.summaryCard}>
                  <h3>Mistakes made</h3>
                  {summary.mistakes.length === 0 ? <p>No corrections logged yet.</p> : (
                    <ul>
                      {summary.mistakes.map((item, index) => (
                        <li key={`${item.original}-${index}`}>
                          <strong>{item.original}</strong> → {item.corrected}
                          {item.repeated ? <span className={styles.repeatedBadge}>Repeated</span> : null}
                          <div className={styles.mistakeExplanation}>{item.explanation}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          ) : (
            <>
              <ChatWindow messages={messages} loading={loading} />
              <ChatInput onSend={handleSend} onStop={handleStop} onClear={handleClear} disabled={loading || !sessionId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
