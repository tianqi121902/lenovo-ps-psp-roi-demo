import { schemas } from "../domain/schema.js";

export const DEFAULT_DIRECT_LLM_CONFIG = {
  baseUrl:
    "https://aiverse-row.ludp.lenovo.com/ics-apps/projects/115/smartfind-agent/aiverse/endpoint/v1",
  model: "gpt-4o-mini"
};

const STORAGE_KEY = "psPspRoiAgent.llmConfig";

export function getDirectLlmConfig() {
  const saved = readSavedConfig();
  return {
    apiKey: saved.apiKey ?? "",
    baseUrl: saved.baseUrl || DEFAULT_DIRECT_LLM_CONFIG.baseUrl,
    model: saved.model || DEFAULT_DIRECT_LLM_CONFIG.model
  };
}

export function saveDirectLlmConfig(config) {
  if (!canUseStorage()) return;
  const nextConfig = {
    apiKey: String(config.apiKey ?? "").trim(),
    baseUrl: String(config.baseUrl ?? DEFAULT_DIRECT_LLM_CONFIG.baseUrl).trim(),
    model: String(config.model ?? DEFAULT_DIRECT_LLM_CONFIG.model).trim()
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
}

export function hasDirectLlmConfig() {
  return Boolean(getDirectLlmConfig().apiKey);
}

export async function testDirectLlmConnection() {
  try {
    const parsed = await callChatCompletionWithFallback({
      temperature: 0,
      jsonSchemaFormat: {
        type: "json_schema",
        json_schema: {
          name: "connection_test",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: {
              ok: {
                type: "boolean"
              }
            }
          }
        }
      },
      jsonObjectFormat: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return JSON only."
        },
        {
          role: "user",
          content: "Return {\"ok\":true}."
        }
      ]
    });

    return {
      ok: parsed.data?.ok === true,
      provider: "gpt-4o-mini-direct",
      mode: parsed.mode,
      message:
        parsed.data?.ok === true
          ? `Connected to GPT-4o mini (${parsed.mode}).`
          : `Connected, but the response shape was unexpected (${parsed.mode}).`
    };
  } catch (error) {
    return {
      ok: false,
      provider: "direct-llm",
      mode: "failed",
      error: describeDirectLlmError(error),
      message: describeDirectLlmError(error).message
    };
  }
}

export async function extractFieldsDirectly(payload) {
  const parsed = await callChatCompletionWithFallback({
    temperature: 0,
    jsonSchemaFormat: buildExtractionResponseFormat(payload.serviceType),
    jsonObjectFormat: { type: "json_object" },
    messages: buildExtractionMessages(payload)
  });

  return {
    provider: "gpt-4o-mini-direct",
    mode: parsed.mode,
    ...sanitizeExtraction(parsed.data, payload.serviceType)
  };
}

export async function generatePitchDirectly(payload) {
  const parsed = await callChatCompletionWithFallback({
    temperature: 0.4,
    jsonSchemaFormat: {
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
              description: "A concise English sales pitch based only on supplied ROI metrics."
            }
          }
        }
      }
    },
    jsonObjectFormat: { type: "json_object" },
    messages: buildPitchMessages(payload)
  });

  return {
    provider: "gpt-4o-mini-direct",
    mode: parsed.mode,
    pitch: typeof parsed.data.pitch === "string" ? parsed.data.pitch.trim() : null
  };
}

export function describeDirectLlmError(error) {
  if (error?.message === "Direct LLM is not configured.") {
    return {
      code: "not-configured",
      message: "Direct LLM is not configured. Paste the API key and save settings first."
    };
  }

  if (error instanceof DirectLlmError) {
    if (error.status === 401) {
      return {
        code: "unauthorized",
        message: "LLM authentication failed. Check whether the API key is correct and active."
      };
    }
    if (error.status === 403) {
      return {
        code: "forbidden",
        message: "LLM access is forbidden. Check whether this key has permission for the Lenovo endpoint."
      };
    }
    if (error.status === 404) {
      return {
        code: "endpoint-not-found",
        message: "LLM endpoint was not found. Check the Base URL and model route."
      };
    }
    if (error.status === 400 && isResponseFormatUnsupported(error)) {
      return {
        code: "unsupported-format",
        message: "The endpoint rejected structured output. The app will retry with JSON object mode."
      };
    }
    return {
      code: `http-${error.status}`,
      message: `LLM request failed with HTTP ${error.status}.`
    };
  }

  if (error?.name === "SyntaxError") {
    return {
      code: "invalid-json",
      message: "The LLM responded, but it did not return valid JSON."
    };
  }

  return {
    code: "network-or-cors",
    message:
      "Cannot reach the LLM endpoint from this browser. This is usually a company VPN, DNS, endpoint, or CORS issue."
  };
}

