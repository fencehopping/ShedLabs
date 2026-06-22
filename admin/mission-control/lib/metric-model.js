/**
 * @typedef {"ga4" | "app_store_connect" | "supabase" | "stripe" | "manual"} MetricSource
 *
 * @typedef {Object} MetricSnapshot
 * @property {string} id
 * @property {string} appId
 * @property {MetricSource} source
 * @property {string} metricName
 * @property {number} metricValue
 * @property {Record<string, string | number | boolean | null>=} dimension
 * @property {string} periodStart
 * @property {string} periodEnd
 * @property {string} fetchedAt
 */

export const METRIC_SOURCES = Object.freeze({
  GA4: "ga4",
  APP_STORE_CONNECT: "app_store_connect",
  SUPABASE: "supabase",
  STRIPE: "stripe",
  MANUAL: "manual"
});

export const RANGE_DAYS = Object.freeze({
  today: 1,
  "7d": 7,
  "30d": 30
});

export function getPeriodForRange(rangeKey) {
  const days = RANGE_DAYS[rangeKey] || RANGE_DAYS["7d"];
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString()
  };
}

export function createMetricSnapshot({ appId, source, metricName, metricValue, dimension, rangeKey }) {
  const period = getPeriodForRange(rangeKey);

  return {
    id: [appId, source, metricName, rangeKey, JSON.stringify(dimension || {})].join(":"),
    appId,
    source,
    metricName,
    metricValue,
    dimension,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    fetchedAt: new Date().toISOString()
  };
}
