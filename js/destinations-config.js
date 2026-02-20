/**
 * Premier Transport - Destinations & pricing config
 * Add, edit, or remove destinations and routes here.
 *
 * Google APIs used by the booking form (enable these in Google Cloud Console):
 * - Maps JavaScript API (map + Directions + Places library)
 * - Places API (address autocomplete)
 * - Directions API (route, distance, drive time with traffic)
 * Restrict the API key by HTTP referrer (e.g. https://premiertransport.services/*) in production.
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
