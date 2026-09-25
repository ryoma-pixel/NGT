// Free public exchange-rate endpoints (ECB reference rates via Frankfurter), tried in order.
// Shared by the build (src/lib/fx.ts) and the browser refresh in Base.astro.
export const FX_URLS = [
  'https://api.frankfurter.dev/v1/latest?base=JPY&symbols=USD',
  'https://api.frankfurter.app/latest?from=JPY&to=USD',
];
