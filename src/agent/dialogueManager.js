import { schemas } from "../domain/schema.js";
import { getCalculator } from "../calculators/registry.js";
import { extractFields as defaultExtractFields } from "../llm/clientExtractor.js";
import { generatePitch as defaultGeneratePitch } from "../output/pitchGenerator.js";
import { formatCurrency, formatFieldValue, formatNumber, formatPercent } from "../utils/format.js";

const DEFAULT_SERVICE_TYPE = "ps-psp-roi";

export function createDialogueManager(options = {}) {
  const extractFields = options.extractFields ?? defaultExtractFields;
  const generatePitch = options.generatePitch ?? defaultGeneratePitch;
  let state = createInitialState();

  function createInitialState() {
    return {
      serviceType: DEFAULT_SERVICE_TYPE,
      values: {},
      valueSources: {},
      valueConfirmed: {},
      awaitingField: null,
      completed: false,
      phase: "onboarding",
      invalidValues: [],
      llmStatus: {
        slotProvider: "not-tested",
        slotMode: null,
        lastError: null
      }
    };
  }

  function reset() {
    state = createInitialState();
    const schema = schemas[state.serviceType];
    const firstField = schema.fields[0];
    state.awaitingField = firstField.key;
    state.phase = "onboarding";
    return {
      state: getState(),
      message: [
        "Hello. I can estimate annual ROI for Lenovo PS and PSP.",
        "You can provide all customer inputs in one message, or answer one question at a time.",
        "If you do not know a value, say \"I don't know\" and I can use the benchmark for that item.",
        "",
        buildQuestion(firstField)
      ].join("\n")
    };
  }

  async function handleUserMessage(text) {
    const schema = schemas[state.serviceType];
    const extracted = await extractFields(text, getState());
    state.llmStatus = {
      slotProvider: extracted.provider ?? "unknown",
      slotMode: extracted.mode ?? null,
      lastError: extracted.error ?? null
    };

    if (extracted.intent === "reset") {
      return reset();
    }

    if (isComplaintOrConfusion(text, extracted.intent)) {
      removeUnconfirmedDefaults();
      const missingAfterRecovery = getMissingField(schema);
      state.awaitingField = missingAfterRecovery?.key ?? null;
      state.completed = false;
      state.phase = missingAfterRecovery ? "collecting" : "ready_to_calculate";
      return {
        state: getState(),
        message: [
          "You are right. I should not assume values you have not approved.",
          "I will keep the values you provided and collect the remaining inputs step by step.",
          "",
          missingAfterRecovery
            ? buildQuestion(missingAfterRecovery)
            : "All inputs are now resolved. Say \"calculate\" when you want the ROI estimate."
        ].join("\n")
      };
    }

    const acceptedValues = applyExtractedValues(schema, extracted.values ?? {}, text);
    const appliedDefaults = applyRequestedDefaults(schema, extracted.defaultFields ?? [], {
      text,
      acceptedValues
    });
    const invalidValues = [
      ...(extracted.invalidValues ?? []),
      ...findInvalidValues(schema, extracted.values ?? {})
    ];
    state.invalidValues = invalidValues;

    const missingField = getMissingField(schema);
    state.awaitingField = missingField?.key ?? null;
    state.completed = false;
    state.phase = missingField ? "collecting" : "ready_to_calculate";

    if (missingField) {
      return {
        state: getState(),
        message: buildProgressMessage({
          schema,
          missingField,
          values: state.values,
          valueSources: state.valueSources,
          acceptedValues,
          appliedDefaults,
          invalidValues,
          intent: extracted.intent,
          text
        })
      };
    }

    state.completed = true;
    const calculator = getCalculator(state.serviceType);
    const calculation = calculator.calculate(state.values);

    return {
      state: getState(),
      message: await buildFinalMessage(schema, calculation, state, generatePitch)
    };
  }

  function applyRequestedDefaults(schema, defaultFields, context = {}) {
    const applied = [];
    const text = context.text ?? "";
    const shouldApplyAll = defaultFields.includes("*") && isExplicitAllBenchmarkRequest(text);
    for (const field of schema.fields) {
      const requestedCurrentField =
        field.key === state.awaitingField &&
        (defaultFields.includes(field.key) || isCurrentBenchmarkRequest(text));
      const requestedNamedField =
        defaultFields.includes(field.key) &&
        isFieldMentioned(text, field);

      if ((shouldApplyAll || requestedCurrentField || requestedNamedField) && !isUsableNumber(state.values[field.key])) {
        state.values[field.key] = field.defaultValue;
        state.valueSources[field.key] = "default";
        state.valueConfirmed[field.key] = true;
        applied.push(field.key);
      }
    }
    return applied;
  }

  function applyExtractedValues(schema, values, text) {
    const accepted = [];
    for (const field of schema.fields) {
      if (!(field.key in values)) continue;
      if (!shouldAcceptExtractedValue(text, field, state.awaitingField)) continue;
      const normalized = normalizeFieldValue(field, values[field.key]);
      if (isValidFieldValue(field, normalized)) {
        state.values[field.key] = normalized;
        state.valueSources[field.key] = "user";
        state.valueConfirmed[field.key] = true;
        accepted.push(field.key);
      }
    }
    return accepted;
  }

  function removeUnconfirmedDefaults() {
    for (const [fieldKey, source] of Object.entries(state.valueSources)) {
      if (source === "default" && !state.valueConfirmed[fieldKey]) {
        delete state.values[fieldKey];
        delete state.valueSources[fieldKey];
      }
    }
  }

  function getMissingField(schema) {
    return schema.fields.find((field) => !isUsableNumber(state.values[field.key]));
  }

  function getState() {
    return {
      serviceType: state.serviceType,
      values: { ...state.values },
      valueSources: { ...state.valueSources },
      valueConfirmed: { ...state.valueConfirmed },
      awaitingField: state.awaitingField,
      completed: state.completed,
      phase: state.phase,
      invalidValues: [...state.invalidValues],
      llmStatus: { ...state.llmStatus }
    };
  }

  return {
    reset,
    handleUserMessage,
    getState
  };
}

function isUsableNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidFieldValue(field, value) {
  if (!isUsableNumber(value)) return false;
  if (value < field.min) return false;
  if (field.max !== undefined && value > field.max) return false;
  return true;
}

function normalizeFieldValue(field, value) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric;
  if (field.valueType === "share" && numeric > 1) {
    return numeric / 100;
  }
  return numeric;
}

function findInvalidValues(schema, values) {
  const invalid = [];
  for (const field of schema.fields) {
    if (!(field.key in values)) continue;
    if (values[field.key] === null || values[field.key] === undefined || values[field.key] === "") continue;
    const normalized = normalizeFieldValue(field, values[field.key]);
    if (!isValidFieldValue(field, normalized)) {
      invalid.push({
        field: field.key,
        reason: buildInvalidReason(field)
      });
    }
  }
  return invalid;
}

function buildInvalidReason(field) {
  if (field.max !== undefined) {
    return `${field.label} must be between ${field.min} and ${field.max}.`;
  }
  return `${field.label} must be at least ${field.min}.`;
}

function buildQuestion(field) {
  return `${field.prompt} If you do not know it, say "I don't know" and I will use the benchmark: ${formatFieldValue(field, field.defaultValue, "default")}.`;
}

function buildOffTopicBridge(text) {
  if (isGreetingOrOpening(text, "irrelevant")) {
    return "Hello. I can help estimate annual ROI for Lenovo PS and PSP.";
  }
  if (/\b(thanks|thank you|ok|okay|great|nice|cool)\b/i.test(text)) {
    return "Great. Let's keep the ROI estimate moving.";
  }
  return "I can chat briefly, but the most useful next step is to collect the ROI inputs.";
}

function isGreetingOrOpening(text = "", intent = "") {
  return (
    intent === "greeting_or_opening" ||
    /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)
  );
}

