import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type AIProvider = "openai" | "anthropic" | "gemini";

export interface AIMessage {
  role: "system" | "user";
  content: string;
}

export interface AICompletionClient {
  provider: AIProvider;
  complete(opts: {
    tier: "fast" | "smart";
    messages: AIMessage[];
    temperature?: number;
  }): Promise<string>;
  completeWithImage(opts: {
    tier: "fast" | "smart";
    systemPrompt: string;
    textPrompt: string;
    base64Image: string;
    mimeType: string;
    temperature?: number;
  }): Promise<string>;
}

// Model mapping per provider
const MODELS: Record<AIProvider, { fast: string; smart: string }> = {
  openai: { fast: "gpt-4o-mini", smart: "gpt-4o" },
  anthropic: { fast: "claude-3-haiku-20240307", smart: "claude-3-5-sonnet-20241022" },
  gemini: { fast: "gemini-1.5-flash", smart: "gemini-1.5-pro" },
};

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

function createOpenAIClient(apiKey: string): AICompletionClient {
  const openai = new OpenAI({ apiKey });

  return {
    provider: "openai",
    async complete({ tier, messages, temperature = 0 }) {
      const model = MODELS.openai[tier];
      const response = await openai.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature,
      });
      return response.choices[0].message.content ?? "{}";
    },
    async completeWithImage({ tier, systemPrompt, textPrompt, base64Image, mimeType, temperature = 0 }) {
      const model = MODELS.openai[tier];
      const response = await openai.chat.completions.create({
        model,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: textPrompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
            ],
          },
        ],
      });
      return response.choices[0].message.content ?? "{}";
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

function createAnthropicClient(apiKey: string): AICompletionClient {
  const anthropic = new Anthropic({ apiKey });

  return {
    provider: "anthropic",
    async complete({ tier, messages, temperature = 0 }) {
      const model = MODELS.anthropic[tier];

      const systemMsg = messages.find((m) => m.role === "system");
      const userMessages = messages.filter((m) => m.role === "user");

      const systemPrompt = [
        systemMsg?.content ?? "",
        "IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        temperature,
        system: systemPrompt,
        messages: userMessages.map((m) => ({
          role: "user" as const,
          content: m.content,
        })),
      });

      const block = response.content[0];
      if (block.type !== "text") return "{}";

      const raw = block.text.trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      return fenced ? fenced[1].trim() : raw;
    },
    async completeWithImage({ tier, systemPrompt, textPrompt, base64Image, mimeType, temperature = 0 }) {
      const model = MODELS.anthropic[tier];
      const response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        temperature,
        system: systemPrompt + "\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: base64Image,
                },
              },
              { type: "text", text: textPrompt },
            ],
          },
        ],
      });

      const block = response.content[0];
      if (block.type !== "text") return "{}";
      const raw = block.text.trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      return fenced ? fenced[1].trim() : raw;
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini client (via OpenAI-compatible endpoint)
// ---------------------------------------------------------------------------

function createGeminiClient(apiKey: string): AICompletionClient {
  const gemini = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  return {
    provider: "gemini",
    async complete({ tier, messages, temperature = 0 }) {
      const model = MODELS.gemini[tier];
      const response = await gemini.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature,
      });
      return response.choices[0].message.content ?? "{}";
    },
    async completeWithImage({ tier, systemPrompt, textPrompt, base64Image, mimeType, temperature = 0 }) {
      const model = MODELS.gemini[tier];
      const response = await gemini.chat.completions.create({
        model,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: textPrompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
      });
      return response.choices[0].message.content ?? "{}";
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAIClient(provider: AIProvider, apiKey: string): AICompletionClient {
  switch (provider) {
    case "openai":
      return createOpenAIClient(apiKey);
    case "anthropic":
      return createAnthropicClient(apiKey);
    case "gemini":
      return createGeminiClient(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
