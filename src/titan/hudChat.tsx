import { useEffect, useRef, type RefObject } from 'react';
import { sayInRealm, useRealm } from './session';

const VISIBLE = 8;

/** Zone chat. Enter focuses the field, Enter again sends, Escape hands the keyboard back to the game. */
export function TitanChat({ solo, inputRef }: { solo: boolean; inputRef: RefObject<HTMLInputElement> }) {
  const chat = useRealm(s => s.chat);
  const log = useRef<HTMLOListElement>(null);
  const lines = chat.slice(-VISIBLE);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [chat.length]);
  return <section className="titan-card titan-chat" aria-label="Zone chat">
    <span className="titan-eyebrow">ZONE CHAT</span>
    <ol ref={log} className="titan-chat-log">
      {lines.map((line, index) => <li key={line.id} style={{ opacity: 0.45 + (0.55 * (index + 1)) / lines.length }}>
        <b className={line.self ? 'titan-chat-self' : undefined}>{line.from}:</b> {line.text}
      </li>)}
    </ol>
    <form onSubmit={event => {
      event.preventDefault();
      const field = inputRef.current;
      if (!field) return;
      sayInRealm(field.value);
      field.value = '';
      field.blur();
    }}>
      <input ref={inputRef} type="text" maxLength={140} placeholder="Enter to chat…" aria-label="Say something in this zone"
        onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.value = ''; event.currentTarget.blur(); } }} />
    </form>
    {solo && <small>Chat reaches other players on a realm.</small>}
  </section>;
}
