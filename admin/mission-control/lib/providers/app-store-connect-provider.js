import { METRIC_SOURCES, createMetricSnapshot } from "../metric-model.js";

export async function fetchAppStoreConnectMetrics({ appId, rangeKey, sample }) {
  return sample.appStoreFunnel.map((step) =>
    createMetricSnapshot({
      appId,
      source: METRIC_SOURCES.APP_STORE_CONNECT,
      metricName: step.key,
      metricValue: step.valueByRange[rangeKey] || step.valueByRange["7d"],
      dimension: { label: step.label },
      rangeKey
    })
  );
}

export const appStoreConnectIntegrationNotes = {
  requiredServerEnv: ["APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_PRIVATE_KEY"],
  implementation: "Generate App Store Connect JWTs server-side and normalize app analytics reports into MetricSnapshot records."
};
