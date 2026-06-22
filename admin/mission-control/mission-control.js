import { PROJECTS, SOURCE_HEALTH, ADMIN_EMAIL } from "./lib/sample-data.js";
import { fetchGa4Metrics } from "./lib/providers/ga4-provider.js";
import { fetchAppStoreConnectMetrics } from "./lib/providers/app-store-connect-provider.js";
import { fetchSupabaseMetrics } from "./lib/providers/supabase-provider.js";
import { fetchStripeMetrics } from "./lib/providers/stripe-provider.js";

const state = {
  projectId: "all-projects",
  rangeKey: "7d"
};

const nodes = {
  shell: document.querySelector(".mission-shell"),
  lockScreen: document.querySelector("[data-lock-screen]"),
  dashboard: document.querySelector("[data-dashboard]"),
  gate: document.querySelector("[data-admin-gate]"),
  gateMessage: document.querySelector("[data-gate-message]"),
  lockButton: document.querySelector("[data-lock-button]"),
  projectSelect: document.querySelector("[data-project-select]"),
  rangeGroup: document.querySelector("[data-range-group]"),
  summaryGrid: document.querySelector("[data-summary-grid]"),
  chart: document.querySelector("[data-traffic-chart]"),
  chartTotal: document.querySelector("[data-chart-total]"),
  funnelList: document.querySelector("[data-funnel-list]"),
  eventsTable: document.querySelector("[data-events-table]"),
  sourceList: document.querySelector("[data-source-list]")
};

init();

function init() {
  populateProjectSelect();
  bindEvents();

  if (sessionStorage.getItem("shedlabs_admin_email") === ADMIN_EMAIL) {
    unlockDashboard();
  }
}

function bindEvents() {
  nodes.gate.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(nodes.gate);
    const email = String(form.get("email") || "").trim().toLowerCase();

    if (email !== ADMIN_EMAIL) {
      nodes.gateMessage.textContent = "This dashboard is limited to nickholroyd@gmail.com.";
      return;
    }

    sessionStorage.setItem("shedlabs_admin_email", email);
    unlockDashboard();
  });

  nodes.lockButton.addEventListener("click", () => {
    sessionStorage.removeItem("shedlabs_admin_email");
    nodes.shell.dataset.authState = "locked";
    nodes.dashboard.hidden = true;
    nodes.lockScreen.hidden = false;
  });

  nodes.projectSelect.addEventListener("change", (event) => {
    state.projectId = event.target.value;
    render();
  });

  nodes.rangeGroup.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) {
      return;
    }

    state.rangeKey = button.dataset.range;
    nodes.rangeGroup.querySelectorAll("[data-range]").forEach((rangeButton) => {
      rangeButton.classList.toggle("is-active", rangeButton === button);
    });
    render();
  });
}

function unlockDashboard() {
  nodes.shell.dataset.authState = "unlocked";
  nodes.lockScreen.hidden = true;
  nodes.dashboard.hidden = false;
  render();
}

function populateProjectSelect() {
  nodes.projectSelect.innerHTML = PROJECTS.map((project) => {
    return `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`;
  }).join("");
  nodes.projectSelect.value = state.projectId;
}

async function render() {
  const project = PROJECTS.find((item) => item.id === state.projectId) || PROJECTS[0];
  const [ga4Metrics, appStoreMetrics, supabaseMetrics, stripeMetrics] = await Promise.all([
    fetchGa4Metrics({ appId: project.id, rangeKey: state.rangeKey, sample: project }),
    fetchAppStoreConnectMetrics({ appId: project.id, rangeKey: state.rangeKey, sample: project }),
    fetchSupabaseMetrics({ appId: project.id, rangeKey: state.rangeKey, sample: project }),
    fetchStripeMetrics({ appId: project.id, rangeKey: state.rangeKey, sample: project })
  ]);

  const metrics = [...ga4Metrics, ...appStoreMetrics, ...supabaseMetrics, ...stripeMetrics];

  renderSummary(metrics);
  renderTraffic(project);
  renderFunnel(appStoreMetrics);
  renderEvents(supabaseMetrics);
  renderSources();
}

function renderSummary(metrics) {
  const activeUsers = getMetric(metrics, "active_users");
  const downloads = getMetric(metrics, "downloads");
  const events = metrics.filter((metric) => metric.source === "supabase").reduce((sum, metric) => sum + metric.metricValue, 0);
  const revenue = getMetric(metrics, "gross_revenue");

  const cards = [
    { label: "Active users", value: formatNumber(activeUsers), delta: "+12% sample", source: "GA4" },
    { label: "Downloads", value: formatNumber(downloads), delta: "+8% sample", source: "App Store Connect" },
    { label: "Tracked events", value: formatNumber(events), delta: "+15% sample", source: "Supabase" },
    { label: "Revenue", value: formatCurrency(revenue), delta: revenue > 0 ? "+5% sample" : "Optional", source: "Stripe" }
  ];

  nodes.summaryGrid.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <div class="summary-label">${escapeHtml(card.label)}</div>
      <div class="summary-value">${escapeHtml(card.value)}</div>
      <div class="summary-delta">${escapeHtml(card.delta)}</div>
      <div class="summary-source">${escapeHtml(card.source)}</div>
    </article>
  `).join("");
}

function renderTraffic(project) {
  const points = project.trafficByRange[state.rangeKey] || project.trafficByRange["7d"];
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  nodes.chart.style.setProperty("--chart-count", String(points.length));
  nodes.chartTotal.textContent = `${formatNumber(total)} total`;
  nodes.chart.innerHTML = points.map((point) => {
    const height = Math.max(5, Math.round((point.value / maxValue) * 100));
    return `
      <div class="chart-bar" style="--bar-height: ${height}" title="${escapeHtml(point.value)} active users">
        <span>${escapeHtml(point.label)}</span>
      </div>
    `;
  }).join("");
}

function renderFunnel(metrics) {
  const maxValue = Math.max(...metrics.map((metric) => metric.metricValue), 1);

  nodes.funnelList.innerHTML = metrics.map((metric) => {
    const label = metric.dimension && metric.dimension.label ? String(metric.dimension.label) : metric.metricName;
    const width = Math.max(4, Math.round((metric.metricValue / maxValue) * 100));

    return `
      <div class="funnel-item">
        <div class="funnel-top">
          <span>${escapeHtml(label)}</span>
          <span class="funnel-value">${formatNumber(metric.metricValue)}</span>
        </div>
        <div class="funnel-track" style="--funnel-width: ${width}%"><span></span></div>
      </div>
    `;
  }).join("");
}

function renderEvents(metrics) {
  nodes.eventsTable.innerHTML = metrics.map((metric) => {
    const label = metric.dimension && metric.dimension.label ? String(metric.dimension.label) : metric.metricName;
    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatSource(metric.source)}</td>
        <td>${formatNumber(metric.metricValue)}</td>
        <td>${formatWindow(metric.periodStart, metric.periodEnd)}</td>
      </tr>
    `;
  }).join("");
}

function renderSources() {
  nodes.sourceList.innerHTML = SOURCE_HEALTH.map((source) => `
    <div class="source-item">
      <div class="source-top">
        <strong>${escapeHtml(source.source)}</strong>
        <span class="source-state" data-state="${escapeHtml(source.state)}">${escapeHtml(source.state)}</span>
      </div>
      <div class="source-meta">${escapeHtml(source.detail)}</div>
    </div>
  `).join("");
}

function getMetric(metrics, metricName) {
  const metric = metrics.find((item) => item.metricName === metricName);
  return metric ? metric.metricValue : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatSource(source) {
  return source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWindow(start, end) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