async function callChatCompletionWithFallback({ jsonSchemaFormat, jsonObjectFormat, messages, ...rest }) {
  try {
    return {
      mode: "json_schema",
      data: await callChatCompletion({
        ...rest,
        response_format: jsonSchemaFormat,
        messages
      })
    };
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) {
      throw error;
    }
  }

  return {
    mode: "json_object",
    data: await callChatCompletion({
      ...rest,
      response_format: jsonObjectFormat,
      messages: addJsonObjectFallbackInstruction(messages)
    })
  };
}

async function callChatCompletion(body) {
  const config = getDirectLlmConfig();
  if (!config.apiKey) {
    throw new Error("Direct LLM is not configured.");
  }

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
    const bodyText = await response.text();
    throw new DirectLlmError(response.status, bodyText);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content);
}

function addJsonObjectFallbackInstruction(messages) {
  return messages.map((message, index) => {
    if (index !== 0 || message.role !== "system") return message;
    return {
      ...message,
      content: `${message.content}\nStructured output is unavailable. Return a single valid JSON object and no other text.`
    };
  });
}

function isResponseFormatUnsupported(error) {
  if (!(error instanceof DirectLlmError) || error.status !== 400) return false;
  return /response_format|json_schema|schema|structured/i.test(error.bodyText);
}

class DirectLlmError extends Error {
  constructor(status, bodyText) {
    super(`Direct LLM request failed: ${status}`);
    this.name = "DirectLlmError";
    this.status = status;
    this.bodyText = bodyText;
  }
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
            enum: [
              "greeting_or_opening",
              "small_talk",
              "provide_values",
              "ask_field_meaning",
              "unknown_use_current_benchmark",
              "use_all_benchmarks",
              "irrelevant",
              "correction",
              "complaint_or_confusion",
              "reset",
              "request_results"
            ]
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
        "You are the understanding layer for an English Lenovo PS / PSP ROI chat assistant.",
        "Return only JSON that matches the provided schema.",
        "The assistant should feel conversational, but the app's deterministic state machine decides what to store and when to calculate.",
        "Extract only explicit customer-provided numeric values. Never invent values. Never calculate ROI.",
        "If the customer gives one bare number and there is an active field, put that number only in the active field.",
        "If the customer says they do not know a value, wants the benchmark, or asks to use a default, put only the active field in defaultFields.",
        "Use '*' in defaultFields only when the customer clearly asks to use benchmarks/defaults for all missing or remaining fields.",
        "For share fields, normalize percentages to decimals: 80% becomes 0.8. A decimal such as 0.8 remains 0.8.",
        "If input is a greeting or casual opening, use intent greeting_or_opening and leave values null.",
        "If input is friendly small talk without ROI data, use intent small_talk and leave values null.",
        "If input is unrelated, use intent irrelevant and leave values null.",
        "If the user complains that assumptions were made or asks where values came from, use intent complaint_or_confusion.",
        "If the user asks what a field means, use intent ask_field_meaning.",
        "Few-shot examples:",
        "Customer input: hello -> intent greeting_or_opening, values all null, defaultFields [].",
        "Active field devices_in_scope, Customer input: 9000 -> values.devices_in_scope 9000, all other values null, defaultFields [].",
        "Active field blended_end_user_cost, Customer input: I don't know -> intent unknown_use_current_benchmark, defaultFields [blended_end_user_cost].",
        "Active field blended_end_user_cost, Customer input: onsite cost is 300 -> values.avg_onsite_cost_per_claim 300, defaultFields [].",
        "Customer input: use all benchmarks -> intent use_all_benchmarks, defaultFields [*].",
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
  const supported = new Set([
    "greeting_or_opening",
    "small_talk",
    "provide_values",
    "ask_field_meaning",
    "unknown_use_current_benchmark",
    "use_all_benchmarks",
    "irrelevant",
    "correction",
    "complaint_or_confusion",
    "reset",
    "request_results"
  ]);
  return supported.has(intent) ? intent : "irrelevant";
}

function normalizeFieldValue(field, value) {
  if (field.valueType === "share" && value > 1) {
    return value / 100;
  }
  return value;
}

function readSavedConfig() {
  if (!canUseStorage()) return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}
