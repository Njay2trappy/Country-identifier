import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { schema } from './schema.js';
import { root, loadCachedData } from './resolvers.js';

const app = express();
const PORT = process.env.PORT || 4000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.join(__dirname, 'output.json');
const SUMMARY_IMAGE_PATH = path.join(__dirname, 'cache', 'summary.png');

await loadCachedData();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function sendErrorResponse(res, errorType, options = {}) {
  const { message, apiName, details } = options;

  switch (errorType) {
    case 'EXTERNAL_API':
      return res.status(503).json({
        error: 'External data source unavailable',
        details: `Could not fetch data from ${apiName}`,
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
      return res.status(404).json({
        error: 'Country not found',
      });
    default:
      if (message) {
        console.error('Internal error:', message);
      }
      return res.status(500).json({
        error: 'Internal server error',
      });
  }
}

function validateCountryResponses(countries) {
  if (!Array.isArray(countries)) {
    return { valid: false, details: { countries: 'must be an array' } };
  }

  const requiredFields = ['name', 'population', 'currency_code'];
  const details = {};

  for (const field of requiredFields) {
    const hasFieldForAll = countries.every(
      (country) =>
        country &&
        country[field] !== null &&
        country[field] !== undefined &&
        (field !== 'name' || country[field] !== '')
    );

    if (!hasFieldForAll) {
      details[field] = 'is required';
    }
  }

  return {
    valid: Object.keys(details).length === 0,
    details,
  };
}

function formatMissingFields(fields) {
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

app.get('/', (_req, res) => {
  res.json({
    message: 'welcome to njay world, ensure to try my code',
  });
});

app.post('/countries/refresh', async (_req, res) => {
  let backupData = null;
  let backupExists = false;

  try {
    backupData = await fs.readFile(OUTPUT_PATH, 'utf-8');
    backupExists = true;
  } catch {
    backupData = null;
  }

  const restoreBackup = async () => {
    try {
      if (backupExists) {
        await fs.writeFile(OUTPUT_PATH, backupData, 'utf-8');
      } else {
        await fs.rm(OUTPUT_PATH, { force: true });
      }
    } catch (restoreError) {
      console.error('Error restoring backup:', restoreError);
    }

    await loadCachedData();
  };

  try {
    const storeResult = await root.storeCountries();
    if (!storeResult.success) {
      await restoreBackup();
      return sendErrorResponse(res, storeResult.errorType, {
        message: storeResult.message,
        apiName: 'REST Countries API',
      });
    }

    const ratesResult = await root.addExchangeRates();
    if (!ratesResult.success) {
      await restoreBackup();
      return sendErrorResponse(res, ratesResult.errorType, {
        message: ratesResult.message,
        apiName: 'Exchange Rate API',
      });
    }

    res.status(200).json(ratesResult.countries);
  } catch (error) {
    console.error('Unexpected error during /countries/refresh:', error);
    await restoreBackup();
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/countries', async (req, res) => {
  try {
    const { name, region, currency, sort } = req.query;

    const filters = {
      name: typeof name === 'string' ? name : undefined,
      region: typeof region === 'string' ? region : undefined,
      currency: typeof currency === 'string' ? currency : undefined,
      sort: typeof sort === 'string' ? sort : undefined,
    };

    const countries = await root.getCountries(filters);

    const validation = validateCountryResponses(countries);
    if (!validation.valid) {
      return sendErrorResponse(res, 'VALIDATION', {
        message: formatMissingFields(Object.keys(validation.details)),
        details: validation.details,
      });
    }

    res.status(200).json(countries);
  } catch (error) {
    if (error?.errorType === 'VALIDATION') {
      return sendErrorResponse(res, 'VALIDATION', { message: error.message });
    }

    if (error?.errorType === 'NOT_FOUND') {
      return sendErrorResponse(res, 'NOT_FOUND');
    }

    console.error('Unexpected error in GET /countries:', error);
    return sendErrorResponse(res, 'INTERNAL', { message: error.message });
  }
});

app.get('/countries/image', async (_req, res) => {
  try {
    const result = await root.generateCountryImage();

    if (!result.success) {
      return res.status(404).json({
        error: 'Summary image not found',
      });
    }

    return res.sendFile(result.image_path);
  } catch (error) {
    console.error(
      'Unexpected error in GET /countries/image:',
      error
    );

    // If the image exists but sending fails, fall back to 404 to match spec
    return res.status(404).json({
      error: 'Summary image not found',
    });
  }
});

app.get('/countries/:name', async (req, res) => {
  try {
    const country = await root.getCountryByName({ name: req.params.name });

    const validation = validateCountryResponses([country]);
    if (!validation.valid) {
      return sendErrorResponse(res, 'VALIDATION', {
        message: formatMissingFields(Object.keys(validation.details)),
        details: validation.details,
      });
    }

    res.status(200).json(country);
  } catch (error) {
    if (error?.errorType === 'VALIDATION') {
      return sendErrorResponse(res, 'VALIDATION', { message: error.message });
    }

    if (error?.errorType === 'NOT_FOUND') {
      return sendErrorResponse(res, 'NOT_FOUND');
    }

    console.error('Unexpected error in GET /countries/:name:', error);
    return sendErrorResponse(res, 'INTERNAL', { message: error.message });
  }
});

app.delete('/countries/:name', async (req, res) => {
  try {
    const result = await root.deleteCountry({ name: req.params.name });

    if (!result.success) {
      if (result.errorType === 'VALIDATION') {
        return sendErrorResponse(res, 'VALIDATION', { message: result.message });
      }
      if (result.errorType === 'NOT_FOUND') {
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
    if (error?.errorType === 'VALIDATION') {
      return sendErrorResponse(res, 'VALIDATION', { message: error.message });
    }

    if (error?.errorType === 'NOT_FOUND') {
      return sendErrorResponse(res, 'NOT_FOUND');
    }

    console.error('Unexpected error in DELETE /countries/:name:', error);
    return sendErrorResponse(res, 'INTERNAL', { message: error.message });
  }
});

app.get('/status', (_req, res) => {
  try {
    const status = root.getCountryStatus();
    res.status(200).json(status);
  } catch (error) {
    console.error('Unexpected error in GET /status:', error);
    return sendErrorResponse(res, 'INTERNAL', { message: error.message });
  }
});



const server = new ApolloServer({
  schema,
  rootValue: root,
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
  expressMiddleware(server)
);

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
  console.log(`📊 GraphQL endpoint: http://localhost:${PORT}/graphql`);
});
