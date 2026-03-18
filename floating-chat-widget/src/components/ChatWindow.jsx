import React, { useState, useRef, useEffect } from 'react';

const BOT_NAME = 'Assistant';

/**
 * Chat window: header (bot name + close), scrollable messages, input with send + optional mic.
 * User messages right, bot messages left. Slide-up animation.
 */
export default function ChatWindow({ open, onClose, apiBaseUrl = '' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setSending(true);

    try {
      const base = apiBaseUrl || '';
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'bot', content: data.response }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'bot', content: "Sorry, I couldn't reach the server. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };

  if (!open) return null;

  return (
    <div
      className="
        fixed bottom-24 right-6 z-[9999]
        w-[350px] max-w-[calc(100vw-48px)] h-[500px] max-h-[calc(100vh-120px)]
        flex flex-col
        bg-white rounded-t-xl rounded-l-xl
        shadow-xl
        animate-slide-up
        overflow-hidden
      "
      role="dialog"
      aria-label="Chat window"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 text-white shadow">
        <span className="font-semibold text-base">{BOT_NAME}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">Send a message to start the conversation.</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[85%] rounded-2xl px-4 py-2 text-sm
                ${msg.role === 'user'
                  ? 'bg-[#E53935] text-white rounded-br-md'
                  : 'bg-white text-gray-800 shadow rounded-bl-md border border-gray-100'}
              `}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-bl-md px-4 py-2 shadow border border-gray-100">
              <span className="text-gray-400 text-sm">...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={sending}
          className="
            flex-1 min-w-0 px-4 py-2.5 rounded-full
            border border-gray-300 focus:border-[#E53935] focus:ring-1 focus:ring-[#E53935]
            text-sm outline-none transition
          "
        />
        <button
          type="button"
          aria-label="Voice input"
          className="
            w-10 h-10 rounded-full flex items-center justify-center
            text-gray-500 hover:bg-gray-100 transition-colors
          "
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send message"
          className="
            w-10 h-10 rounded-full flex items-center justify-center
            bg-[#E53935] text-white hover:bg-chat-red-dark
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
