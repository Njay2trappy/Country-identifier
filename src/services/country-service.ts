import { promises as fs } from 'fs';
import path from 'path';

import {
  CountryConnection,
  CountryFilters,
  CountryRecord,
  CountryResponse,
  CountrySortField,
  CountrySortOption,
  CountryStatus,
  SortDirection,
} from '../types/country.js';
import {
  AddExchangeRatesResult,
  DeleteCountryResult,
  GenerateImageResult,
  OperationOutcome,
  StoreCountriesResult,
} from '../types/results.js';
import { ServiceError, ServiceErrorCode } from '../lib/errors.js';

const REST_COUNTRIES_ENDPOINT =
  'https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies,independent';

const EXCHANGE_RATE_API_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const QUICKCHART_ENDPOINT = 'https://quickchart.io/chart';

const OUTPUT_PATH = path.resolve(process.cwd(), 'output.json');
const SUMMARY_IMAGE_PATH = path.resolve(process.cwd(), 'cache', 'summary.png');

interface CountriesConnectionArgs {
  filters?: CountryFilters;
  sort?: CountrySortOption;
  first?: number | null;
  last?: number | null;
  after?: string | null;
  before?: string | null;
}

interface GetCountriesArgs {
  filters?: CountryFilters;
  sort?: CountrySortOption;
}

type FetchImpl = typeof fetch;

export class CountryService {
  private countryStore: CountryRecord[] = [];
  private nextId = 1;
  private lastRefreshedAt: string | null = null;
  private cachedFetch: FetchImpl | null = null;

  async loadCachedData(): Promise<void> {
    try {
      await fs.access(OUTPUT_PATH);
    } catch {
      return;
    }

    try {
      const fileContent = await fs.readFile(OUTPUT_PATH, 'utf-8');
      const cachedCountries: any[] = JSON.parse(fileContent);
      if (!Array.isArray(cachedCountries) || cachedCountries.length === 0) {
        return;
      }

      this.countryStore = cachedCountries.map((country, index) => ({
        id: country.id ?? index + 1,
        name: country.name ?? null,
        capital: country.capital ?? null,
        region: country.region ?? null,
        population: country.population ?? null,
        flag: country.flag ?? null,
        currencies: Array.isArray(country.currencies)
          ? country.currencies.map((currency: any) => ({
              code: currency.code ?? null,
              name: currency.name ?? null,
              symbol: currency.symbol ?? null,
            }))
          : [],
        independent:
          typeof country.independent === 'boolean'
            ? country.independent
            : null,
        exchangeRate: country.exchangeRate ?? country.exchange_rate ?? null,
        estimatedGdp: country.estimatedGdp ?? country.estimated_gdp ?? null,
        lastRefreshedAt:
          country.lastRefreshedAt ?? country.last_refreshed_at ?? null,
      }));

      const maxId = Math.max(...this.countryStore.map((country) => country.id));
      this.nextId = Number.isFinite(maxId) ? maxId + 1 : 1;
      this.lastRefreshedAt = this.countryStore[0]?.lastRefreshedAt ?? null;
    } catch (error) {
      console.error('Failed to load cached data:', error);
      this.countryStore = [];
      this.nextId = 1;
      this.lastRefreshedAt = null;
    }
  }

  getSummaryImagePath(): string {
    return SUMMARY_IMAGE_PATH;
  }

