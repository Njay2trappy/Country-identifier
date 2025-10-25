/* eslint-disable no-console */
'use strict';

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REST_COUNTRIES_ENDPOINT =
  'https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies,independent';

const EXCHANGE_RATE_API_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

// In-memory storage for countries
let countryStore = [];
let cachedFetch = null;
let nextId = 1;
let lastRefreshedAt = null;
let createCanvasFn = null;
let canvasLoadAttempted = false;

// Helper function to ensure fetch is available
async function ensureFetch() {
  if (typeof fetch === 'function') {
    return fetch;
  }

  if (!cachedFetch) {
    const { default: fetchImpl } = await import('node-fetch');
    cachedFetch = fetchImpl;
  }

  return cachedFetch;
}

async function ensureCanvas() {
  if (createCanvasFn || canvasLoadAttempted) {
    return createCanvasFn;
  }

  canvasLoadAttempted = true;
  try {
    const { createCanvas } = await import('canvas');
    createCanvasFn = createCanvas;
  } catch (error) {
    console.warn(
      'Canvas dependency not available. Summary image generation is disabled until "canvas" is installed.',
      error?.message || error
    );
    createCanvasFn = null;
  }

  return createCanvasFn;
}

// HTTP GET JSON helper
async function httpGetJson(endpoint) {
  const fetchImpl = await ensureFetch();
  try {
    const response = await fetchImpl(endpoint);

    if (!response.ok) {
      const error = new Error(
        `Failed to fetch data from ${endpoint}. Received status ${response.status}`
      );
      error.errorType = 'EXTERNAL_API';
      throw error;
    }

    return await response.json();
  } catch (error) {
    if (error.errorType !== 'EXTERNAL_API') {
      const wrapped = new Error(
        `Failed to fetch data from ${endpoint}. ${error.message}`
      );
      wrapped.errorType = 'EXTERNAL_API';
      throw wrapped;
    }

    throw error;
  }
}




// Load cached data from output.json on startup
async function loadCachedData() {
  try {
    const outputPath = path.join(__dirname, 'output.json');

    // Check if output.json exists
    try {
      await fs.access(outputPath);
    } catch {
      console.log('No cached data found. Database is empty.');
      return;
    }

    // Read and parse the cached data
    const fileContent = await fs.readFile(outputPath, 'utf-8');
    const cachedCountries = JSON.parse(fileContent);

    if (Array.isArray(cachedCountries) && cachedCountries.length > 0) {
      countryStore = cachedCountries;

      // Update nextId to be one more than the highest ID
      const maxId = Math.max(...cachedCountries.map(c => c.id || 0));
      nextId = maxId + 1;

      // Set lastRefreshedAt from the first country's timestamp
      lastRefreshedAt = cachedCountries[0].last_refreshed_at || null;

      console.log(`✅ Loaded ${cachedCountries.length} countries from cache`);
      console.log(`   Last refreshed: ${lastRefreshedAt || 'N/A'}`);
    } else {
      console.log('Cache file is empty. Database is empty.');
    }
  } catch (error) {
    console.error('Error loading cached data:', error.message);
    console.log('Starting with empty database.');
  }
}

// Build country record with exchange_rate and estimated_gdp
function buildCountryRecord(rawCountry, id = null) {
  const currentId = id ?? (nextId++);  // Use post-increment to get current and increment
  return {
    id: currentId,
    name: rawCountry.name ?? null,
    capital: rawCountry.capital ?? null,
    region: rawCountry.region ?? null,
    exchange_rate: null,
    estimated_gdp: null,
    population: rawCountry.population ?? null,
    flag: rawCountry.flag ?? null,
    currencies: Array.isArray(rawCountry.currencies)
      ? rawCountry.currencies.map((currency) => ({
          code: currency.code ?? null,
          name: currency.name ?? null,
          symbol: currency.symbol ?? null,
        }))
      : [],
    independent:
      typeof rawCountry.independent === 'boolean'
        ? rawCountry.independent
        : null,
    last_refreshed_at: lastRefreshedAt,
  };
}

