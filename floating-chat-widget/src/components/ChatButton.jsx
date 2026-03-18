import React from 'react';

const CHAT_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-white"
    aria-hidden
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

/**
 * Floating chat button: circular, red, with white chat icon.
 * Hover scale effect. Positioned bottom-right.
 */
export default function ChatButton({ onClick, 'aria-label': ariaLabel = 'Open chat' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="
        fixed bottom-6 right-6 z-[9998]
        w-14 h-14 sm:w-16 sm:h-16
        rounded-full
        bg-[#E53935] hover:bg-chat-red-dark
        text-white
        shadow-lg hover:shadow-xl
        transition-all duration-200 ease-out
        hover:scale-110 active:scale-95
        flex items-center justify-center
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#E53935]
      "
    >
      {CHAT_ICON}
    </button>
  );
}
