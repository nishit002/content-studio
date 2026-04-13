/**
 * composeCoverImage
 *
 * Takes a background image URL (data: or https:) and draws it onto a 1200×630
 * canvas with a subtle dark gradient overlay for depth.
 * Returns a JPEG data URL suitable for the cover image field.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function composeCoverImage(bgUrl: string, _title?: string): Promise<string> {
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

      // ── Subtle vignette gradient (transparent → slight dark, edges only) ───
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };

    img.onerror = () => reject(new Error("Failed to load background image"));
    img.src = bgUrl;
  });
}
