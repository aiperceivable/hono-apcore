export interface Location {
  city: string;
  country: string;
  lat: number;
  lon: number;
}

const CITIES: Record<string, Location> = {
  tokyo: { city: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69 },
  london: { city: 'London', country: 'United Kingdom', lat: 51.51, lon: -0.13 },
  'new york': { city: 'New York', country: 'United States', lat: 40.71, lon: -74.01 },
  paris: { city: 'Paris', country: 'France', lat: 48.86, lon: 2.35 },
  beijing: { city: 'Beijing', country: 'China', lat: 39.91, lon: 116.4 },
  sydney: { city: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21 },
};

/** Plain lookup helper — a collaborator the weather routes depend on. */
export function lookupCity(city: string): Location {
  return CITIES[city.toLowerCase()] ?? { city, country: 'Unknown', lat: 0, lon: 0 };
}
