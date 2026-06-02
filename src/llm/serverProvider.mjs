import { extractFieldsByRule } from "../agent/ruleExtractor.js";
import { schemas } from "../domain/schema.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export async function extractFieldsWithProvider(payload) {
  const config = getLlmConfig();
  if (!config.apiKey) {
    return {
      provider: "rule-fallback",
      ...extractFieldsByRule(payload.text, payload.awaitingField, payload.serviceType)
    };
  }

  try {
    const parsed = await callChatCompletion(config, {
      temperature: 0,
      response_format: buildExtractionResponseFormat(payload.serviceType),
      messages: buildExtractionMessages(payload)
    });

    return {
      provider: config.model,
      ...sanitizeExtraction(parsed, payload.serviceType)
    };
  } catch {
    return {
      provider: "rule-fallback",
      ...extractFieldsByRule(payload.text, payload.awaitingField, payload.serviceType)
    };
  }
}

export async function generatePitchWithProvider(payload) {
  const config = getLlmConfig();
  if (!config.apiKey) {
    return {
      provider: "local-fallback",
      pitch: null
    };
  }

  try {
    const parsed = await callChatCompletion(config, {
      temperature: 0.4,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roi_pitch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["pitch"],
            properties: {
              pitch: {
                type: "string",
                description: "A concise English sales pitch based only on the supplied ROI metrics."
              }
            }
          }
        }
      },
      messages: buildPitchMessages(payload)
    });

    return {
      provider: config.model,
      pitch: typeof parsed.pitch === "string" ? parsed.pitch.trim() : null
    };
  } catch {
    return {
      provider: "local-fallback",
      pitch: null
    };
  }
}

function getLlmConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
    model: process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? DEFAULT_MODEL
  };
}

async function callChatCompletion(config, body) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      ...body
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content);
}

function buildExtractionResponseFormat(serviceType) {
  const schema = schemas[serviceType];
  const valueProperties = {};
  const requiredValueKeys = [];
  const fieldKeys = schema.fields.map((field) => field.key);

  for (const field of schema.fields) {
    valueProperties[field.key] = {
      type: ["number", "null"],
      description: field.description
    };
    requiredValueKeys.push(field.key);
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "roi_slot_extraction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "values", "defaultFields", "invalidValues", "assistantMessage"],
        properties: {
          intent: {
            type: "string",
            enum: ["provide_values", "ask_question", "irrelevant", "reset", "request_results"]
          },
          values: {
            type: "object",
            additionalProperties: false,
            required: requiredValueKeys,
            properties: valueProperties
          },
          defaultFields: {
            type: "array",
            items: {
              type: "string",
              enum: [...fieldKeys, "*"]
            }
          },
          invalidValues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "reason"],
              properties: {
                field: {
                  type: "string",
                  enum: fieldKeys
                },
                reason: {
                  type: "string"
                }
              }
            }
          },
          assistantMessage: {
            type: "string"
          }
        }
      }
    }
  };
}

function buildExtractionMessages(payload) {
  const schema = schemas[payload.serviceType];
  const fieldLines = schema.fields
    .map(
      (field) =>
        `- ${field.key}: ${field.description} Unit: ${field.unit}. Benchmark: ${field.defaultValue}.`
    )
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "You are the slot-filling layer for an English PS / PSP ROI assistant.",
        "Return only JSON that matches the provided schema.",
        "Extract only explicit customer-provided numeric values. Do not calculate ROI.",
        "If the customer says they do not know a value, wants the benchmark, or asks to use a default, put the active field in defaultFields. Use '*' only when they clearly ask to use benchmarks for all missing fields.",
        "For share fields, normalize percentages to decimals: 80% becomes 0.8. A decimal such as 0.8 remains 0.8.",
        "If input is unrelated, set intent to irrelevant and leave values null.",
        `Fields:\n${fieldLines}`
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `Service type: ${payload.serviceType}`,
        `Active field: ${payload.awaitingField ?? "none"}`,
        `Known values: ${JSON.stringify(payload.currentValues ?? {})}`,
        `Value sources: ${JSON.stringify(payload.valueSources ?? {})}`,
        `Customer input: ${payload.text}`
      ].join("\n")
    }
  ];
}

function buildPitchMessages(payload) {
  return [
    {
      role: "system",
      content: [
        "You write concise English sales messaging for Lenovo PS / PSP ROI results.",
        "Use only the supplied deterministic calculation data. Do not invent metrics.",
        "Mention both PS and PSP, and make the recommendation clear when one ROI is stronger.",
        "Keep the pitch to 3-5 sentences. No markdown headings."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(payload)
    }
  ];
}

function sanitizeExtraction(parsed, serviceType) {
  const schema = schemas[serviceType];
  const fieldKeys = new Set(schema.fields.map((field) => field.key));
  const result = {
    intent: sanitizeIntent(parsed.intent),
    values: {},
    defaultFields: [],
    invalidValues: []
  };

  for (const field of schema.fields) {
    const rawValue = parsed.values?.[field.key];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      result.values[field.key] = normalizeFieldValue(field, value);
    }
  }

  const defaults = Array.isArray(parsed.defaultFields) ? parsed.defaultFields : [];
  result.defaultFields = defaults.filter((fieldKey) => fieldKey === "*" || fieldKeys.has(fieldKey));

  const invalids = Array.isArray(parsed.invalidValues) ? parsed.invalidValues : [];
  result.invalidValues = invalids
    .filter((item) => fieldKeys.has(item.field))
    .map((item) => ({
      field: item.field,
      reason: String(item.reason || "Invalid value")
    }));

  if (!Object.keys(result.values).length && !result.defaultFields.length && result.intent === "provide_values") {
    result.intent = "irrelevant";
  }

  return result;
}

function sanitizeIntent(intent) {
  const supported = new Set(["provide_values", "ask_question", "irrelevant", "reset", "request_results"]);
  return supported.has(intent) ? intent : "irrelevant";
}

function normalizeFieldValue(field, value) {
  if (field.valueType === "share" && value > 1) {
    return value / 100;
  }
  return value;
}