  getStatus(): CountryStatus {
    return {
      totalCountries: this.countryStore.length,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }

  async getCountryByName(name: string): Promise<CountryResponse> {
    if (!name || name.trim() === '') {
      throw new ServiceError('VALIDATION', 'Country name is required');
    }

    if (this.countryStore.length === 0) {
      throw new ServiceError('NOT_FOUND', 'No countries stored in database');
    }

    const country = this.countryStore.find(
      (item) => item.name?.toLowerCase() === name.trim().toLowerCase()
    );

    if (!country) {
      throw new ServiceError('NOT_FOUND', `Country not found: ${name}`);
    }

    return this.toCountryResponse(country);
  }

  getCountries({ filters, sort }: GetCountriesArgs = {}): CountryResponse[] {
    if (this.countryStore.length === 0) {
      throw new ServiceError('NOT_FOUND', 'No countries stored in database');
    }

    const filtered = this.applyFilters(this.countryStore, filters);
    const sorted = this.applySort(filtered, sort);
    return sorted.map((country) => this.toCountryResponse(country));
  }

  getCountriesConnection(args: CountriesConnectionArgs = {}): CountryConnection {
    const { filters, sort, first, last, after, before } = args;

    if (this.countryStore.length === 0) {
      throw new ServiceError('NOT_FOUND', 'No countries stored in database');
    }

    const filtered = this.applyFilters(this.countryStore, filters);
    const sortedRecords = this.applySort(filtered, sort);
    const totalCount = sortedRecords.length;

    let windowStart = 0;
    let windowEnd = sortedRecords.length;

    if (after) {
      const afterId = this.decodeCursor(after);
      const afterIndex = sortedRecords.findIndex((country) => country.id === afterId);
      if (afterIndex === -1) {
        throw new ServiceError('VALIDATION', 'Invalid after cursor provided');
      }
      windowStart = afterIndex + 1;
    }

    if (before) {
      const beforeId = this.decodeCursor(before);
      const beforeIndex = sortedRecords.findIndex((country) => country.id === beforeId);
      if (beforeIndex === -1) {
        throw new ServiceError('VALIDATION', 'Invalid before cursor provided');
      }
      windowEnd = beforeIndex;
    }

    if (windowStart > windowEnd) {
      throw new ServiceError('VALIDATION', '`after` cursor comes after `before` cursor');
    }

    let windowRecords = sortedRecords.slice(windowStart, windowEnd);
    let windowIndices = windowRecords.map((_, index) => windowStart + index);
    let truncatedByFirst = false;
    let truncatedByLast = false;

    if (typeof first === 'number') {
      if (first < 0) {
        throw new ServiceError('VALIDATION', '`first` must be a non-negative integer');
      }
      if (windowRecords.length > first) {
        windowRecords = windowRecords.slice(0, first);
        windowIndices = windowIndices.slice(0, first);
        truncatedByFirst = true;
      }
    }

    if (typeof last === 'number') {
      if (last < 0) {
        throw new ServiceError('VALIDATION', '`last` must be a non-negative integer');
      }
      if (windowRecords.length > last) {
        windowRecords = windowRecords.slice(windowRecords.length - last);
        windowIndices = windowIndices.slice(windowIndices.length - last);
        truncatedByLast = true;
      }
    }

    const edges = windowRecords.map((country) => ({
      cursor: this.encodeCursor(country.id),
      node: this.toCountryResponse(country),
    }));

    const nodes = edges.map((edge) => edge.node);

    const startCursor = edges[0]?.cursor ?? null;
    const endCursor = edges[edges.length - 1]?.cursor ?? null;

    const hasPreviousPage =
      windowStart > 0 || truncatedByLast || windowIndices[0] > windowStart;
    const hasNextPage =
      windowEnd < sortedRecords.length || truncatedByFirst ||
      (windowIndices[windowIndices.length - 1] ?? -1) < windowEnd - 1;

    return {
      edges,
      nodes,
      totalCount,
      pageInfo: {
        hasNextPage,
        hasPreviousPage,
        startCursor,
        endCursor,
      },
    };
  }

  async storeCountries(): Promise<StoreCountriesResult> {
    try {
      this.lastRefreshedAt = new Date().toISOString();
      this.nextId = 1;

      const rawCountries = await this.httpGetJson<Record<string, unknown>[]>(
        REST_COUNTRIES_ENDPOINT
      );

      this.countryStore = rawCountries.map((country) =>
        this.buildCountryRecord(country)
      );

      await this.persist();

      return {
        success: true,
        message: `Stored ${this.countryStore.length} countries`,
        count: this.countryStore.length,
        countries: this.countryStore.map((country) =>
          this.toCountryResponse(country)
        ),
      };
    } catch (error) {
      return this.handleOperationFailure<StoreCountriesResult>(
        'Error storing countries',
        error,
        { count: 0, countries: [] }
      );
    }
  }

  async addExchangeRates(): Promise<AddExchangeRatesResult> {
    try {
      if (this.countryStore.length === 0) {
        throw new ServiceError(
          'VALIDATION',
          'No countries stored. Run `storeCountries` first.'
        );
      }

      this.lastRefreshedAt = new Date().toISOString();

      const exchangeRateData = await this.httpGetJson<{
        result: string;
        rates?: Record<string, number>;
      }>(EXCHANGE_RATE_API_ENDPOINT);

      if (exchangeRateData.result !== 'success' || !exchangeRateData.rates) {
        throw new ServiceError('EXTERNAL_API', 'Failed to fetch exchange rates');
      }

      const rates = exchangeRateData.rates;
      let updatedCount = 0;

      this.countryStore = this.countryStore.map((country) => {
        const primaryCurrency = country.currencies[0]?.code;
        if (!primaryCurrency) {
          return { ...country };
        }

        const exchangeRate = rates[primaryCurrency];
        if (!exchangeRate) {
          return { ...country };
        }

        updatedCount += 1;
        const estimatedGdp = this.estimateGdp(country.population, exchangeRate);

        return {
          ...country,
          exchangeRate,
          estimatedGdp,
          lastRefreshedAt: this.lastRefreshedAt,
        };
      });

      await this.persist();

      return {
        success: true,
        message: `Updated exchange rates for ${updatedCount} countries`,
        count: updatedCount,
        countries: this.countryStore.map((country) =>
          this.toCountryResponse(country)
        ),
      };
    } catch (error) {
      return this.handleOperationFailure<AddExchangeRatesResult>(
        'Error adding exchange rates',
        error,
        { count: 0, countries: [] }
      );
    }
  }

  async deleteCountry(name: string): Promise<DeleteCountryResult> {
    try {
      if (!name || name.trim() === '') {
        throw new ServiceError('VALIDATION', 'Country name is required');
      }

      const index = this.countryStore.findIndex(
        (country) => country.name?.toLowerCase() === name.trim().toLowerCase()
      );

      if (index === -1) {
        throw new ServiceError('NOT_FOUND', `Country not found: ${name}`);
      }

      const [removed] = this.countryStore.splice(index, 1);
      await this.persist();

      return {
        success: true,
        message: `Deleted country: ${removed.name ?? 'Unknown'}`,
        deletedCountry: this.toCountryResponse(removed),
      };
    } catch (error) {
      return this.handleOperationFailure<DeleteCountryResult>(
        'Error deleting country',
        error,
        { deletedCountry: null }
      );
    }
  }

  async generateCountryImage(): Promise<GenerateImageResult> {
    try {
      if (this.countryStore.length === 0) {
        throw new ServiceError(
          'VALIDATION',
          'No countries stored. Run `storeCountries` and `addExchangeRates` first.'
        );
      }

      const top5ByGdp = [...this.countryStore]
        .filter((country) => country.estimatedGdp !== null)
        .sort((a, b) => (b.estimatedGdp ?? 0) - (a.estimatedGdp ?? 0))
        .slice(0, 5);

      if (top5ByGdp.length === 0) {
        throw new ServiceError(
          'VALIDATION',
          'Exchange rate data not available. Refresh exchange rates first.'
        );
      }

      const buffer = await this.buildSummaryImageBuffer({
        top5ByGdp,
        totalCountries: this.countryStore.length,
        lastRefreshedAt: this.lastRefreshedAt,
      });

      await fs.mkdir(path.dirname(SUMMARY_IMAGE_PATH), { recursive: true });
      await fs.writeFile(SUMMARY_IMAGE_PATH, buffer);

      return {
        success: true,
        message: 'Generated summary image',
        imagePath: SUMMARY_IMAGE_PATH,
      };
    } catch (error) {
      return this.handleOperationFailure<GenerateImageResult>(
        'Error generating summary image',
        error,
        { imagePath: null }
      );
    }
  }

  private applyFilters(
    records: CountryRecord[],
    filters?: CountryFilters
  ): CountryRecord[] {
    if (!filters) {
      return [...records];
    }

    const { name, region, currency } = filters;
    return records.filter((country) => {
      const matchesName = name
        ? country.name?.toLowerCase().includes(name.toLowerCase()) ?? false
        : true;
      const matchesRegion = region
        ? country.region?.toLowerCase() === region.toLowerCase()
        : true;
      const matchesCurrency = currency
        ? country.currencies.some(
            (curr) => curr.code?.toLowerCase() === currency.toLowerCase()
          )
        : true;
      return matchesName && matchesRegion && matchesCurrency;
    });
  }

  private applySort(
    records: CountryRecord[],
    sort?: CountrySortOption
  ): CountryRecord[] {
    if (!sort) {
      return [...records];
    }

    const directionMultiplier = sort.direction === SortDirection.DESC ? -1 : 1;
    const sorted = [...records];

    sorted.sort((a, b) => {
      switch (sort.field) {
        case CountrySortField.NAME: {
          const nameA = a.name ?? '';
          const nameB = b.name ?? '';
          return nameA.localeCompare(nameB) * directionMultiplier;
        }
        case CountrySortField.POPULATION: {
          const popA = a.population ?? 0;
          const popB = b.population ?? 0;
          return (popA - popB) * directionMultiplier;
        }
        case CountrySortField.ESTIMATED_GDP: {
          const gdpA = a.estimatedGdp ?? 0;
          const gdpB = b.estimatedGdp ?? 0;
          return (gdpA - gdpB) * directionMultiplier;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }

  private buildCountryRecord(
    rawCountry: Record<string, any>,
    id?: number
  ): CountryRecord {
    const currentId = id ?? this.nextId++;

    const currencies = Array.isArray(rawCountry.currencies)
      ? rawCountry.currencies.map((currency: any) => ({
          code: currency?.code ?? null,
          name: currency?.name ?? null,
          symbol: currency?.symbol ?? null,
        }))
      : [];

    return {
      id: currentId,
      name: rawCountry.name ?? null,
      capital: rawCountry.capital ?? null,
      region: rawCountry.region ?? null,
      population: typeof rawCountry.population === 'number'
        ? rawCountry.population
        : null,
      flag: rawCountry.flag ?? null,
      currencies,
      independent:
        typeof rawCountry.independent === 'boolean'
          ? rawCountry.independent
          : null,
      exchangeRate: null,
      estimatedGdp: null,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }

  private toCountryResponse(country: CountryRecord): CountryResponse {
    return {
      id: country.id,
      name: country.name,
      capital: country.capital,
      region: country.region,
      population: country.population,
      currencyCode: country.currencies[0]?.code ?? null,
      currencies: country.currencies,
      exchangeRate: country.exchangeRate,
      estimatedGdp: country.estimatedGdp,
      flagUrl: country.flag,
      lastRefreshedAt: country.lastRefreshedAt,
      independent: country.independent,
    };
  }

  private estimateGdp(
    population: number | null,
    exchangeRate: number | undefined
  ): number | null {
    if (!population || !exchangeRate) {
      return null;
    }

    const multiplier = Math.random() * 1000 + 1000;
    return Number(((population * multiplier) / exchangeRate).toFixed(2));
  }

  private encodeCursor(id: number): string {
    return Buffer.from(`country:${id}`,'utf8').toString('base64');
  }

  private decodeCursor(cursor: string): number {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [, idPart] = decoded.split(':');
      const id = Number.parseInt(idPart, 10);
      if (!Number.isFinite(id)) {
        throw new Error('Invalid cursor payload');
      }
      return id;
    } catch (error) {
      throw new ServiceError('VALIDATION', 'Invalid cursor supplied');
    }
  }

  private async ensureFetch(): Promise<FetchImpl> {
    if (typeof fetch === 'function') {
      return fetch;
    }

    if (!this.cachedFetch) {
      const { default: fetchImpl } = await import('node-fetch');
      this.cachedFetch = fetchImpl as unknown as FetchImpl;
    }

    return this.cachedFetch;
  }

  private async httpGetJson<T>(endpoint: string): Promise<T> {
    try {
      const fetchImpl = await this.ensureFetch();
      const response = await fetchImpl(endpoint);

      if (!response.ok) {
        throw new ServiceError(
          'EXTERNAL_API',
          `Failed to fetch ${endpoint}: HTTP ${response.status}`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw new ServiceError(
        'EXTERNAL_API',
        error instanceof Error ? error.message : 'Unknown network error'
      );
    }
  }

  private async buildSummaryImageBuffer({
    top5ByGdp,
    totalCountries,
    lastRefreshedAt,
  }: {
    top5ByGdp: CountryRecord[];
    totalCountries: number;
    lastRefreshedAt: string | null;
  }): Promise<Buffer> {
    const fetchImpl = await this.ensureFetch();
    const labels = top5ByGdp.map((country) => country.name ?? 'Unknown');
    const data = top5ByGdp.map((country) => country.estimatedGdp ?? 0);

    const subtitleParts = [`Total Countries: ${totalCountries}`];
    const refreshedAt = lastRefreshedAt
      ? new Date(lastRefreshedAt).toLocaleString('en-US', { timeZone: 'UTC' })
      : 'N/A';
    subtitleParts.push(`Last Refreshed: ${refreshedAt} UTC`);

    const chartConfig = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Estimated GDP (USD)',
            data,
            backgroundColor: ['#2b6cb0', '#2c5282', '#2a4365', '#4299e1', '#63b3ed'],
            borderRadius: 6,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: 'Top 5 Countries by Estimated GDP',
            color: '#1a202c',
            font: { size: 24, weight: 'bold' },
          },
          subtitle: {
            display: true,
            text: subtitleParts.join(' • '),
            color: '#4a5568',
            font: { size: 14 },
          },
        },
        responsive: false,
        scales: {
          x: {
            ticks: {
              color: '#2d3748',
              font: { size: 14 },
            },
          },
          y: {
            ticks: {
              color: '#2d3748',
              font: { size: 14 },
              callback:
                'function(value) { return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }',
            },
            beginAtZero: true,
          },
        },
      },
    };

    const response = await fetchImpl(QUICKCHART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: 800,
        height: 600,
        backgroundColor: '#f0f4f8',
        format: 'png',
        chart: chartConfig,
      }),
    });

    if (!response.ok) {
      throw new ServiceError('EXTERNAL_API', 'QuickChart rendering failed');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async persist(): Promise<void> {
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(this.countryStore, null, 2));
  }

  private handleOperationFailure<T extends OperationOutcome>(
    context: string,
    error: unknown,
    defaults: Omit<T, keyof OperationOutcome>
  ): T {
    if (error instanceof ServiceError) {
      return {
        ...defaults,
        success: false,
        message: `${context}: ${error.message}`,
        errorCode: error.code,
      } as T;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      ...defaults,
      success: false,
      message: `${context}: ${message}`,
      errorCode: 'INTERNAL',
    } as T;
  }
}

export const countryService = new CountryService();

export const paths = {
  output: OUTPUT_PATH,
  summaryImage: SUMMARY_IMAGE_PATH,
};
