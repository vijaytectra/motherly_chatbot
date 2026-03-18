# Floating Chat Widget

React + Tailwind floating chatbot UI: button, tooltip, and chat window.

## Run locally

```bash
cd floating-chat-widget
npm install
npm run dev
```

Open http://localhost:5173

## Build for production

```bash
npm run build
```

Output is in `dist/`. To use on your backend, copy `dist/assets/*` and `dist/index.html` to your static server, or point your app to the built `index.html`.

## Embedding on your website

- **Same origin as your API**: Use the built app and set `apiBaseUrl` to `""` so requests go to `/chat` on the current host.
- **Different origin**: Set `apiBaseUrl` in `ChatWindow` (e.g. `https://your-api.com`) so the widget calls your backend.

## Components

- **ChatButton** – Floating red circular button (56–64px), white chat icon, hover scale.
- **TooltipBubble** – “Need help? Start a conversation” above the button; fade-in, 5s auto-hide, hidden after first open.
- **ChatWindow** – Panel (≈350×500px), header with bot name + close, scrollable messages (user right, bot left), input + send + mic icon; slide-up animation.

All behavior and animations are implemented; layout is responsive (mobile-friendly).
