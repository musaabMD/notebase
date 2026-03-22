/** localStorage key for OpenRouter model used with voice-note flows */
export const VOICE_NOTE_MODEL_KEY = "notes-app-voice-openrouter-model";

export const DEFAULT_VOICE_NOTE_MODEL = "openai/gpt-4o-mini";

/** Curated models for the settings dropdown (any `provider/model` id works if typed as custom). */
export const VOICE_NOTE_MODEL_PRESETS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
];

export function formatVoiceModelIdForUi(id) {
  if (!id?.trim()) return DEFAULT_VOICE_NOTE_MODEL;
  const t = id.trim();
  if (t.length <= 28) return t;
  return `${t.slice(0, 14)}…${t.slice(-10)}`;
}
