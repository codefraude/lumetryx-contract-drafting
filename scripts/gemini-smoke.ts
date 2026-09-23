/**
 * One small, bounded LIVE check of the configured Gemini model: a structured-output call and a
 * streamed call, printing token usage. Costs a few hundred tokens. Run: npm run smoke:gemini
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, streamText } from "ai";
import { z } from "zod";

const apiKey = process.env.GEMINI_API_KEY;
const modelId = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set — live smoke test skipped.");
  process.exit(2);
}
const model = createGoogleGenerativeAI({ apiKey })(modelId);
const providerOptions = { google: { thinkingConfig: { thinkingLevel: (process.env.GEMINI_THINKING_LEVEL ?? "minimal") as "minimal" } } };

const s = await generateText({
  model,
  providerOptions,
  maxOutputTokens: 300,
  output: Output.object({ schema: z.object({ tenant: z.string().nullable(), rent: z.string().nullable(), evidence: z.array(z.string()) }) }),
  prompt: 'Extract the tenant name and rent the user stated, with verbatim evidence. Message: "The tenant is John Smith and rent is Rs 25,000 monthly."',
});
console.log(`[structured] model=${modelId} finish=${s.finishReason}`, s.output, s.usage);

const r = streamText({ model, providerOptions, maxOutputTokens: 120, prompt: "In one sentence, ask a lawyer who the landlord is and whether it is an individual or a company." });
let chunks = 0;
process.stdout.write("[stream] ");
for await (const d of r.textStream) {
  chunks++;
  process.stdout.write(d);
}
console.log(`\n[stream] chunks=${chunks} finish=${await r.finishReason}`, await r.usage);
