import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGateway, generateText, Output, streamText } from "ai";
import { z } from "zod";

const viaGateway = process.argv.includes("--gateway");
const keyName = viaGateway ? "AI_GATEWAY_API_KEY" : "GEMINI_API_KEY";
const apiKey = process.env[keyName];
const modelId = viaGateway
  ? (process.env.AI_GATEWAY_MODEL ?? "google/gemini-2.5-flash-lite")
  : (process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite");

if (!apiKey) {
  console.error(`${keyName} is not set, so the live smoke test was skipped.`);
  process.exit(2);
}

const model = viaGateway
  ? createGateway({ apiKey })(modelId)
  : createGoogleGenerativeAI({ apiKey })(modelId);
const thinkingLevel = z
  .enum(["minimal", "low", "medium", "high"])
  .parse(process.env.GEMINI_THINKING_LEVEL ?? "minimal");
const providerOptions: Record<
  string,
  { thinkingConfig: { thinkingLevel: typeof thinkingLevel } }
> = /gemini-3/.test(modelId)
  ? { google: { thinkingConfig: { thinkingLevel } } }
  : {};

const s = await generateText({
  model,
  providerOptions,
  maxOutputTokens: 300,
  output: Output.object({
    schema: z.object({
      tenant: z.string().nullable(),
      rent: z.string().nullable(),
      evidence: z.array(z.string()),
    }),
  }),
  prompt:
    'Extract the tenant name and rent the user stated, with verbatim evidence. Message: "The tenant is John Smith and rent is Rs 25,000 monthly."',
});

console.log(
  `[structured] model=${modelId} finish=${s.finishReason}`,
  s.output,
  s.usage,
);

const r = streamText({
  model,
  providerOptions,
  maxOutputTokens: 120,
  prompt:
    "In one sentence, ask a lawyer who the landlord is and whether it is an individual or a company.",
});
let chunks = 0;

process.stdout.write("[stream] ");

for await (const d of r.textStream) {
  chunks++;
  process.stdout.write(d);
}

console.log(
  `\n[stream] chunks=${chunks} finish=${await r.finishReason}`,
  await r.usage,
);
