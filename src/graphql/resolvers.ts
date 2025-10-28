import { GraphQLError } from 'graphql';

import type { GraphQLContext } from './context.js';
import type {
  CountryFilters,
  CountrySortField,
  CountrySortOption,
} from '../types/country.js';
import { SortDirection } from '../types/country.js';
import { isServiceError } from '../lib/errors.js';

interface CountriesArgs {
  filter?: CountryFilterInput | null;
  sort?: CountrySortInput | null;
}

interface CountriesConnectionArgs extends CountriesArgs {
  first?: number | null;
  last?: number | null;
  after?: string | null;
  before?: string | null;
}

interface CountryArgs {
  name: string;
}

interface CountryFilterInput {
  name?: string | null;
  region?: string | null;
  currency?: string | null;
}

interface CountrySortInput {
  field: CountrySortField;
  direction?: SortDirection | null;
}

const resolvers = {
  Query: {
    countriesConnection: (
      _parent: unknown,
      args: CountriesConnectionArgs,
      context: GraphQLContext
    ) => {
      try {
        const filters = toFilters(args.filter);
        const sort = toSortOption(args.sort);
        return context.services.country.getCountriesConnection({
          filters,
          sort,
          first: args.first ?? null,
          last: args.last ?? null,
          after: args.after ?? null,
          before: args.before ?? null,
        });
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    countries: (
      _parent: unknown,
      args: CountriesArgs,
      context: GraphQLContext
    ) => {
      try {
        const filters = toFilters(args.filter);
        const sort = toSortOption(args.sort);
        return context.services.country.getCountries({ filters, sort });
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    country: async (
      _parent: unknown,
      args: CountryArgs,
      context: GraphQLContext
    ) => {
      try {
        return await context.services.country.getCountryByName(args.name);
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    countryStatus: (
      _parent: unknown,
      _args: Record<string, never>,
      context: GraphQLContext
    ) => {
      return context.services.country.getStatus();
    },
  },
  Mutation: {
    storeCountries: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: GraphQLContext
    ) => {
      try {
        return await context.services.country.storeCountries();
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    addExchangeRates: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: GraphQLContext
    ) => {
      try {
        return await context.services.country.addExchangeRates();
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    deleteCountry: async (
      _parent: unknown,
      args: CountryArgs,
      context: GraphQLContext
    ) => {
      try {
        return await context.services.country.deleteCountry(args.name);
      } catch (error) {
        throw mapServiceError(error);
      }
    },
    generateCountryImage: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: GraphQLContext
    ) => {
      try {
        return await context.services.country.generateCountryImage();
      } catch (error) {
        throw mapServiceError(error);
      }
    },
  },
};

export default resolvers;

function toFilters(
  input?: CountryFilterInput | null
): CountryFilters | undefined {
  if (!input) {
    return undefined;
  }

  const region = input.region
    ? input.region.replace(/_/g, ' ')
    : undefined;

  return {
    name: nullableToUndefined(input.name),
    region: nullableToUndefined(region),
    currency: nullableToUndefined(input.currency),
  };
}

function toSortOption(
  sort?: CountrySortInput | null
): CountrySortOption | undefined {
  if (!sort) {
    return undefined;
  }

  return {
    field: sort.field,
    direction: sort.direction ?? SortDirection.ASC,
  };
}

function nullableToUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function mapServiceError(error: unknown): GraphQLError {
  if (isServiceError(error)) {
    return new GraphQLError(error.message, {
      extensions: { code: error.code },
    });
  }

  if (error instanceof GraphQLError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return new GraphQLError(message, {
    extensions: { code: 'INTERNAL' },
  });
}