function isComplaintOrConfusion(text = "", intent = "") {
  return (
    intent === "complaint_or_confusion" ||
    /\b(where did you get|why did you assume|you assumed|i only told|haven't asked|have not asked|not what i said|wrong data)\b/i.test(text)
  );
}

function isCurrentBenchmarkRequest(text = "") {
  return /\b(i do not know|i don't know|not sure|unknown|use benchmark|use the benchmark|use default|use the default|benchmark|default)\b/i.test(text);
}

function isExplicitAllBenchmarkRequest(text = "") {
  return /\b(use|apply|take)\b.{0,24}\b(all|everything|remaining|rest)\b.{0,24}\b(benchmark|benchmarks|default|defaults)\b/i.test(text) ||
    /\b(all|everything|remaining|rest)\b.{0,24}\b(benchmark|benchmarks|default|defaults)\b/i.test(text);
}

function isFieldMentioned(text = "", field) {
  const normalizedText = text.toLowerCase();
  if (field.key === "devices_in_scope" && /\b(devices?|pcs?|laptops?|endpoints?)\b/i.test(text)) return true;
  if (field.key === "blended_end_user_cost" && /\b(end\s*user|employee|user).{0,40}\b(cost|wage|rate|hourly)\b/i.test(text)) return true;
  if (field.key === "blended_it_support_cost" && /\b(it|support).{0,40}\b(cost|wage|rate|hourly)\b/i.test(text)) return true;
  if (field.key === "baseline_incidents_per_device" && /\b(incident|failure).{0,40}\b(rate|per device|device)\b/i.test(text)) return true;
  if (field.key === "baseline_avg_it_time_per_incident" && /\b(it|support).{0,40}\b(time|hours?)\b/i.test(text)) return true;
  if (field.key === "baseline_avg_downtime_per_incident" && /\bdowntime.{0,40}\b(hours?|time)\b/i.test(text)) return true;
  if (field.key === "share_of_incidents_causing_downtime" && /\b(downtime).{0,40}\b(share|percent|percentage|rate|portion)\b/i.test(text)) return true;
  if (field.key === "share_of_incidents_requiring_onsite" && /\b(onsite|dispatch).{0,40}\b(share|percent|percentage|rate|portion)\b/i.test(text)) return true;
  if (field.key === "avg_onsite_cost_per_claim" && /\b(onsite|dispatch).{0,40}\b(cost|claim)\b/i.test(text)) return true;
  if (field.key === "ps_price_per_device" && /\bps\b(?!p).{0,40}\b(price|fee|cost)\b/i.test(text)) return true;
  if (field.key === "psp_price_per_device" && /\bpsp\b.{0,40}\b(price|fee|cost)\b/i.test(text)) return true;
  const words = field.label
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return words.some((word) => normalizedText.includes(word));
}

function shouldAcceptExtractedValue(text = "", field, awaitingField) {
  if (field.key === awaitingField && /-?\d+(?:,\d{3})*(?:\.\d+)?%?/.test(text)) return true;
  if (isFieldMentioned(text, field)) return true;
  if (field.key === "devices_in_scope" && /\b\d[\d,]*(?:\.\d+)?\s*(?:devices?|pcs?|laptops?|endpoints?)\b/i.test(text)) return true;
  return false;
}

function findFieldToExplain(schema, text = "") {
  return schema.fields.find((field) => isFieldMentioned(text, field));
}

function buildProgressMessage({
  schema,
  missingField,
  values,
  valueSources,
  acceptedValues,
  appliedDefaults,
  invalidValues,
  intent,
  text
}) {
  const lines = [];

  if (isGreetingOrOpening(text, intent) && !acceptedValues.length && !appliedDefaults.length && !invalidValues.length) {
    lines.push("I can help estimate annual ROI for Lenovo PS and PSP.");
    lines.push("You can share all ROI inputs at once, or we can go one question at a time.");
    lines.push("If a value is unknown, say \"I don't know\" and I will use the benchmark for that item.");
    lines.push("");
  }

  if (appliedDefaults.length) {
    for (const fieldKey of appliedDefaults) {
      const field = schema.fields.find((item) => item.key === fieldKey);
      lines.push(
        `I used the benchmark for ${field.label}: ${formatFieldValue(field, field.defaultValue, "default")}.`
      );
    }
  }

  for (const item of invalidValues) {
    const field = schema.fields.find((candidate) => candidate.key === item.field);
    if (field) {
      lines.push(`${field.label}: ${item.reason}`);
    }
  }

  if (intent === "irrelevant" && !acceptedValues.length && !appliedDefaults.length) {
    lines.push(buildOffTopicBridge(text));
  }

  if (intent === "ask_field_meaning" && !acceptedValues.length && !appliedDefaults.length) {
    const fieldToExplain = findFieldToExplain(schema, text) ?? missingField;
    lines.push(`${fieldToExplain.label} means ${fieldToExplain.description.toLowerCase()}`);
    lines.push("Once that is clear, we can continue the ROI estimate.");
  }

  if (acceptedValues.length) {
    const acceptedLine = acceptedValues
      .map((fieldKey) => {
        const field = schema.fields.find((item) => item.key === fieldKey);
        return `${field.label}: ${formatFieldValue(field, values[field.key], "user")}`;
      })
      .join("; ");
    lines.push(`Captured: ${acceptedLine}.`);
  }

  const captured = schema.fields
    .filter((field) => isUsableNumber(values[field.key]))
    .map((field) => `${field.label}: ${formatFieldValue(field, values[field.key], valueSources[field.key])}`);

  if (captured.length) {
    lines.push("Current inputs:");
    lines.push(...captured);
  }

  lines.push("");
  lines.push(buildQuestion(missingField));

  return lines.join("\n");
}

async function buildFinalMessage(schema, calculation, state, generatePitch) {
  const { metrics } = calculation;
  const pitch = await generatePitch(calculation, state);
  const slotSource =
    state.llmStatus.slotProvider === "gpt-4o-mini-direct"
      ? `GPT-4o mini (${state.llmStatus.slotMode})`
      : "Local fallback";

  return [
    "ROI estimate complete.",
    `Slot filling: ${slotSource}.`,
    state.llmStatus.lastError ? `LLM note: ${state.llmStatus.lastError.message}` : null,
    "",
    "Inputs used:",
    ...schema.fields.map((field) => {
      const source = state.valueSources[field.key];
      return `${field.label}: ${formatFieldValue(field, state.values[field.key], source)}`;
    }),
    "",
    "Baseline:",
    `Annual incidents: ${formatNumber(metrics.baseline.annual_incidents)}`,
    `IT support cost: ${formatCurrency(metrics.baseline.baseline_it_cost)}`,
    `Productivity cost: ${formatCurrency(metrics.baseline.baseline_productivity_cost)}`,
    `Dispatch cost: ${formatCurrency(metrics.baseline.baseline_dispatch_cost)}`,
    `Total baseline cost: ${formatCurrency(metrics.baseline.baseline_total_cost)}`,
    "",
    "PS result:",
    `Warranty cost: ${formatCurrency(metrics.ps_metrics.ps_warranty_cost)}`,
    `Gross savings: ${formatCurrency(metrics.ps_metrics.gross_savings_ps)}`,
    `Net savings: ${formatCurrency(metrics.ps_metrics.net_savings_ps)}`,
    `ROI: ${formatPercent(metrics.ps_metrics.roi_ps)}`,
    "",
    "PSP result:",
    `Warranty cost: ${formatCurrency(metrics.psp_metrics.psp_warranty_cost)}`,
    `Gross savings: ${formatCurrency(metrics.psp_metrics.gross_savings_psp)}`,
    `Net savings: ${formatCurrency(metrics.psp_metrics.net_savings_psp)}`,
    `ROI: ${formatPercent(metrics.psp_metrics.roi_psp)}`,
    "",
    pitch
  ].filter((line) => line !== null).join("\n");
}
