import { config } from "./config.js";

/**
 * Lớp gọi DeepSeek dùng chung (bản tin Facebook, tóm tắt, bóc tách tin tuyển dụng).
 *
 * Luôn ép JSON object: mọi chỗ trong dự án đều cần dữ liệu có cấu trúc chứ không
 * cần văn xuôi, mà model để tự do rất hay chèn thêm lời dẫn quanh JSON.
 */
export async function callDeepSeekJson(
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  if (!config.deepseekApiKey) throw new Error("Thiếu DEEPSEEK_API_KEY trong .env");

  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(600_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      // v4-flash mặc định reasoning — tắt kẻo reasoning ăn hết max_tokens, content rỗng.
      thinking: { type: "disabled" },
      stream: false,
    }),
  });
  if (!resp.ok) {
    throw new Error(`DeepSeek HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Response DeepSeek không có nội dung");
  return content;
}
