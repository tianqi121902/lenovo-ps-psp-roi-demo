import { extractFieldsByRule } from "../agent/ruleExtractor.js";
import { describeDirectLlmError, extractFieldsDirectly, hasDirectLlmConfig } from "./browserProvider.js";

export async function extractFields(text, context) {
  const payload = {
    text,
    serviceType: context.serviceType,
    awaitingField: context.awaitingField,
    currentValues: context.values,
    valueSources: context.valueSources
  };

  if (hasDirectLlmConfig()) {
    try {
      return await extractFieldsDirectly(payload);
    } catch (error) {
      const fallback = extractFieldsByRule(text, context.awaitingField, context.serviceType);
      return {
        ...fallback,
        provider: "local-fallback",
        fallbackReason: "direct-llm-failed",
        error: describeDirectLlmError(error)
      };
    }
  }

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Extract request failed: ${response.status}`);
    }

    const payload = await response.json();
    return payload;
  } catch {
    return {
      ...extractFieldsByRule(text, context.awaitingField, context.serviceType),
      provider: "local-fallback",
      fallbackReason: "server-api-unavailable"
    };
  }
}
