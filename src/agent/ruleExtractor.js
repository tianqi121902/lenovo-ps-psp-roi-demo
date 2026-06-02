import { schemas } from "../domain/schema.js";

const UNKNOWN_PATTERN =
  /\b(i do not know|i don't know|not sure|unknown|use benchmark|use the benchmark|use default|use the default|benchmark|default)\b/i;
const ALL_BENCHMARK_PATTERN =
  /\b(use|apply|take)\b.{0,24}\b(all|everything|remaining|rest)\b.{0,24}\b(benchmark|benchmarks|default|defaults)\b/i;
const GREETING_PATTERN = /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i;
const COMPLAINT_PATTERN =
  /\b(where did you get|why did you assume|you assumed|i only told|haven't asked|have not asked|not what i said|wrong data)\b/i;

const FIELD_PATTERNS = {
  devices_in_scope: [
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:devices?|pcs?|laptops?|endpoints?)\b/i,
    /(?:devices?\s+in\s+scope|device\s+count|endpoint\s+count)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  blended_end_user_cost: [
    /(?:end\s*user|employee|user).{0,40}?(?:cost|wage|rate|hourly)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /(?:cost|wage|rate|hourly).{0,40}?(?:end\s*user|employee|user)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  blended_it_support_cost: [
    /(?:it|support).{0,40}?(?:cost|wage|rate|hourly)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /(?:cost|wage|rate|hourly).{0,40}?(?:it|support)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  baseline_incidents_per_device: [
    /(?:incident|failure).{0,50}?(?:rate|per device|device)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)/i,
    /(?:baseline).{0,50}?(?:incident|failure)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)/i
  ],
  baseline_avg_it_time_per_incident: [
    /(?:it|support).{0,40}?(?:time|hours?).{0,30}?(?:incident|case|ticket)?\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  baseline_avg_downtime_per_incident: [
    /(?:downtime).{0,40}?(?:hours?|time).{0,30}?(?:incident|case|ticket)?\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  share_of_incidents_causing_downtime: [
    /(?:downtime).{0,40}?(?:share|percent|percentage|rate|portion)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)/i,
    /(-?\d+(?:,\d{3})*(?:\.\d+)?%?)\s*(?:of incidents).{0,40}?(?:downtime)/i
  ],
  share_of_incidents_requiring_onsite: [
    /(?:onsite|dispatch).{0,40}?(?:share|percent|percentage|rate|portion)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)/i,
    /(-?\d+(?:,\d{3})*(?:\.\d+)?%?)\s*(?:of incidents).{0,40}?(?:onsite|dispatch)/i
  ],
  avg_onsite_cost_per_claim: [
    /(?:onsite|dispatch).{0,40}?(?:cost|claim)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  ps_price_per_device: [
    /\bps\b(?!p).{0,40}?(?:price|fee|cost)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /(?:price|fee|cost).{0,40}?\bps\b(?!p)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ],
  psp_price_per_device: [
    /\bpsp\b.{0,40}?(?:price|fee|cost)\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /(?:price|fee|cost).{0,40}?\bpsp\b\D*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i
  ]
};

export function extractFieldsByRule(text, awaitingField, serviceType = "ps-psp-roi") {
  const schema = schemas[serviceType];
  const values = {};
  const defaultFields = [];
  const normalized = text.replace(/，/g, ",").replace(/％/g, "%");

  if (ALL_BENCHMARK_PATTERN.test(normalized)) {
    defaultFields.push("*");
  } else if (UNKNOWN_PATTERN.test(normalized) && awaitingField) {
    defaultFields.push(awaitingField);
  }

  for (const field of schema.fields) {
    const matched = matchFieldValue(normalized, field);
    if (matched !== undefined) {
      values[field.key] = matched;
    }
  }

  if (awaitingField && values[awaitingField] === undefined && !UNKNOWN_PATTERN.test(normalized)) {
    const direct = normalized.match(/-?\d+(?:,\d{3})*(?:\.\d+)?%?/);
    if (direct) {
      const field = schema.fields.find((item) => item.key === awaitingField);
      values[awaitingField] = normalizeFieldValue(field, direct[0]);
    }
  }

  return {
    intent: inferIntent(normalized, values, defaultFields),
    values,
    defaultFields,
    invalidValues: []
  };
}

function inferIntent(text, values, defaultFields) {
  if (COMPLAINT_PATTERN.test(text)) return "complaint_or_confusion";
  if (ALL_BENCHMARK_PATTERN.test(text)) return "use_all_benchmarks";
  if (defaultFields.length) return "unknown_use_current_benchmark";
  if (Object.keys(values).length > 0) return "provide_values";
  if (GREETING_PATTERN.test(text)) return "greeting_or_opening";
  return "irrelevant";
}

function matchFieldValue(text, field) {
  const patterns = FIELD_PATTERNS[field.key] ?? [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return normalizeFieldValue(field, match[1]);
    }
  }
  return undefined;
}

function normalizeFieldValue(field, rawValue) {
  const rawText = String(rawValue);
  const value = Number(rawText.replace(/,/g, "").replace("%", ""));
  if (!Number.isFinite(value)) return undefined;
  if (field?.valueType === "share") {
    return rawText.includes("%") || value > 1 ? value / 100 : value;
  }
  return value;
}
