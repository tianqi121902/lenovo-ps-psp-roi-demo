export const psPspAssumptions = {
  ps_reduction_in_it_time: 0.5,
  ps_reduction_in_downtime: 0.5,
  ps_reduction_in_onsite_cost: 1.0,
  psp_reduction_in_incidents: 0.2,
  conservative_buffer: 0.05
};

export function calculatePsPspRoi(input, assumptions = psPspAssumptions) {
  const annual_incidents = input.devices_in_scope * input.baseline_incidents_per_device;
  const baseline_it_cost =
    annual_incidents * input.baseline_avg_it_time_per_incident * input.blended_it_support_cost;
  const baseline_productivity_cost =
    annual_incidents *
    input.share_of_incidents_causing_downtime *
    input.baseline_avg_downtime_per_incident *
    input.blended_end_user_cost;
  const baseline_dispatch_cost =
    annual_incidents * input.share_of_incidents_requiring_onsite * input.avg_onsite_cost_per_claim;
  const baseline_total_cost = baseline_it_cost + baseline_productivity_cost + baseline_dispatch_cost;

  const ps_it_cost = baseline_it_cost * (1 - assumptions.ps_reduction_in_it_time);
  const ps_productivity_cost =
    baseline_productivity_cost * (1 - assumptions.ps_reduction_in_downtime);
  const ps_dispatch_cost =
    baseline_dispatch_cost * (1 - assumptions.ps_reduction_in_onsite_cost);
  const ps_total_cost = ps_it_cost + ps_productivity_cost + ps_dispatch_cost;
  const ps_warranty_cost = input.devices_in_scope * input.ps_price_per_device;
  const gross_savings_ps = baseline_total_cost - ps_total_cost;
  const net_savings_ps =
    gross_savings_ps * (1 - assumptions.conservative_buffer) - ps_warranty_cost;
  const roi_ps = ps_warranty_cost === 0 ? 0 : net_savings_ps / ps_warranty_cost;

  const psp_annual_incidents =
    annual_incidents * (1 - assumptions.psp_reduction_in_incidents);
  const psp_it_cost =
    psp_annual_incidents *
    input.baseline_avg_it_time_per_incident *
    input.blended_it_support_cost *
    (1 - assumptions.ps_reduction_in_it_time);
  const psp_productivity_cost =
    psp_annual_incidents *
    input.share_of_incidents_causing_downtime *
    input.baseline_avg_downtime_per_incident *
    input.blended_end_user_cost *
    (1 - assumptions.ps_reduction_in_downtime);
  const psp_dispatch_cost =
    psp_annual_incidents *
    input.share_of_incidents_requiring_onsite *
    input.avg_onsite_cost_per_claim *
    (1 - assumptions.ps_reduction_in_onsite_cost);
  const psp_total_cost = psp_it_cost + psp_productivity_cost + psp_dispatch_cost;
  const psp_warranty_cost = input.devices_in_scope * input.psp_price_per_device;
  const gross_savings_psp = baseline_total_cost - psp_total_cost;
  const net_savings_psp =
    gross_savings_psp * (1 - assumptions.conservative_buffer) - psp_warranty_cost;
  const roi_psp = psp_warranty_cost === 0 ? 0 : net_savings_psp / psp_warranty_cost;

  return {
    serviceType: "ps-psp-roi",
    input,
    assumptions,
    formula: [
      "annual_incidents = devices_in_scope * baseline_incidents_per_device",
      "baseline_total_cost = baseline_it_cost + baseline_productivity_cost + baseline_dispatch_cost",
      "gross_savings_ps = baseline_total_cost - ps_total_cost",
      "net_savings_ps = (gross_savings_ps * (1 - conservative_buffer)) - ps_warranty_cost",
      "roi_ps = net_savings_ps / ps_warranty_cost",
      "psp_annual_incidents = annual_incidents * (1 - psp_reduction_in_incidents)",
      "gross_savings_psp = baseline_total_cost - psp_total_cost",
      "net_savings_psp = (gross_savings_psp * (1 - conservative_buffer)) - psp_warranty_cost",
      "roi_psp = net_savings_psp / psp_warranty_cost"
    ],
    metrics: {
      baseline: {
        annual_incidents,
        baseline_it_cost,
        baseline_productivity_cost,
        baseline_dispatch_cost,
        baseline_total_cost
      },
      ps_metrics: {
        ps_it_cost,
        ps_productivity_cost,
        ps_dispatch_cost,
        ps_total_cost,
        ps_warranty_cost,
        gross_savings_ps,
        net_savings_ps,
        roi_ps
      },
      psp_metrics: {
        psp_annual_incidents,
        psp_it_cost,
        psp_productivity_cost,
        psp_dispatch_cost,
        psp_total_cost,
        psp_warranty_cost,
        gross_savings_psp,
        net_savings_psp,
        roi_psp
      }
    }
  };
}
