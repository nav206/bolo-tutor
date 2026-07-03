import { memo } from 'react';
import type { Message } from '../types';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useT } from '../i18n';
import styles from './ChatBubble.module.css';

interface Props {
  message: Message;
}

/**
 * Some LLMs (especially fast/streaming tiers) emit Markdown tables as a
 * single squashed line — the `|` row boundaries arrive without the line
 * breaks GFM needs to recognise the block as a table. Result: react-markdown
 * just renders pipes as plain text.
 *
 * The two helpers below split a "| ... | | --- | --- | | a | b |" line back
 * into one row per line — but only when the second logical row is the
 * `| --- | --- |` separator (so this can't fire on prose that happens to
 * contain a pipe). Code fences are passed through verbatim so we don't
 * mangle inline shell snippets like `ls | grep foo`.
 */
const TABLE_ROW_BOUNDARY = /\|\s+\|/g;
const TABLE_SEPARATOR_ROW = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function normalizeCompactTableLine(line: string): string {
  if (!line.includes('| |')) return line;

  const pipeIndexes = [...line.matchAll(/\|/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  for (const index of pipeIndexes) {
    const table = line.slice(index);
    const normalizedTable = table.replace(TABLE_ROW_BOUNDARY, '|\n|');
    const rows = normalizedTable
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);

    if (rows.length >= 2 && TABLE_SEPARATOR_ROW.test(rows[1])) {
      const prefix = line.slice(0, index).trimEnd();
      return prefix ? `${prefix}\n${normalizedTable}` : normalizedTable;
    }
  }

  return line;
}

function normalizeMarkdown(content: string): string {
  let inCodeFence = false;

  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      return inCodeFence ? line : normalizeCompactTableLine(line);
    })
    .join('\n');
}

export default memo(function ChatBubble({ message }: Props) {
  const { lang } = useT();
  const isUser = message.role === 'user';

  if (!isUser && !message.content) return null;

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.botRow}`}>
      {!isUser && <div className={styles.avatar}>⬡</div>}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.botBubble}`}>
        {isUser ? (
          message.content
        ) : (
          <>
            <div className={`${styles.markdown} ${message.streaming ? styles.markdownStreaming : ''}`}>
              <Markdown remarkPlugins={[remarkGfm]}>{normalizeMarkdown(message.content)}</Markdown>
            </div>
            {message.tutorData ? (
              <div className={styles.tutorLayer}>
                {message.tutorData.transliteration ? (
                  <div className={styles.tutorMeta}><strong>Transliteration:</strong> {message.tutorData.transliteration}</div>
                ) : null}
                <div className={styles.tutorMeta}><strong>English:</strong> {message.tutorData.translation_en}</div>
                {message.tutorData.correction ? (
                  <div className={styles.correctionBox}>
                    <div><strong>Correction:</strong> {message.tutorData.correction.original} → {message.tutorData.correction.corrected}</div>
                    <div className={styles.correctionHint}>{message.tutorData.correction.explanation}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <span className={styles.time}>
          {new Date(message.timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && <div className={`${styles.avatar} ${styles.userAvatar}`}>U</div>}
    </div>
  );
});
