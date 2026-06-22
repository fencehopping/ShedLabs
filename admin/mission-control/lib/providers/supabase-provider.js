import { METRIC_SOURCES, createMetricSnapshot } from "../metric-model.js";

export async function fetchSupabaseMetrics({ appId, rangeKey, sample }) {
  return sample.productEvents.map((event) =>
    createMetricSnapshot({
      appId,
      source: METRIC_SOURCES.SUPABASE,
      metricName: event.key,
      metricValue: event.valueByRange[rangeKey] || event.valueByRange["7d"],
      dimension: { label: event.label, area: event.area },
      rangeKey
    })
  );
}

export const supabaseIntegrationNotes = {
  requiredServerEnv: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  implementation: "Aggregate product events in a server endpoint or scheduled job. Do not expose service-role keys in browser code."
};
