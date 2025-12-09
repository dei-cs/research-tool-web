'use client';
import {SYSTEM_PROMPTS, SystemPromptId, SystemPromptOption} from '../app/api/config/system-prompts';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

// "server" = prompt coming from /api/config/prompts
type PromptSourceId = 'server' | SystemPromptId;

const FALLBACK_PROMPT = 'You are a helpful assistant. Keep replies brief unless asked for detail.';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemMessageLoaded, setSystemMessageLoaded] = useState(false);
  const [serverSystemPrompt, setServerSystemPrompt] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<PromptSourceId>('server');

  const viewportRef = useRef<HTMLDivElement>(null);

  // Helper: ensure there is exactly one system message at the top
const applySystemPrompt = (content: string) => {
  setMessages((prev) => {
    const rest = prev.filter((m) => m.role !== 'system');
    return [{ role: 'system', content }, ...rest];
  });
};



  // Load system message from config on mount
 useEffect(() => {
  const loadSystemMessage = async () => {
    try {
      const response = await fetch('/api/config/prompts');
      if (response.ok) {
        const data = await response.json();
        setServerSystemPrompt(data.system_message || FALLBACK_PROMPT);
      } else {
        setServerSystemPrompt(FALLBACK_PROMPT);
      }
    } catch (error) {
      console.error('Failed to load system message', error);
      setServerSystemPrompt(FALLBACK_PROMPT);
    }
  };

  loadSystemMessage();
}, []);



useEffect(() => {
  if (selectedPromptId === 'server') {
    if (!serverSystemPrompt) return; // still loading
    applySystemPrompt(serverSystemPrompt);
    setSystemMessageLoaded(true);
    return;
  }

  const option = SYSTEM_PROMPTS.find((p) => p.id === selectedPromptId);
  if (!option) return;

  applySystemPrompt(option.content);
  setSystemMessageLoaded(true);
}, [selectedPromptId, serverSystemPrompt]);



  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const userText = input.trim();
    if (!userText || isStreaming || !systemMessageLoaded) return;

    const nextMessages = [...messages, { role: 'user' as const, content: userText }];
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);

    try {
      // Start request
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || 'Network error');
      }

      // Create a placeholder assistant message we’ll stream tokens into
      let assistant = { role: 'assistant' as const, content: '' };
      setMessages((prev) => [...prev, assistant]);

      // Read SSE: lines begin with "data: ..."
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim(); // after "data:"
          if (payload === '[DONE]') {
            break;
          }

          try {
            const json = JSON.parse(payload);
            const token = json.choices?.[0]?.delta?.content ?? '';
            if (token) {
              assistant = { ...assistant, content: assistant.content + token };
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = assistant;
                return copy;
              });
            }
          } catch {
            // ignore non-JSON keep-alives
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setIsStreaming(false);
    }
  }

  return (
      <div className="flex flex-col gap-4">
    {/* System prompt selector */}
    <div className="flex items-center gap-2">
      <label
        htmlFor="system-prompt"
        className="text-sm text-muted-foreground"
      >
        System prompt
      </label>
      <select
        id="system-prompt"
        className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground"
        value={selectedPromptId}
        onChange={(e) =>
          setSelectedPromptId(e.target.value as PromptSourceId)
        }
        disabled={!serverSystemPrompt && selectedPromptId === 'server'}
      >
        <option value="server">From config (API)</option>
        {SYSTEM_PROMPTS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
      <div
        ref={viewportRef}
        className="h-[60vh] overflow-auto rounded-2xl border border-border bg-card text-card-foreground p-4 shadow-sm"
      >
        {!systemMessageLoaded ? (
          <div className="text-sm text-muted-foreground text-center py-4">Loading configuration...</div>
        ) : (
          <>
            {messages
              .filter((m) => m.role !== 'system')
              .map((m, i) => (
                <div
                  key={i}
                  className={clsx(
                    'mb-3 rounded-xl px-3 py-2 whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-secondary text-secondary-foreground self-end'
                      : 'bg-primary/10 text-foreground'
                  )}
                >
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    {m.role}
                  </div>
                  <div className="text-sm">{m.content}</div>
                </div>
              ))}
            {isStreaming && (
              <div className="text-xs text-muted-foreground animate-pulse">thinking…</div>
            )}
          </>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-input bg-background text-foreground px-3 py-2 shadow-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Ask something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming || !systemMessageLoaded}
        />

        <button
          className="rounded-xl bg-primary text-primary-foreground px-4 py-2 shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          disabled={isStreaming || !input.trim() || !systemMessageLoaded}
        >
          Send
        </button>
      </form>


      {error && (
        <div className="text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