function toCountryResponse(country) {
  return {
    id: country.id,
    name: country.name,
    capital: country.capital,
    region: country.region,
    population: country.population,
    currency_code:
      country.currencies && country.currencies.length > 0
        ? country.currencies[0].code
        : null,
    exchange_rate: country.exchange_rate,
    estimated_gdp: country.estimated_gdp,
    flag_url: country.flag,
    last_refreshed_at: country.last_refreshed_at,
  };
}

// Root resolver
const root = {
  // Query resolvers
  countries: () => {
    return countryStore;
  },

  getCountryStatus: () => {
    return {
      total_countries: countryStore.length,
      last_refreshed_at: lastRefreshedAt,
    };
  },

  getCountryByName: ({ name }) => {
    try {
      if (!name || typeof name !== 'string' || name.trim() === '') {
        const validationError = new Error('Country name is required');
        validationError.errorType = 'VALIDATION';
        throw validationError;
      }

      if (!countryStore || countryStore.length === 0) {
        const noDataError = new Error('No countries stored in database');
        noDataError.errorType = 'NOT_FOUND';
        throw noDataError;
      }

      const country = countryStore.find(
        (item) =>
          item.name &&
          item.name.toLowerCase() === name.trim().toLowerCase()
      );

      if (!country) {
        const notFoundError = new Error(`Country not found: ${name}`);
        notFoundError.errorType = 'NOT_FOUND';
        throw notFoundError;
      }

      return toCountryResponse(country);
    } catch (error) {
      console.error('Error in getCountryByName:', error);
      throw error;
    }
  },

  getCountries: ({ name, region, currency, sort }) => {
    try {
      // Validate that countries are stored
      if (!countryStore || countryStore.length === 0) {
        const noDataError = new Error(
          'No countries stored. Please run storeCountries and addExchangeRates mutations first.'
        );
        noDataError.errorType = 'NOT_FOUND';
        throw noDataError;
      }

      let filteredCountries = [...countryStore];

      // Filter by name (case-insensitive partial match)
      if (name) {
        filteredCountries = filteredCountries.filter(
          (country) =>
            country.name &&
            country.name.toLowerCase().includes(name.toLowerCase())
        );
      }

      // Filter by region
      if (region) {
        const normalizedRegion = region.replace('_', ' ');
        filteredCountries = filteredCountries.filter(
          (country) =>
            country.region &&
            country.region.toLowerCase() === normalizedRegion.toLowerCase()
        );
      }

      // Filter by currency
      if (currency) {
        filteredCountries = filteredCountries.filter(
          (country) =>
            country.currencies &&
            country.currencies.some(
              (curr) => curr.code && curr.code.toUpperCase() === currency.toUpperCase()
            )
        );
      }

      // Sort the results
      if (sort) {
        switch (sort.toLowerCase()) {
          case 'name_asc':
            filteredCountries.sort((a, b) =>
              (a.name || '').localeCompare(b.name || '')
            );
            break;
          case 'name_desc':
            filteredCountries.sort((a, b) =>
              (b.name || '').localeCompare(a.name || '')
            );
            break;
          case 'population_asc':
            filteredCountries.sort(
              (a, b) => (a.population || 0) - (b.population || 0)
            );
            break;
          case 'population_desc':
            filteredCountries.sort(
              (a, b) => (b.population || 0) - (a.population || 0)
            );
            break;
          case 'gdp_asc':
            filteredCountries.sort(
              (a, b) => (a.estimated_gdp || 0) - (b.estimated_gdp || 0)
            );
            break;
          case 'gdp_desc':
            filteredCountries.sort(
              (a, b) => (b.estimated_gdp || 0) - (a.estimated_gdp || 0)
            );
            break;
          default:
            // Invalid sort parameter - return 400 error
            const invalidSortError = new Error(
              `Invalid sort parameter: ${sort}. Valid options are: name_asc, name_desc, population_asc, population_desc, gdp_asc, gdp_desc`
            );
            invalidSortError.errorType = 'VALIDATION';
            throw invalidSortError;
        }
      }

      // Transform to response format
      const response = filteredCountries.map(toCountryResponse);
      return response;
    } catch (error) {
      console.error('Error in getCountries:', error);
      throw error;
    }
  },

  // Mutation resolvers
  storeCountries: async () => {
    try {
      lastRefreshedAt = new Date().toISOString();
      nextId = 1; // Start IDs from 1
      console.log('Starting ID generation from:', nextId);
      const rawCountries = await httpGetJson(REST_COUNTRIES_ENDPOINT);
      const processedCountries = rawCountries.map((country) =>
        buildCountryRecord(country)
      );

      countryStore = processedCountries;

      const outputPath = path.join(__dirname, 'output.json');
      await fs.writeFile(
        outputPath,
        JSON.stringify(processedCountries, null, 2),
        'utf-8'
      );

      return {
        success: true,
        message: `Successfully stored ${countryStore.length} countries`,
        count: countryStore.length,
        countries: countryStore,
      };
    } catch (error) {
      console.error('Error fetching countries:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
        count: 0,
        countries: [],
        errorType: error.errorType === 'EXTERNAL_API' ? 'EXTERNAL_API' : 'INTERNAL',
      };
    }
  },

  addExchangeRates: async () => {
    try {
      // Check if countries are stored
      if (!countryStore || countryStore.length === 0) {
        return {
          success: false,
          message: 'No countries stored. Please run storeCountries mutation first.',
          count: 0,
          countries: [],
          errorType: 'VALIDATION',
        };
      }

      lastRefreshedAt = new Date().toISOString();

      // Fetch exchange rates from the API
      const exchangeRateData = await httpGetJson(EXCHANGE_RATE_API_ENDPOINT);

      if (exchangeRateData.result !== 'success' || !exchangeRateData.rates) {
        const apiError = new Error('Failed to fetch exchange rates from API');
        apiError.errorType = 'EXTERNAL_API';
        throw apiError;
      }

      const rates = exchangeRateData.rates;
      let updatedCount = 0;

      countryStore = countryStore.map((country) => {
        const primaryCurrencyCode =
          country.currencies && country.currencies.length > 0
            ? country.currencies[0].code
            : null;

        if (primaryCurrencyCode && rates[primaryCurrencyCode]) {
          const exchangeRate = rates[primaryCurrencyCode];
          let estimatedGdp = null;

          // Calculate estimated GDP: population × random(1000–2000) ÷ exchange_rate
          if (country.population && exchangeRate) {
            const randomMultiplier = Math.random() * 1000 + 1000; // Random between 1000-2000
            estimatedGdp = Number(
              ((country.population * randomMultiplier) / exchangeRate).toFixed(2)
            );
          }

          updatedCount++;
          return {
            ...country,
            exchange_rate: exchangeRate,
            estimated_gdp: estimatedGdp,
            last_refreshed_at: lastRefreshedAt,
          };
        }

        return country;
      });

      const outputPath = path.join(__dirname, 'output.json');
      await fs.writeFile(
        outputPath,
        JSON.stringify(countryStore, null, 2),
        'utf-8'
      );

      return {
        success: true,
        message: `Successfully updated exchange rates and estimated GDP for ${updatedCount} out of ${countryStore.length} countries`,
        count: updatedCount,
        countries: countryStore.map(toCountryResponse),
      };
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
        count: 0,
        countries: [],
        errorType: error.errorType === 'EXTERNAL_API' ? 'EXTERNAL_API' : 'INTERNAL',
      };
    }
  },

  deleteCountry: async ({ name }) => {
    try {
      // Validate input
      if (!name || name.trim() === '') {
        return {
          success: false,
          message: 'Country name is required',
          deletedCountry: null,
          errorType: 'VALIDATION',
        };
      }

      // Check if countries are stored
      if (!countryStore || countryStore.length === 0) {
        return {
          success: false,
          message: 'No countries stored in database',
          deletedCountry: null,
          errorType: 'NOT_FOUND',
        };
      }

      // Find the country by exact name (case-insensitive)
      const countryIndex = countryStore.findIndex(
        (country) =>
          country.name &&
          country.name.toLowerCase() === name.trim().toLowerCase()
      );

      // Country not found - return 404 error
      if (countryIndex === -1) {
        return {
          success: false,
          message: `Country not found: ${name}`,
          deletedCountry: null,
          errorType: 'NOT_FOUND',
        };
      }

      // Get the country before deletion
      const deletedCountry = countryStore[countryIndex];

      // Remove the country from the store
      countryStore.splice(countryIndex, 1);

      // Update output.json
      const outputPath = path.join(__dirname, 'output.json');
      await fs.writeFile(
        outputPath,
        JSON.stringify(countryStore, null, 2),
        'utf-8'
      );

      // Transform to response format
      const deletedCountryResponse = toCountryResponse(deletedCountry);

      return {
        success: true,
        message: `Successfully deleted country: ${deletedCountry.name}`,
        deletedCountry: deletedCountryResponse,
      };
    } catch (error) {
      console.error('Error deleting country:', error);
      return {
        success: false,
        message: `Internal server error: ${error.message}`,
        deletedCountry: null,
        errorType: 'INTERNAL',
      };
    }
  },

  generateCountryImage: async () => {
    try {
      // Check if countries are stored
      if (!countryStore || countryStore.length === 0) {
        return {
          success: false,
          message: 'No countries stored in database. Please run storeCountries and addExchangeRates first.',
          image_path: null,
        };
      }

      const createCanvas = await ensureCanvas();
      if (!createCanvas) {
        return {
          success: false,
          message: 'Canvas dependency not installed. Run "npm install canvas" to enable summary image generation.',
          image_path: null,
        };
      }

      // Get top 5 countries by estimated GDP
      const top5ByGdp = [...countryStore]
        .filter((country) => country.estimated_gdp !== null)
        .sort((a, b) => (b.estimated_gdp || 0) - (a.estimated_gdp || 0))
        .slice(0, 5);

      // Create canvas
      const width = 800;
      const height = 600;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = '#f0f4f8';
      ctx.fillRect(0, 0, width, height);

      // Title
      ctx.fillStyle = '#1a202c';
      ctx.font = 'bold 36px Arial';
      ctx.fillText('Country Data Summary', 50, 60);

      // Total countries
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#2d3748';
      ctx.fillText(`Total Countries: ${countryStore.length}`, 50, 120);

      // Last refreshed timestamp
      ctx.font = '18px Arial';
      ctx.fillStyle = '#4a5568';
      const refreshText = lastRefreshedAt
        ? `Last Refreshed: ${new Date(lastRefreshedAt).toLocaleString()}`
        : 'Last Refreshed: N/A';
      ctx.fillText(refreshText, 50, 160);

      // Top 5 countries header
      ctx.font = 'bold 28px Arial';
      ctx.fillStyle = '#2d3748';
      ctx.fillText('Top 5 Countries by Estimated GDP', 50, 220);

      // Draw top 5 countries
      let yPosition = 270;
      top5ByGdp.forEach((country, index) => {
        // Rank number with colored background
        ctx.fillStyle = '#4299e1';
        ctx.fillRect(50, yPosition - 25, 40, 40);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.fillText(`${index + 1}`, 62, yPosition + 5);

        // Country name
        ctx.fillStyle = '#1a202c';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(country.name || 'Unknown', 110, yPosition);

        // GDP value
        ctx.fillStyle = '#4a5568';
        ctx.font = '18px Arial';
        const gdpFormatted = country.estimated_gdp
          ? `$${country.estimated_gdp.toLocaleString()} USD`
          : 'N/A';
        ctx.fillText(`GDP: ${gdpFormatted}`, 110, yPosition + 25);

        yPosition += 70;
      });

      // Create cache directory if it doesn't exist
      const cacheDir = path.join(__dirname, 'cache');
      try {
        await fs.access(cacheDir);
      } catch {
        await fs.mkdir(cacheDir, { recursive: true });
      }

      // Save image to disk
      const imagePath = path.join(cacheDir, 'summary.png');
      const buffer = canvas.toBuffer('image/png');
      await fs.writeFile(imagePath, buffer);

      return {
        success: true,
        message: `Successfully generated country summary image at ${imagePath}`,
        image_path: imagePath,
      };
    } catch (error) {
      console.error('Error generating country image:', error);
      return {
        success: false,
        message: `Internal server error: ${error.message}`,
        image_path: null,
      };
    }
  },
};

export { root, loadCachedData };
