export const ADMIN_EMAIL = "nickholroyd@gmail.com";

export const PROJECTS = [
  {
    id: "all-projects",
    name: "All Shed Labs projects",
    sessionMultiplier: 1.34,
    trafficByRange: {
      today: points([188]),
      "7d": points([162, 188, 221, 198, 244, 272, 310]),
      "30d": points([64, 71, 88, 92, 104, 117, 122, 136, 128, 144, 151, 168, 176, 181, 174, 190, 207, 215, 226, 232, 218, 241, 249, 260, 272, 280, 291, 306, 319, 335])
    },
    appStoreFunnel: funnel(1860, 724, 261, 114),
    productEvents: events(920, 418, 177, 94),
    revenueByRange: { today: 126, "7d": 840, "30d": 3280 }
  },
  {
    id: "duxbeach",
    name: "DuxBeach",
    sessionMultiplier: 1.24,
    trafficByRange: {
      today: points([42]),
      "7d": points([29, 38, 41, 44, 39, 52, 61]),
      "30d": points([10, 14, 16, 19, 17, 21, 26, 24, 25, 31, 35, 33, 36, 38, 34, 41, 43, 44, 42, 46, 47, 50, 53, 51, 55, 57, 59, 62, 66, 70])
    },
    appStoreFunnel: funnel(420, 166, 64, 26),
    productEvents: events(198, 88, 41, 19),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "tick-talk",
    name: "Tick Talk",
    sessionMultiplier: 1.42,
    trafficByRange: {
      today: points([31]),
      "7d": points([19, 24, 28, 30, 34, 39, 46]),
      "30d": points([8, 10, 11, 14, 13, 15, 17, 21, 19, 23, 25, 24, 28, 27, 29, 30, 31, 34, 36, 39, 37, 40, 42, 45, 44, 48, 50, 51, 55, 58])
    },
    appStoreFunnel: funnel(318, 104, 47, 18),
    productEvents: events(142, 66, 35, 16),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "jetstream",
    name: "Jetstream",
    sessionMultiplier: 1.28,
    trafficByRange: {
      today: points([57]),
      "7d": points([38, 44, 51, 58, 63, 71, 82]),
      "30d": points([18, 21, 24, 29, 31, 34, 33, 39, 42, 47, 50, 55, 53, 58, 61, 67, 70, 74, 78, 82, 79, 86, 90, 95, 98, 104, 108, 112, 117, 124])
    },
    appStoreFunnel: funnel(512, 230, 88, 39),
    productEvents: events(240, 114, 52, 28),
    revenueByRange: { today: 126, "7d": 840, "30d": 3280 }
  },
  {
    id: "tap-chat",
    name: "Tap Chat",
    sessionMultiplier: 1.31,
    trafficByRange: {
      today: points([22]),
      "7d": points([14, 18, 20, 22, 21, 27, 32]),
      "30d": points([7, 9, 8, 11, 12, 14, 15, 13, 17, 18, 20, 19, 22, 21, 23, 25, 26, 28, 27, 30, 31, 33, 32, 35, 36, 38, 40, 41, 43, 45])
    },
    appStoreFunnel: funnel(246, 94, 38, 14),
    productEvents: events(126, 54, 24, 12),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "free-the-beach",
    name: "Free The Beach",
    sessionMultiplier: 1.18,
    trafficByRange: {
      today: points([18]),
      "7d": points([10, 12, 16, 19, 17, 22, 26]),
      "30d": points([5, 6, 7, 8, 10, 9, 11, 13, 12, 15, 16, 17, 16, 18, 19, 20, 21, 23, 22, 24, 25, 27, 26, 28, 29, 31, 30, 32, 34, 36])
    },
    appStoreFunnel: funnel(172, 68, 24, 9),
    productEvents: events(94, 46, 18, 8),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "energeezy",
    name: "Energeezy",
    sessionMultiplier: 1.38,
    trafficByRange: {
      today: points([36]),
      "7d": points([24, 30, 35, 31, 42, 47, 55]),
      "30d": points([11, 13, 15, 18, 20, 19, 23, 25, 28, 30, 29, 34, 36, 38, 40, 42, 43, 47, 49, 51, 54, 56, 58, 60, 63, 65, 67, 71, 74, 78])
    },
    appStoreFunnel: funnel(384, 148, 58, 24),
    productEvents: events(184, 84, 36, 20),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "mytown-admin",
    name: "MyTown Admin",
    sessionMultiplier: 1.51,
    trafficByRange: {
      today: points([24]),
      "7d": points([20, 22, 24, 27, 29, 31, 34]),
      "30d": points([9, 11, 13, 14, 15, 18, 17, 20, 21, 23, 25, 24, 26, 28, 29, 31, 30, 33, 35, 36, 38, 39, 41, 42, 44, 46, 47, 49, 50, 52])
    },
    appStoreFunnel: funnel(188, 82, 31, 12),
    productEvents: events(136, 72, 34, 18),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  },
  {
    id: "experiments",
    name: "Other Shed Labs experiments",
    sessionMultiplier: 1.2,
    trafficByRange: {
      today: points([20]),
      "7d": points([8, 14, 18, 15, 19, 21, 25]),
      "30d": points([4, 6, 7, 9, 8, 11, 13, 12, 15, 17, 16, 18, 20, 19, 21, 23, 24, 22, 25, 27, 29, 28, 31, 32, 34, 33, 36, 38, 39, 41])
    },
    appStoreFunnel: funnel(132, 54, 19, 7),
    productEvents: events(92, 42, 16, 8),
    revenueByRange: { today: 0, "7d": 0, "30d": 0 }
  }
];

export const SOURCE_HEALTH = [
  { source: "GA4", state: "mocked", detail: "Ready for server-side GA4 Data API connection." },
  { source: "App Store Connect", state: "mocked", detail: "JWT and analytics reports should be fetched server-side." },
  { source: "Supabase", state: "mocked", detail: "Service-role queries need a private endpoint or scheduled job." },
  { source: "Stripe", state: "planned", detail: "Optional revenue cards are stubbed for future Stripe metrics." }
];

function points(values) {
  return values.map((value, index) => ({ label: String(index + 1), value }));
}

function funnel(impressions, productViews, downloads, activations) {
  return [
    { key: "impressions", label: "Impressions", valueByRange: split(impressions) },
    { key: "product_page_views", label: "Product page views", valueByRange: split(productViews) },
    { key: "downloads", label: "Downloads", valueByRange: split(downloads) },
    { key: "first_opens", label: "First opens", valueByRange: split(activations) }
  ];
}

function events(profileViews, saves, shares, conversions) {
  return [
    { key: "profile_viewed", label: "Profile viewed", area: "core", valueByRange: split(profileViews) },
    { key: "item_saved", label: "Item saved", area: "engagement", valueByRange: split(saves) },
    { key: "share_started", label: "Share started", area: "growth", valueByRange: split(shares) },
    { key: "conversion_completed", label: "Conversion completed", area: "revenue", valueByRange: split(conversions) }
  ];
}

function split(total) {
  return {
    today: Math.max(1, Math.round(total / 9)),
    "7d": total,
    "30d": Math.round(total * 3.7)
  };
}
