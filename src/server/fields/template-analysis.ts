import { z } from "zod";
import { FieldGroup, ValueType } from "@/features/documents/contracts/fields";

/**
 * Schema the model must satisfy for template analysis. Kept small on purpose.
 */
export const TemplateAnalysis = z.object({
  // Gemini rejects maxItems on arrays of objects
  // (HTTP 400); caps are applied in buildFields.
  fields: z.array(
    z.object({
      id: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,63}$/)
        .describe(
          "English snake_case identifier, whatever the template language",
        ),
      label: z
        .string()
        .min(1)
        .max(120)
        .describe("Short label in the template's language"),
      question: z
        .string()
        .max(240)
        .describe("Plain-language question for a lawyer, in English"),
      questionFr: z
        .string()
        .max(240)
        .nullable()
        .optional()
        .describe("The same question in French"),
      valueType: ValueType,
      group: FieldGroup,
      required: z.boolean(),
      markerKeys: z
        .array(z.string())
        .describe("Keys of the detected markers that mean this same thing"),
      implicit: z
        .array(
          z.object({
            blockId: z.string(),
            quote: z
              .string()
              .min(3)
              .max(160)
              .describe(
                "Verbatim text: the placeholder wording itself when replace is true, else the text immediately BEFORE the missing information",
              ),
            replace: z
              .boolean()
              .describe(
                "true when the quote is placeholder wording that stands where the value goes and must be replaced by it; false when the value goes right after the quote",
              ),
          }),
        )
        .describe("Places where information is missing but no marker exists"),
    }),
  ),
  notFields: z
    .array(z.string())
    .describe(
      "Marker keys that are ordinary contract text, not fillable fields",
    ),
  conditions: z
    .array(
      z.object({
        name: z.string().describe("Name used in the [[IF name]] marker"),
        question: z.string().max(240),
        questionFr: z.string().max(240).nullable().optional(),
      }),
    )
    .optional()
    .describe("A plain question for each [[IF …]] condition marker listed"),
  proposedRules: z
    .array(
      z.object({
        label: z.string().max(120),
        firstBlockId: z.string(),
        lastBlockId: z.string(),
        conditionName: z
          .string()
          .describe(
            "English snake_case name of the yes/no answer the clause depends on",
          ),
        question: z.string().max(240),
        questionFr: z.string().max(240).nullable().optional(),
        evidence: z
          .string()
          .max(300)
          .describe(
            "Verbatim template text that states the clause is conditional",
          ),
      }),
    )
    .optional()
    .describe(
      "Clauses the template itself says are optional or conditional, without [[IF]] markers",
    ),
});

export type TemplateAnalysis = z.infer<typeof TemplateAnalysis>;
