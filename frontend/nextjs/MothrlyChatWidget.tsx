"use client";

/**
 * Drop this file into your Motherly Next.js app (e.g. components/MothrlyChatWidget.tsx)
 * and add it to app/layout.tsx inside <body>.
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_MOTHRLY_CHAT_URL=http://localhost:8000
 */

const CHAT_ORIGIN =
  process.env.NEXT_PUBLIC_MOTHRLY_CHAT_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000";

export default function MothrlyChatWidget() {
  const embedSrc = `${CHAT_ORIGIN}/embed`;

  return (
    <iframe
      src={embedSrc}
      title="Mothrly Assistant"
      className="mothrly-chat-embed"
      allow="microphone"
    />
  );
}
