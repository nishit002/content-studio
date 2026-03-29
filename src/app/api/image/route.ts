import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys } from "@/lib/server/db";

/**
 * POST /api/image — Generate an image using FLUX.1 via HuggingFace.
 *
 * Body: { prompt: string, type?: "cover" | "illustration" }
 * Returns: { url: string } (base64 data URL)
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  const { prompt, type } = body as { prompt?: string; type?: "cover" | "illustration" };

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // Get HuggingFace API key (FLUX.1 runs on HF inference)
  const keys = getApiKeys(sessionId);

  // Try image_gen key first, then huggingface
  const imgKey = keys.find((k) => k.provider === "image_gen");
  const hfKey = keys.find((k) => k.provider === "huggingface");
  const apiKey = imgKey?.key_value || hfKey?.key_value;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No image generation API key configured. Add HuggingFace or Image Gen key in Configuration." },
      { status: 400 }
    );
  }

  // Enhance prompt based on type
  const isCover = type === "cover";
  const enhancedPrompt = isCover
    ? `Professional blog cover image, clean modern design, minimalist: ${prompt}. No text, no watermark.`
    : `Clean informational illustration for article section: ${prompt}. Professional, minimal, no text overlay.`;

  try {
    const res = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: enhancedPrompt,
          parameters: {
            width: isCover ? 1200 : 800,
            height: isCover ? 630 : 450,
          },
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Image generation failed: ${err.slice(0, 200)}` }, { status: 502 });
    }

    // Response is raw image bytes
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({ url: dataUrl });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
