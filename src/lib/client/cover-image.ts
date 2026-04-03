/**
 * composeCoverImage
 *
 * Takes a background image URL (data: or https:) and an article title.
 * Draws the image onto a 1200×630 canvas, adds a dark gradient over the
 * bottom half for readability, then renders the title in bold white text.
 * Returns a JPEG data URL suitable for the cover image field.
 */
export function composeCoverImage(bgUrl: string, title: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const W = 1200;
    const H = 630;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("Canvas not supported")); return; }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // ── Background: cover-fit ──────────────────────────────────────────────
      const scale = Math.max(W / img.width, H / img.height);
      const sw = img.width * scale;
      const sh = img.height * scale;
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);

      // ── Gradient overlay (transparent → dark, bottom 65%) ─────────────────
      const grad = ctx.createLinearGradient(0, H * 0.25, 0, H);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.55, "rgba(0,0,0,0.62)");
      grad.addColorStop(1, "rgba(0,0,0,0.88)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // ── Title text ────────────────────────────────────────────────────────
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 10;

      const FONT_SIZE = 50;
      const LINE_HEIGHT = 64;
      const PADDING = 52;
      const MAX_WIDTH = W - PADDING * 2;

      ctx.font = `bold ${FONT_SIZE}px Georgia, 'Times New Roman', serif`;

      // Word-wrap title into lines
      const words = title.split(" ");
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > MAX_WIDTH && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);

      // Cap at 3 lines, add ellipsis if truncated
      const display = lines.slice(0, 3);
      if (lines.length > 3) {
        display[2] = display[2].replace(/\s+\S+$/, "") + "…";
      }

      const blockH = display.length * LINE_HEIGHT;
      const startY = H - PADDING - blockH + FONT_SIZE; // align block to bottom

      display.forEach((line, i) => {
        ctx.fillText(line, PADDING, startY + i * LINE_HEIGHT);
      });

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };

    img.onerror = () => reject(new Error("Failed to load background image"));
    img.src = bgUrl;
  });
}
