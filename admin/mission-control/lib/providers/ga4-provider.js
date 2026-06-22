import { METRIC_SOURCES, createMetricSnapshot } from "../metric-model.js";

export async function fetchGa4Metrics({ appId, rangeKey, sample }) {
  const traffic = sample.trafficByRange[rangeKey] || sample.trafficByRange["7d"];
  const activeUsers = traffic.reduce((sum, point) => sum + point.value, 0);
  const sessions = Math.round(activeUsers * sample.sessionMultiplier);

  return [
    createMetricSnapshot({
      appId,
      source: METRIC_SOURCES.GA4,
      metricName: "active_users",
      metricValue: activeUsers,
      rangeKey
    }),
    createMetricSnapshot({
      appId,
      source: METRIC_SOURCES.GA4,
      metricName: "sessions",
      metricValue: sessions,
      rangeKey
    })
  ];
}

export const ga4IntegrationNotes = {
  requiredServerEnv: ["GA4_PROPERTY_ID", "GOOGLE_APPLICATION_CREDENTIALS_JSON"],
  implementation: "Call GA4 Data API from a server or edge function. Never ship service account JSON to the frontend."
};
