import React, { useState, useCallback } from 'react';
import ChatButton from './components/ChatButton';
import TooltipBubble from './components/TooltipBubble';
import ChatWindow from './components/ChatWindow';

/**
 * Floating chat widget: button, tooltip (once), and chat window.
 * - Tooltip shows on load, fades in, hides after 5s or when chat is opened.
 * - Tooltip does not show again after user has opened the chat.
 * - Chat toggles on button click. Responsive (mobile-friendly).
 */
export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(true);
  const [userHasOpenedChat, setUserHasOpenedChat] = useState(false);

  const toggleChat = useCallback(() => {
    setChatOpen((prev) => !prev);
    if (!userHasOpenedChat) {
      setUserHasOpenedChat(true);
      setTooltipVisible(false);
    }
  }, [userHasOpenedChat]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const dismissTooltip = useCallback(() => {
    setTooltipVisible(false);
  }, []);

  // Only show tooltip if we haven't opened chat yet
  const showTooltip = tooltipVisible && !userHasOpenedChat;

  return (
    <>
      {/* Demo page content - replace with your own or remove when embedding */}
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
        <p className="text-gray-500 text-center max-w-sm">
          Floating chat widget demo. Click the red button at bottom-right to open the chat.
        </p>
      </div>

      {/* Tooltip: fades in, hides after 5s or when chat is opened */}
      <TooltipBubble visible={showTooltip} onDismiss={dismissTooltip} />

      {/* Chat window: slide-up when open */}
      <ChatWindow open={chatOpen} onClose={closeChat} apiBaseUrl="" />

      {/* Floating chat button: toggles chat, hover scale */}
      <ChatButton onClick={toggleChat} aria-label={chatOpen ? 'Close chat' : 'Open chat'} />
    </>
  );
}
