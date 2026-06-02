import { createDialogueManager } from "./agent/dialogueManager.js";
import { schemas } from "./domain/schema.js";
import { formatFieldValue } from "./utils/format.js";
import {
  DEFAULT_DIRECT_LLM_CONFIG,
  getDirectLlmConfig,
  hasDirectLlmConfig,
  saveDirectLlmConfig,
  testDirectLlmConnection
} from "./llm/browserProvider.js";

const manager = createDialogueManager();
const messagesEl = document.querySelector("#messages");
const formEl = document.querySelector("#chatForm");
const inputEl = document.querySelector("#messageInput");
const resetButton = document.querySelector("#resetButton");
const fieldListEl = document.querySelector("#fieldList");
const apiKeyInput = document.querySelector("#apiKeyInput");
const baseUrlInput = document.querySelector("#baseUrlInput");
const modelInput = document.querySelector("#modelInput");
const saveLlmButton = document.querySelector("#saveLlmButton");
const testLlmButton = document.querySelector("#testLlmButton");
const llmStatus = document.querySelector("#llmStatus");

function appendMessage(role, text) {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  item.textContent = text;
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderFields(state) {
  const schema = schemas[state.serviceType];
  fieldListEl.innerHTML = "";

  schema.fields.forEach((field) => {
    const row = document.createElement("div");
    row.className = "field-row";

    const term = document.createElement("dt");
    term.textContent = field.label;

    const detail = document.createElement("dd");
    const value = state.values[field.key];
    detail.textContent = formatFieldValue(field, value, state.valueSources?.[field.key]);
    if (value === undefined) {
      detail.className = "empty-value";
    } else if (state.valueSources?.[field.key] === "default") {
      detail.className = "default-value";
    }

    row.append(term, detail);
    fieldListEl.appendChild(row);
  });
}

function boot() {
  const response = manager.reset();
  messagesEl.innerHTML = "";
  appendMessage("agent", response.message);
  renderFields(response.state);
  renderLlmSettings();
  inputEl.focus();
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  appendMessage("user", text);
  inputEl.value = "";
  inputEl.disabled = true;

  try {
    const response = await manager.handleUserMessage(text);
    appendMessage("agent", response.message);
    renderFields(response.state);
    renderLlmRuntimeStatus(response.state.llmStatus);
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
});

resetButton.addEventListener("click", boot);

saveLlmButton.addEventListener("click", () => {
  saveDirectLlmConfig({
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    model: modelInput.value
  });
  renderLlmSettings();
  appendMessage(
    "agent",
    "Settings saved. Click Test LLM Connection to verify access."
  );
});

testLlmButton.addEventListener("click", async () => {
  saveDirectLlmConfig({
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    model: modelInput.value
  });
  renderLlmSettings("Testing GPT-4o mini connection...", "status-warning");
  testLlmButton.disabled = true;

  try {
    const result = await testDirectLlmConnection();
    if (result.ok) {
      renderLlmSettings(result.message, "status-ok");
      appendMessage("agent", result.message);
    } else {
      renderLlmSettings(result.message, "status-error");
      appendMessage("agent", `LLM connection test failed: ${result.message}`);
    }
  } finally {
    testLlmButton.disabled = false;
    inputEl.focus();
  }
});

boot();

function renderLlmSettings(message, statusClass) {
  const config = getDirectLlmConfig();
  apiKeyInput.value = config.apiKey;
  baseUrlInput.value = config.baseUrl || DEFAULT_DIRECT_LLM_CONFIG.baseUrl;
  modelInput.value = config.model || DEFAULT_DIRECT_LLM_CONFIG.model;
  llmStatus.textContent = message || (hasDirectLlmConfig()
    ? "Direct GPT-4o mini mode is configured for this browser."
    : "No API key saved. The demo will use local fallback extraction until LLM settings are saved.");
  llmStatus.className = `status-text ${statusClass || ""}`.trim();
}

function renderLlmRuntimeStatus(status) {
  if (!status) return;
  if (status.slotProvider === "gpt-4o-mini-direct") {
    renderLlmSettings(`Last slot filling: GPT-4o mini (${status.slotMode}).`, "status-ok");
    return;
  }
  if (status.lastError) {
    renderLlmSettings(`Last slot filling: Local fallback. GPT issue: ${status.lastError.message}`, "status-warning");
    return;
  }
  if (status.slotProvider === "local-fallback") {
    renderLlmSettings("Last slot filling: Local fallback.", "status-warning");
  }
}
