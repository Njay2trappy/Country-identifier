# Country Identifier

Node.js service that hydrates and caches global country data from public APIs, exposes it through both GraphQL and REST interfaces, and generates a summary image for the countries with the highest estimated GDP.

## Features
- Fetches country metadata from REST Countries and augments it with USD exchange rates.
- Persists the hydrated dataset locally (`output.json`) for fast restarts and offline reads.
- Offers REST endpoints for refreshing, querying, filtering, deleting, and visualising country data.
- Provides a GraphQL endpoint with queries and mutations that mirror the REST features.
- Generates a PNG summary image of the top five countries by estimated GDP.

## Project Structure
```
server.js          # Express entrypoint, REST routes, GraphQL server wiring
schema.js          # GraphQL schema definition
resolvers.js       # Query/mutation resolvers, data fetching, caching, image generation
output.json        # Cached country dataset (created after first refresh)
cache/summary.png  # Generated summary image (created on demand)
```

## Getting Started
### Prerequisites
- Node.js 18+ (required for the built-in `fetch` and ES module support)
- npm 9+ (comes with recent Node.js releases)
- System dependencies for [`canvas`](https://github.com/Automattic/node-canvas#compiling) (libpng, Cairo, etc.)

### Installation
```bash
npm install
```

### Run the server
```bash
# start in watch mode
npm run dev

# or run once
npm start
```

The server listens on `http://localhost:4000` by default. Override with `PORT=<number>` when starting the process.

## Data Flow
1. `POST /countries/refresh`:
   - Pulls country metadata from REST Countries.
   - Fetches USD-based exchange rates.
   - Calculates an estimated GDP and stores the composite data in memory and `output.json`.
2. Subsequent REST/GraphQL calls read from the in-memory store (seeded from `output.json` on boot).
3. Image generation writes to `cache/summary.png`.

If either external API fails, the refresh aborts, cached data is restored, and a `503` error is returned.

## REST API

| Method | Path                     | Description | Success Response |
|--------|--------------------------|-------------|------------------|
| POST   | `/countries/refresh`     | Refreshes cached data by calling the GraphQL mutations `storeCountries` and `addExchangeRates`. | `200 OK`, array of country objects with enriched fields. |
| GET    | `/countries`             | Lists countries with optional filtering and sorting (`?name=`, `?region=`, `?currency=`, `?sort=`). | `200 OK`, filtered array of country objects. |
| GET    | `/countries/:name`       | Fetches a single country by exact name (case-insensitive). | `200 OK`, single country object. |
| DELETE | `/countries/:name`       | Removes a country from the store and cache. | `200 OK`, deleted country object. |
| GET    | `/status`                | Returns total number of cached countries and last refresh timestamp. | `200 OK`, `{ "total_countries": number, "last_refreshed_at": string|null }`. |
| GET    | `/countries/image`       | Generates (if necessary) and serves the summary PNG. | `200 OK`, binary PNG response. |

### Country Object Schema
```json
{
  "id": 1,
  "name": "Nigeria",
  "capital": "Abuja",
  "region": "Africa",
  "population": 206139589,
  "currency_code": "NGN",
  "exchange_rate": 1600.23,
  "estimated_gdp": 25767448125.2,
  "flag_url": "https://flagcdn.com/ng.svg",
  "last_refreshed_at": "2025-10-22T18:00:00Z"
}
```

### Error Responses
| HTTP Code | Body |
|-----------|------|
| `400`     | `{ "error": "Validation failed", "details": { ...optional } }` |
| `404`     | `{ "error": "Country not found" }` |
| `404` (image) | `{ "error": "Summary image not found" }` |
| `503`     | `{ "error": "External data source unavailable", "details": "Could not fetch data from REST Countries API" }` (or Exchange Rate API) |
| `500`     | `{ "error": "Internal server error" }` |

## GraphQL API
- Endpoint: `POST http://localhost:4000/graphql`
- Playground: open the URL in a browser while the server is running.

### Key Operations
```graphql
# Refresh and enrich the dataset
mutation Refresh {
  storeCountries {
    success
    message
    count
  }
  addExchangeRates {
    success
    message
    count
    countries {
      id
      name
      currency_code
      exchange_rate
      estimated_gdp
    }
  }
}

# Filtered query
query GetCountries {
  getCountries(region: "Africa", sort: "gdp_desc") {
    id
    name
    estimated_gdp
  }
}

# Delete a country
mutation DeleteNigeria {
  deleteCountry(name: "Nigeria") {
    success
    message
    deletedCountry {
      id
      name
    }
  }
}
```

Full schema definitions live in [`schema.js`](schema.js).

## Persistence
- `output.json` mirrors the in-memory store, including sequential IDs and timestamps. It is loaded on startup if present.
- Deletions and refreshes overwrite this cache.
- `cache/summary.png` stores the latest generated image; it is recreated on each `generateCountryImage` call.

## Troubleshooting
- **503 External API errors**: The upstream services may be unavailable or throttling. Retry later or inspect network connectivity.
- **Canvas build failures**: Install the native libraries listed in the `canvas` documentation for your OS.
- **Missing required fields**: The GET/DELETE REST endpoints enforce `name`, `population`, and `currency_code` presence. If upstream data is incomplete, refresh again or clean the cache.
- **Ports in use**: Change the port via `PORT=5000 npm start`.

## Scripts
- `npm run dev` – start in watch mode (reload on file changes).
- `npm start` – run the server once.

## License
This project is licensed under the ISC License (see `package.json`).
