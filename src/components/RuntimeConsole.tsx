import { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

/** On-screen console showing messages emitted by Print nodes during Play. */
export function RuntimeConsole() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const log = useEditorStore((state) => state.runtimeLog);
  const clearRuntimeLog = useEditorStore((state) => state.clearRuntimeLog);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [log]);

  if (!isPlaying || log.length === 0) return null;

  return (
    <div className="runtime-console">
      <div className="runtime-console-header">
        <Terminal size={12} aria-hidden />
        <span>Console</span>
        <button title="Clear" onClick={clearRuntimeLog}>
          <X size={12} aria-hidden />
        </button>
      </div>
      <div className="runtime-console-body" ref={bodyRef}>
        {log.map((line, index) => (
          <div key={index} className="runtime-console-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
