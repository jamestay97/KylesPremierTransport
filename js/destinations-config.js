/**
 * Premier Transport - Destinations & pricing config
 * Add, edit, or remove destinations and routes here.
 *
 * If you see "This page can't load Google Maps correctly" on the booking form:
 * 1. Go to https://console.cloud.google.com/apis/library and enable:
 *    - Maps JavaScript API
 *    - Places API
 *    - Directions API
 * 2. Go to https://console.cloud.google.com/apis/credentials, open your API key.
 * 3. Under "Application restrictions" choose "HTTP referrers" and add:
 *    https://premiertransport.services/*
 *    https://www.premiertransport.services/*
 *    http://localhost:* (for local testing)
 * 4. Ensure billing is enabled for the project (Google offers free tier for these APIs).
 */
window.PremierTransportConfig = {
  overnightSurcharge: 10,
  overnightSurchargeStart: "22:00",
  overnightSurchargeEnd: "06:00",
  carSeatFee: 10,
  roundTripPromo: "Round trips as low as $100",
  shuttlesMessage: "Shuttles available anytime!",
  addons: [
    { id: "car_seat", label: "Car seat or booster", price: 10, enabled: true }
  ],
  googleReviewUrl: "",
  reviews: [],
  googleMapsApiKey: "AIzaSyD1PZ2WnJNrK4BqJrjQ4gebItgZ4EBHxdY",
  destinations: [
    { id: "tpa", name: "Tampa International Airport (TPA)", isAirport: true, address: "Tampa International Airport, Tampa, FL" },
    { id: "pinellas", name: "Pinellas County", address: "Pinellas County, FL" },
    { id: "pasco", name: "Pasco County", address: "Pasco County, FL" },
    { id: "holiday", name: "Holiday, FL", address: "Holiday, FL" },
    { id: "npr", name: "Downtown New Port Richey", address: "New Port Richey, FL" },
    { id: "other", name: "Other (enter address)" }
  ],

  /**
   * Route pricing: fromId, toId, priceMin, priceMax (use same for flat rate).
   * Price is in dollars. Overnight surcharge is added automatically for 10pm–6am.
   */
  routes: [
    { fromId: "pinellas", toId: "tpa", priceMin: 45, priceMax: 45 },
    { fromId: "tpa", toId: "pinellas", priceMin: 55, priceMax: 55 },
    { fromId: "pasco", toId: "tpa", priceMin: 65, priceMax: 85 },
    { fromId: "tpa", toId: "pasco", priceMin: 65, priceMax: 85 },
    { fromId: "holiday", toId: "tpa", priceMin: 55, priceMax: 65 },
    { fromId: "tpa", toId: "holiday", priceMin: 55, priceMax: 65 },
    { fromId: "npr", toId: "tpa", priceMin: 55, priceMax: 65 },
    { fromId: "tpa", toId: "npr", priceMin: 55, priceMax: 65 }
  ]
};
