export const psPspRoiSchema = {
  serviceType: "ps-psp-roi",
  label: "PS / PSP ROI",
  fields: [
    {
      key: "devices_in_scope",
      label: "Devices in Scope",
      unit: "devices",
      prompt: "How many devices are in scope for this ROI estimate? The benchmark value is 10,000 devices.",
      description: "Total number of devices covered by the assessment.",
      defaultValue: 10000,
      min: 1
    },
    {
      key: "blended_end_user_cost",
      label: "Blended End User Cost",
      unit: "per hour",
      prompt: "What is the blended employee hourly cost? The benchmark value is $60 per hour.",
      description: "Average hourly cost for employees affected by downtime.",
      defaultValue: 60,
      min: 0
    },
    {
      key: "blended_it_support_cost",
      label: "Blended IT Support Cost",
      unit: "per hour",
      prompt: "What is the blended IT support hourly cost? The benchmark value is $40 per hour.",
      description: "Average hourly cost for IT support staff.",
      defaultValue: 40,
      min: 0
    },
    {
      key: "baseline_incidents_per_device",
      label: "Baseline Incidents per Device",
      unit: "incidents/device/year",
      prompt: "What is the baseline annual incident rate per device? The benchmark value is 0.6 incidents per device per year.",
      description: "Average number of support incidents per device each year.",
      defaultValue: 0.6,
      min: 0
    },
    {
      key: "baseline_avg_it_time_per_incident",
      label: "Baseline IT Time per Incident",
      unit: "hours",
      prompt: "How many IT support hours does one incident take on average? The benchmark value is 1 hour.",
      description: "Average IT support time spent per incident.",
      defaultValue: 1,
      min: 0
    },
    {
      key: "baseline_avg_downtime_per_incident",
      label: "Baseline Downtime per Incident",
      unit: "hours",
      prompt: "How many employee downtime hours does one incident cause on average? The benchmark value is 2 hours.",
      description: "Average employee downtime caused by one incident.",
      defaultValue: 2,
      min: 0
    },
    {
      key: "share_of_incidents_causing_downtime",
      label: "Incidents Causing Downtime",
      unit: "%",
      prompt: "What share of incidents causes downtime? The benchmark value is 80%.",
      description: "Percentage of incidents that create employee downtime.",
      defaultValue: 0.8,
      min: 0,
      max: 1,
      valueType: "share"
    },
    {
      key: "share_of_incidents_requiring_onsite",
      label: "Incidents Requiring Onsite Dispatch",
      unit: "%",
      prompt: "What share of incidents requires onsite dispatch? The benchmark value is 20%.",
      description: "Percentage of incidents that require onsite service.",
      defaultValue: 0.2,
      min: 0,
      max: 1,
      valueType: "share"
    },
    {
      key: "avg_onsite_cost_per_claim",
      label: "Average Onsite Cost per Claim",
      unit: "per claim",
      prompt: "What is the average onsite dispatch cost per claim? The benchmark value is $250.",
      description: "Average cost of one onsite service dispatch.",
      defaultValue: 250,
      min: 0
    },
    {
      key: "ps_price_per_device",
      label: "PS Price per Device",
      unit: "per device/year",
      prompt: "What is the annual PS price per device? The benchmark value is $30.",
      description: "Annual Protect Service price per device.",
      defaultValue: 30,
      min: 0
    },
    {
      key: "psp_price_per_device",
      label: "PSP Price per Device",
      unit: "per device/year",
      prompt: "What is the annual PSP price per device? The benchmark value is $50.",
      description: "Annual Protect Service Plus price per device.",
      defaultValue: 50,
      min: 0
    }
  ]
};

export const schemas = {
  "ps-psp-roi": psPspRoiSchema
};
