import assert from "node:assert/strict";
import { calculatePsPspRoi } from "../src/calculators/psPspRoiCalculator.js";
import { createDialogueManager } from "../src/agent/dialogueManager.js";
import { psPspRoiSchema } from "../src/domain/schema.js";

const defaultInputs = Object.fromEntries(
  psPspRoiSchema.fields.map((field) => [field.key, field.defaultValue])
);

testCalculator();
await testAllValuesInOneMessage();
await testDefaultsForUnknownValues();
await testSingleBareNumberDoesNotAutoDefault();
await testUseAllBenchmarksRequiresExplicitRequest();
await testJumpAheadKeepsEarliestMissingField();
await testGreetingOnboarding();
await testComplaintRecovery();
await testPercentNormalization();
await testUnrelatedFallback();
await testInvalidValues();

console.log("all tests passed");

function testCalculator() {
  const result = calculatePsPspRoi(defaultInputs);

  assert.equal(result.metrics.baseline.annual_incidents, 6000);
  assert.equal(result.metrics.baseline.baseline_it_cost, 240000);
  assert.equal(result.metrics.baseline.baseline_productivity_cost, 576000);
  assert.equal(result.metrics.baseline.baseline_dispatch_cost, 300000);
  assert.equal(result.metrics.baseline.baseline_total_cost, 1116000);

  assert.equal(result.metrics.ps_metrics.ps_it_cost, 120000);
  assert.equal(result.metrics.ps_metrics.ps_productivity_cost, 288000);
  assert.equal(result.metrics.ps_metrics.ps_dispatch_cost, 0);
  assert.equal(result.metrics.ps_metrics.ps_total_cost, 408000);
  assert.equal(result.metrics.ps_metrics.ps_warranty_cost, 300000);
  assert.equal(result.metrics.ps_metrics.gross_savings_ps, 708000);
  assert.equal(result.metrics.ps_metrics.net_savings_ps, 372600);
  assert.equal(result.metrics.ps_metrics.roi_ps, 1.242);

  assert.equal(result.metrics.psp_metrics.psp_annual_incidents, 4800);
  assert.equal(result.metrics.psp_metrics.psp_it_cost, 96000);
  assert.equal(result.metrics.psp_metrics.psp_productivity_cost, 230400);
  assert.equal(result.metrics.psp_metrics.psp_dispatch_cost, 0);
  assert.equal(result.metrics.psp_metrics.psp_total_cost, 326400);
  assert.equal(result.metrics.psp_metrics.psp_warranty_cost, 500000);
  assert.equal(result.metrics.psp_metrics.gross_savings_psp, 789600);
  assert.equal(result.metrics.psp_metrics.net_savings_psp, 250120);
  assert.equal(result.metrics.psp_metrics.roi_psp, 0.50024);
}

async function testAllValuesInOneMessage() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "provide_values",
      values: defaultInputs,
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage(
    [
      "Devices in scope are 10000.",
      "End user hourly cost is 60.",
      "IT support hourly cost is 40.",
      "Incident rate per device is 0.6.",
      "IT time per incident is 1 hour.",
      "Downtime is 2 hours.",
      "Downtime share is 80%.",
      "Onsite dispatch share is 20%.",
      "Onsite cost is 250.",
      "PS price is 30 and PSP price is 50."
    ].join(" ")
  );

  assert.equal(response.state.completed, true);
  assert.match(response.message, /ROI estimate complete/);
  assert.match(response.message, /PS result/);
  assert.match(response.message, /PSP result/);
}

