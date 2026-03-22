import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TRANSCRIPT_CHARS = 24_000;

const SYSTEM = `You turn voice dictation into a clear, readable note.

Rules:
- Fix obvious speech-to-text mistakes and filler ("um", false starts) without changing meaning.
- Preserve facts, names, numbers, and any user intent to create tasks or lists.
- If the user includes a notebook tag like #work or #ideas, keep that hashtag in the content (or title) so tagging still works.
- Output ONLY valid JSON (no markdown fences, no commentary) with exactly two string fields:
  "title": short headline for the note (max ~90 characters, plain text),
  "content": the full note body (plain text; use newlines and simple bullet lines with "- " if helpful).

Example shape: {"title":"…","content":"…"}`;

function extractJsonObject(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : t;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * POST body: { transcript: string, model?: string }
 * Returns { title, content } from OpenRouter chat completion.
 */
export async function POST(request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json({ error: "Missing transcript" }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: `Transcript too long (max ${MAX_TRANSCRIPT_CHARS} characters)` },
      { status: 400 }
    );
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "openai/gpt-4o-mini";

  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const headers = {
    Authorization: `Bearer ${key.trim()}`,
    "Content-Type": "application/json",
    ...(referer ? { "HTTP-Referer": referer } : {}),
    "X-Title": "NoteApp",
  };

  const payload = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Voice transcript to turn into a note:\n\n${transcript}`,
      },
    ],
    max_tokens: 4096,
    temperature: 0.35,
  };

  let completionRes;
  try {
    completionRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Network error calling OpenRouter" },
      { status: 502 }
    );
  }

  const completionJson = await completionRes.json().catch(() => ({}));

  if (!completionRes.ok) {
    const msg =
      completionJson?.error?.message ||
      completionJson?.message ||
      completionRes.statusText;
    const errStatus =
      completionRes.status >= 400 && completionRes.status < 600
        ? completionRes.status
        : 502;
    return NextResponse.json(
      { error: msg || "OpenRouter request failed" },
      { status: errStatus }
    );
  }

  const raw =
    completionJson?.choices?.[0]?.message?.content ??
    completionJson?.choices?.[0]?.text ??
    "";

  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json(
      {
        error: "Model did not return valid JSON",
        detail: String(raw).slice(0, 500),
      },
      { status: 502 }
    );
  }

  let title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  let content = typeof parsed.content === "string" ? parsed.content.trim() : "";

  if (!title && !content) {
    return NextResponse.json(
      { error: "Empty title and content from model" },
      { status: 502 }
    );
  }
  if (!title) title = content.slice(0, 90) || "Voice note";
  if (!content) content = title;

  return NextResponse.json({
    title: title.slice(0, 200),
    content: content.slice(0, 100_000),
  });
}
