// Approximate centroid coordinates for major coffee-producing countries.
// Used so the app can place a country pin without an external geocoding API.
// Keys are lowercased country names; aliases point to canonical names.

const COUNTRY_COORDS = {
  // Africa
  "ethiopia":       { lat: 9.1450,  lng: 40.4897, canonical: "Ethiopia" },
  "kenya":          { lat: -0.0236, lng: 37.9062, canonical: "Kenya" },
  "rwanda":         { lat: -1.9403, lng: 29.8739, canonical: "Rwanda" },
  "burundi":        { lat: -3.3731, lng: 29.9189, canonical: "Burundi" },
  "tanzania":       { lat: -6.3690, lng: 34.8888, canonical: "Tanzania" },
  "uganda":         { lat: 1.3733,  lng: 32.2903, canonical: "Uganda" },
  "drc":            { lat: -4.0383, lng: 21.7587, canonical: "DR Congo" },
  "dr congo":       { lat: -4.0383, lng: 21.7587, canonical: "DR Congo" },
  "democratic republic of the congo": { lat: -4.0383, lng: 21.7587, canonical: "DR Congo" },
  "malawi":         { lat: -13.2543,lng: 34.3015, canonical: "Malawi" },
  "zambia":         { lat: -13.1339,lng: 27.8493, canonical: "Zambia" },
  "cameroon":       { lat: 7.3697,  lng: 12.3547, canonical: "Cameroon" },
  "ivory coast":    { lat: 7.5400,  lng: -5.5471, canonical: "Côte d'Ivoire" },
  "cote d'ivoire":  { lat: 7.5400,  lng: -5.5471, canonical: "Côte d'Ivoire" },
  "côte d'ivoire":  { lat: 7.5400,  lng: -5.5471, canonical: "Côte d'Ivoire" },
  "madagascar":     { lat: -18.7669,lng: 46.8691, canonical: "Madagascar" },
  "yemen":          { lat: 15.5527, lng: 48.5164, canonical: "Yemen" },

  // Americas
  "brazil":         { lat: -14.2350,lng: -51.9253,canonical: "Brazil" },
  "colombia":       { lat: 4.5709,  lng: -74.2973,canonical: "Colombia" },
  "peru":           { lat: -9.1900, lng: -75.0152,canonical: "Peru" },
  "bolivia":        { lat: -16.2902,lng: -63.5887,canonical: "Bolivia" },
  "ecuador":        { lat: -1.8312, lng: -78.1834,canonical: "Ecuador" },
  "venezuela":      { lat: 6.4238,  lng: -66.5897,canonical: "Venezuela" },
  "guatemala":      { lat: 15.7835, lng: -90.2308,canonical: "Guatemala" },
  "honduras":       { lat: 15.2000, lng: -86.2419,canonical: "Honduras" },
  "nicaragua":      { lat: 12.8654, lng: -85.2072,canonical: "Nicaragua" },
  "costa rica":     { lat: 9.7489,  lng: -83.7534,canonical: "Costa Rica" },
  "panama":         { lat: 8.5380,  lng: -80.7821,canonical: "Panama" },
  "el salvador":    { lat: 13.7942, lng: -88.8965,canonical: "El Salvador" },
  "mexico":         { lat: 23.6345, lng: -102.5528,canonical:"Mexico" },
  "jamaica":        { lat: 18.1096, lng: -77.2975,canonical: "Jamaica" },
  "dominican republic": { lat: 18.7357, lng: -70.1627, canonical: "Dominican Republic" },
  "haiti":          { lat: 18.9712, lng: -72.2852,canonical: "Haiti" },
  "cuba":           { lat: 21.5218, lng: -77.7812,canonical: "Cuba" },
  "puerto rico":    { lat: 18.2208, lng: -66.5901,canonical: "Puerto Rico" },
  "hawaii":         { lat: 19.8968, lng: -155.5828,canonical:"Hawaii (USA)" },
  "usa":            { lat: 19.8968, lng: -155.5828,canonical:"Hawaii (USA)" },

  // Asia-Pacific
  "indonesia":      { lat: -0.7893, lng: 113.9213,canonical: "Indonesia" },
  "sumatra":        { lat: -0.5897, lng: 101.3431,canonical: "Indonesia (Sumatra)" },
  "java":           { lat: -7.6145, lng: 110.7122,canonical: "Indonesia (Java)" },
  "sulawesi":       { lat: -1.8479, lng: 120.5279,canonical: "Indonesia (Sulawesi)" },
  "bali":           { lat: -8.3405, lng: 115.0920,canonical: "Indonesia (Bali)" },
  "vietnam":        { lat: 14.0583, lng: 108.2772,canonical: "Vietnam" },
  "india":          { lat: 20.5937, lng: 78.9629, canonical: "India" },
  "thailand":       { lat: 15.8700, lng: 100.9925,canonical: "Thailand" },
  "laos":           { lat: 19.8563, lng: 102.4955,canonical: "Laos" },
  "myanmar":        { lat: 21.9162, lng: 95.9560, canonical: "Myanmar" },
  "china":          { lat: 25.0453, lng: 101.4873,canonical: "China (Yunnan)" },
  "yunnan":         { lat: 25.0453, lng: 101.4873,canonical: "China (Yunnan)" },
  "philippines":    { lat: 12.8797, lng: 121.7740,canonical: "Philippines" },
  "papua new guinea":{lat: -6.3150, lng: 143.9555,canonical: "Papua New Guinea" },
  "east timor":     { lat: -8.8742, lng: 125.7275,canonical: "East Timor" },
  "timor-leste":    { lat: -8.8742, lng: 125.7275,canonical: "East Timor" },
  "nepal":          { lat: 28.3949, lng: 84.1240, canonical: "Nepal" },
  "sri lanka":      { lat: 7.8731,  lng: 80.7718, canonical: "Sri Lanka" },
};

function lookupCountry(nameRaw) {
  if (!nameRaw) return null;
  const key = nameRaw.trim().toLowerCase();
  return COUNTRY_COORDS[key] || null;
}

// Expose globally
window.COUNTRY_COORDS = COUNTRY_COORDS;
window.lookupCountry = lookupCountry;
