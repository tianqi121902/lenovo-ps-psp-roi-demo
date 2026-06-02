export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

export function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatFieldValue(field, value, source) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "Missing";
  }

  const suffix = source === "default" ? " (benchmark)" : "";

  if (field.valueType === "share" || field.unit === "%") {
    return `${formatPercent(value)}${suffix}`;
  }

  if (field.unit?.startsWith("per") || field.key.includes("cost") || field.key.includes("price")) {
    return `${formatCurrency(value)} ${field.unit}${suffix}`;
  }

  return `${formatNumber(value)} ${field.unit}${suffix}`;
}
