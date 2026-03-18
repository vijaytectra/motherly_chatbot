import React, { useEffect } from 'react';

/**
 * Tooltip above the chat button.
 * Fades in on mount, hides after 5s or when dismissed.
 * Triangle pointer toward the button.
 */
export default function TooltipBubble({ visible, onDismiss }) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      onDismiss();
    }, 5000);
    return () => clearTimeout(t);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="tooltip"
      className="
        fixed bottom-24 right-6 z-[9999]
        sm:bottom-28 sm:right-6
        max-w-[220px] sm:max-w-[260px]
        animate-fade-in
        pointer-events-none
      "
    >
      <div
        className="
          bg-gray-700 text-white
          rounded-xl rounded-br-sm
          px-4 py-3
          shadow-lg
        "
      >
        <p className="text-sm font-semibold leading-tight">Need help?</p>
        <p className="text-sm text-gray-200 mt-0.5">Start a conversation</p>
      </div>
      {/* Triangle pointer toward the chat button */}
      <div
        className="
          absolute -bottom-2 right-6
          w-0 h-0
          border-l-[10px] border-l-transparent
          border-r-[10px] border-r-transparent
          border-t-[12px] border-t-gray-700
        "
        aria-hidden
      />
    </div>
  );
}
