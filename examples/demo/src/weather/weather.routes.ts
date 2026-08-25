import { Hono } from 'hono';
import { lookupCity } from './geo.js';

const CONDITIONS = ['Sunny', 'Cloudy', 'Rainy', 'Windy', 'Snowy'];

/** Deterministic pseudo-weather, so the demo needs no API key. */
function hash(city: string): number {
  return [...city].reduce((total, char) => total + char.charCodeAt(0), 0);
}

/**
 * Ordinary Hono routes with no apcore imports whatsoever.
 *
 * `app.ts` scans them into `weather.current.get` and `weather.forecast.get`
 * modules, which replay each route in-process — the zero-intrusion path for
 * exposing an existing API to AI clients.
 */
export const weatherRoutes = new Hono();

weatherRoutes.get('/weather/current/:city', (c) => {
  const city = c.req.param('city');
  const location = lookupCity(city);
  const seed = hash(city);

  return c.json({
    city: location.city,
    country: location.country,
    temperature: 10 + (seed % 25),
    condition: CONDITIONS[seed % CONDITIONS.length],
    humidity: 30 + (seed % 50),
  });
});

weatherRoutes.get('/weather/forecast/:city', (c) => {
  const city = c.req.param('city');
  const location = lookupCity(city);
  const seed = hash(city);
  const days = ['Today', 'Tomorrow', 'Day After'];

  return c.json({
    city: location.city,
    forecast: days.map((day, index) => ({
      day,
      high: 12 + ((seed + index * 7) % 20),
      low: 2 + ((seed + index * 3) % 15),
      condition: CONDITIONS[(seed + index) % CONDITIONS.length],
    })),
  });
});
