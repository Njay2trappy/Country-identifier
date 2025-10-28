import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';

import { typeDefs } from './graphql/type-defs.js';
import resolvers from './graphql/resolvers.js';
import { countryService, paths } from './services/country-service.js';
import type { CountryFilters, CountryResponse, CountrySortOption } from './types/country.js';
import { CountrySortField, SortDirection } from './types/country.js';
import type { GraphQLContext } from './graphql/context.js';
import { isServiceError, type ServiceErrorCode } from './lib/errors.js';

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const SUMMARY_IMAGE_PATH = paths.summaryImage;

await countryService.loadCachedData();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the Country Identifier API' });
});

app.post('/countries/refresh', async (_req, res) => {
  let backupData: string | null = null;
  let backupExists = false;

  try {
    backupData = await fs.readFile(paths.output, 'utf-8');
    backupExists = true;
  } catch {
    backupData = null;
  }

  const restoreBackup = async () => {
    try {
      if (backupExists && backupData !== null) {
        await fs.writeFile(paths.output, backupData, 'utf-8');
      } else {
        await fs.rm(paths.output, { force: true });
      }
    } catch (restoreError) {
      console.error('Error restoring backup:', restoreError);
    }

    await countryService.loadCachedData();
  };

  try {
    const storeResult = await countryService.storeCountries();
    if (!storeResult.success) {
      await restoreBackup();
      return sendErrorResponse(res, storeResult.errorCode ?? 'INTERNAL', {
        message: storeResult.message,
        apiName: 'REST Countries API',
      });
    }

    const ratesResult = await countryService.addExchangeRates();
    if (!ratesResult.success) {
      await restoreBackup();
      return sendErrorResponse(res, ratesResult.errorCode ?? 'INTERNAL', {
        message: ratesResult.message,
        apiName: 'Exchange Rate API',
      });
    }

    res.status(200).json(ratesResult.countries);
  } catch (error) {
    console.error('Unexpected error during /countries/refresh:', error);
    await restoreBackup();
    return sendErrorResponse(res, 'INTERNAL', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/countries', async (req, res) => {
  try {
    const filters = buildFiltersFromQuery(req);
    let sort: CountrySortOption | undefined;

    try {
      sort = parseSortParameter(req.query.sort);
    } catch (validationError) {
      return sendErrorResponse(res, 'VALIDATION', {
        message:
          validationError instanceof Error
            ? validationError.message
            : 'Invalid sort parameter',
      });
    }
    const countries = countryService.getCountries({ filters, sort });
    res.status(200).json(countries);
  } catch (error) {
    if (isServiceError(error)) {
      if (error.code === 'VALIDATION') {
        return sendErrorResponse(res, error.code, { message: error.message });
      }

      if (error.code === 'NOT_FOUND') {
        return sendErrorResponse(res, error.code);
      }
    }

    console.error('Unexpected error in GET /countries:', error);
    return sendErrorResponse(res, 'INTERNAL', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/countries/image', async (_req, res) => {
  try {
    const result = await countryService.generateCountryImage();

    if (!result.success || !result.imagePath) {
      return res.status(404).json({ error: 'Summary image not found' });
    }

    const resolvedPath = path.resolve(result.imagePath ?? SUMMARY_IMAGE_PATH);
    return res.sendFile(resolvedPath, (err) => {
      if (err) {
        console.error('Error sending summary image:', err);
        res.status(404).json({ error: 'Summary image not found' });
      }
    });
  } catch (error) {
    console.error('Unexpected error in GET /countries/image:', error);
    return res.status(404).json({ error: 'Summary image not found' });
  }
});

app.get('/countries/:name', async (req, res) => {
  try {
    const country = await countryService.getCountryByName(req.params.name);

    const validation = validateCountryResponses([country]);
    if (!validation.valid) {
      return sendErrorResponse(res, 'VALIDATION', {
        message: formatMissingFields(Object.keys(validation.details)),
        details: validation.details,
      });
    }

    res.status(200).json(country);
  } catch (error) {
    if (isServiceError(error)) {
      if (error.code === 'VALIDATION') {
        return sendErrorResponse(res, error.code, { message: error.message });
      }
      if (error.code === 'NOT_FOUND') {
        return sendErrorResponse(res, error.code);
      }
    }

    console.error('Unexpected error in GET /countries/:name:', error);
    return sendErrorResponse(res, 'INTERNAL', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.delete('/countries/:name', async (req, res) => {
  try {
    const result = await countryService.deleteCountry(req.params.name);

    if (!result.success || !result.deletedCountry) {
      if (result.errorCode === 'VALIDATION') {
        return sendErrorResponse(res, 'VALIDATION', { message: result.message });
      }
      if (result.errorCode === 'NOT_FOUND') {
        return sendErrorResponse(res, 'NOT_FOUND');
      }

      console.error('deleteCountry internal error:', result.message);
      return sendErrorResponse(res, 'INTERNAL', { message: result.message });
    }

    const validation = validateCountryResponses([result.deletedCountry]);
    if (!validation.valid) {
      return sendErrorResponse(res, 'VALIDATION', {
        message: formatMissingFields(Object.keys(validation.details)),
        details: validation.details,
      });
    }

    res.status(200).json(result.deletedCountry);
  } catch (error) {
    if (isServiceError(error)) {
      if (error.code === 'VALIDATION') {
        return sendErrorResponse(res, error.code, { message: error.message });
      }
      if (error.code === 'NOT_FOUND') {
        return sendErrorResponse(res, error.code);
      }
    }

    console.error('Unexpected error in DELETE /countries/:name:', error);
    return sendErrorResponse(res, 'INTERNAL', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/status', (_req, res) => {
  try {
    const status = countryService.getStatus();
    res.status(200).json(status);
  } catch (error) {
    console.error('Unexpected error in GET /status:', error);
    return sendErrorResponse(res, 'INTERNAL', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = new ApolloServer<GraphQLContext>({
  typeDefs,
  resolvers,
  introspection: true,
});

await server.start();

app.use(
  '/graphql',
  express.json(),
  (req, _res, next) => {
    if (req.body === undefined) {
      req.body = {};
    }
    next();
  },
  expressMiddleware(server, {
    context: async (): Promise<GraphQLContext> => ({
      services: { country: countryService },
    }),
  })
);

app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
  console.log(`📊 GraphQL endpoint: http://localhost:${PORT}/graphql`);
});

function sendErrorResponse(
  res: Response,
  errorType: ServiceErrorCode | 'INTERNAL',
  options: { message?: string; apiName?: string; details?: Record<string, string> } = {}
) {
  const { message, apiName, details } = options;

  switch (errorType) {
    case 'EXTERNAL_API':
      return res.status(503).json({
        error: 'External data source unavailable',
        details: apiName ? `Could not fetch data from ${apiName}` : undefined,
      });
    case 'VALIDATION':
      if (message) {
        console.warn('Validation error:', message);
      }
      return res.status(400).json({
        error: 'Validation failed',
        ...(details ? { details } : {}),
      });
    case 'NOT_FOUND':
      return res.status(404).json({ error: 'Country not found' });
    default:
      if (message) {
        console.error('Internal error:', message);
      }
      return res.status(500).json({ error: 'Internal server error' });
  }
}

function validateCountryResponses(countries: CountryResponse[]) {
  const requiredFields: Array<keyof CountryResponse> = ['name', 'population', 'currencyCode'];
  const details: Record<string, string> = {};

  for (const field of requiredFields) {
    const hasFieldForAll = countries.every((country) => {
      const value = country[field];
      if (field === 'name') {
        return typeof value === 'string' && value.trim() !== '';
      }
      return value !== null && value !== undefined;
    });

    if (!hasFieldForAll) {
      details[field.toString()] = 'is required';
    }
  }

  return {
    valid: Object.keys(details).length === 0,
    details,
  };
}

function formatMissingFields(fields: string[]): string {
  if (fields.length === 0) {
    return '';
  }

  if (fields.length === 1) {
    return `${fields[0]} is required`;
  }

  if (fields.length === 2) {
    return `${fields[0]} and ${fields[1]} are required`;
  }

  const head = fields.slice(0, -1).join(', ');
  const tail = fields[fields.length - 1];
  return `${head}, and ${tail} are required`;
}

function buildFiltersFromQuery(req: Request): CountryFilters | undefined {
  const { name, region, currency } = req.query;

  const filters: CountryFilters = {};

  if (typeof name === 'string' && name.trim()) {
    filters.name = name.trim();
  }
  if (typeof region === 'string' && region.trim()) {
    filters.region = region.replace(/_/g, ' ').trim();
  }
  if (typeof currency === 'string' && currency.trim()) {
    filters.currency = currency.trim();
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function parseSortParameter(sortParam: unknown): CountrySortOption | undefined {
  if (typeof sortParam !== 'string') {
    return undefined;
  }

  const normalized = sortParam.toLowerCase();

  switch (normalized) {
    case 'name_asc':
      return { field: CountrySortField.NAME, direction: SortDirection.ASC };
    case 'name_desc':
      return { field: CountrySortField.NAME, direction: SortDirection.DESC };
    case 'population_asc':
      return { field: CountrySortField.POPULATION, direction: SortDirection.ASC };
    case 'population_desc':
      return { field: CountrySortField.POPULATION, direction: SortDirection.DESC };
    case 'gdp_asc':
      return { field: CountrySortField.ESTIMATED_GDP, direction: SortDirection.ASC };
    case 'gdp_desc':
      return { field: CountrySortField.ESTIMATED_GDP, direction: SortDirection.DESC };
    default:
      throw new Error(
        `Invalid sort parameter: ${sortParam}. Valid options are: name_asc, name_desc, population_asc, population_desc, gdp_asc, gdp_desc`
      );
  }
}
