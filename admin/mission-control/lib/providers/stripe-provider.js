import { METRIC_SOURCES, createMetricSnapshot } from "../metric-model.js";

export async function fetchStripeMetrics({ appId, rangeKey, sample }) {
  if (!sample.revenueByRange) {
    return [];
  }

  return [
    createMetricSnapshot({
      appId,
      source: METRIC_SOURCES.STRIPE,
      metricName: "gross_revenue",
      metricValue: sample.revenueByRange[rangeKey] || sample.revenueByRange["7d"],
      rangeKey
    })
  ];
}

export const stripeIntegrationNotes = {
  requiredServerEnv: ["STRIPE_SECRET_KEY"],
  implementation: "Fetch balances, subscriptions, invoices, or checkout events server-side and return normalized MetricSnapshot records."
};