async function testDefaultsForUnknownValues() {
  const manager = createDialogueManager({
    extractFields: async (_text, context) => ({
      intent: "provide_values",
      values: {},
      defaultFields: [context.awaitingField],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("I don't know, use the benchmark.");

  assert.equal(response.state.values.devices_in_scope, 10000);
  assert.equal(response.state.valueSources.devices_in_scope, "default");
  assert.match(response.message, /benchmark/);
  assert.equal(response.state.completed, false);
  assert.equal(response.state.awaitingField, "blended_end_user_cost");
}

async function testSingleBareNumberDoesNotAutoDefault() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "provide_values",
      values: {
        devices_in_scope: 9000,
        blended_end_user_cost: 60,
        blended_it_support_cost: 40,
        baseline_incidents_per_device: 0.6,
        baseline_avg_it_time_per_incident: 1,
        baseline_avg_downtime_per_incident: 2,
        share_of_incidents_causing_downtime: 0.8,
        share_of_incidents_requiring_onsite: 0.2,
        avg_onsite_cost_per_claim: 250,
        ps_price_per_device: 30,
        psp_price_per_device: 50
      },
      defaultFields: ["*"],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("9000");

  assert.equal(response.state.completed, false);
  assert.equal(response.state.values.devices_in_scope, 9000);
  assert.equal(response.state.values.blended_end_user_cost, undefined);
  assert.equal(response.state.awaitingField, "blended_end_user_cost");
  assert.match(response.message, /What is the blended employee hourly cost/);
}

async function testUseAllBenchmarksRequiresExplicitRequest() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "use_all_benchmarks",
      values: {},
      defaultFields: ["*"],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("Use all benchmarks for the remaining fields.");

  assert.equal(response.state.completed, true);
  assert.equal(response.state.valueSources.devices_in_scope, "default");
  assert.match(response.message, /ROI estimate complete/);
}

async function testJumpAheadKeepsEarliestMissingField() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "provide_values",
      values: {
        avg_onsite_cost_per_claim: 300
      },
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("The onsite dispatch cost is 300 per claim.");

  assert.equal(response.state.completed, false);
  assert.equal(response.state.values.avg_onsite_cost_per_claim, 300);
  assert.equal(response.state.awaitingField, "devices_in_scope");
  assert.match(response.message, /Captured: Average Onsite Cost per Claim/);
  assert.match(response.message, /How many devices/);
}

async function testGreetingOnboarding() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "greeting_or_opening",
      values: {},
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("hello");

  assert.equal(response.state.completed, false);
  assert.match(response.message, /You can share all ROI inputs at once/);
  assert.match(response.message, /How many devices/);
}

async function testComplaintRecovery() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "complaint_or_confusion",
      values: {},
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("Where did you get all this data?");

  assert.equal(response.state.completed, false);
  assert.match(response.message, /should not assume values/);
  assert.match(response.message, /How many devices/);
}

async function testPercentNormalization() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "provide_values",
      values: {
        ...defaultInputs,
        share_of_incidents_causing_downtime: 80,
        share_of_incidents_requiring_onsite: 20
      },
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage(
    [
      "Devices in scope are 10000.",
      "End user hourly cost is 60.",
      "IT support hourly cost is 40.",
      "Incident rate per device is 0.6.",
      "IT time per incident is 1 hour.",
      "Downtime is 2 hours.",
      "Downtime share is 80%.",
      "Onsite dispatch share is 20%.",
      "Onsite cost is 250.",
      "PS price is 30 and PSP price is 50."
    ].join(" ")
  );

  assert.equal(response.state.values.share_of_incidents_causing_downtime, 0.8);
  assert.equal(response.state.values.share_of_incidents_requiring_onsite, 0.2);
  assert.equal(response.state.completed, true);
}

async function testUnrelatedFallback() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "irrelevant",
      values: {},
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("Can you tell me a joke?");

  assert.equal(response.state.completed, false);
  assert.match(response.message, /collect the ROI inputs/i);
  assert.match(response.message, /How many devices/);
}

async function testInvalidValues() {
  const manager = createDialogueManager({
    extractFields: async () => ({
      intent: "provide_values",
      values: {
        devices_in_scope: -1
      },
      defaultFields: [],
      invalidValues: []
    }),
    generatePitch: async () => "Pitch generated."
  });

  manager.reset();
  const response = await manager.handleUserMessage("-1 devices");

  assert.equal(response.state.completed, false);
  assert.equal(response.state.values.devices_in_scope, undefined);
  assert.match(response.message, /must be at least 1/);
}
