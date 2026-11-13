// The demo conversation. Edit this, then `npm run video` (synthesis is cached
// per line, so only changed lines are sent to Cartesia again).
//
// `interruptAt`: on a bot line, the word at which the next user line starts
// speaking over it. The bot's audio is cut a moment later, as jargo would,
// and its text stops at the last word it spoke.

export const conversation = [
  { who: 'user', text: 'Hey, what is jargo exactly?' },
  {
    who: 'bot',
    text:
      'jargo is a Go framework for real-time voice agents. Audio comes in over WebRTC, goes through speech-to-text, an LLM and text-to-speech, and every stage runs concurrently on its own goroutine, so the whole pipeline stays fast.',
    interruptAt: 'concurrently',
  },
  { who: 'user', text: 'Wait, can I swap the speech-to-text provider?' },
  {
    who: 'bot',
    text: 'Yes. Each provider sits behind a small interface, so swapping speech-to-text, the LLM or text-to-speech is a one-line change.',
  },
  { who: 'user', text: 'And I can host it myself?' },
  {
    who: 'bot',
    text: 'Yes. It ships as one static binary. Run it anywhere, and the browser connects straight to it.',
  },
];

// Labels shown between messages: what jargo does at that moment.
export const labels = {
  connected: 'WebRTC connected · Opus 48 kHz',
  endOfTurn: 'Smart Turn: end of turn',
  interruption: 'VAD: user speech → interruption, TTS cancelled',
};

// Cartesia voice IDs (English). List candidates with `npm run video:voices`.
export const voices = {
  user: process.env.JARGO_VIDEO_USER_VOICE ?? '630ed21c-2c5c-41cf-9d82-10a7fd668370', // Corey
  bot: process.env.JARGO_VIDEO_BOT_VOICE ?? 'f786b574-daa5-4673-aa0c-cbe3e8534c02', // Katie
};
