import { GraphQLError } from 'graphql';
import { SortDirection } from '../types/country.js';
import { isServiceError } from '../lib/errors.js';
const resolvers = {
    Query: {
        countriesConnection: (_parent, args, context) => {
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
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        countries: (_parent, args, context) => {
            try {
                const filters = toFilters(args.filter);
                const sort = toSortOption(args.sort);
                return context.services.country.getCountries({ filters, sort });
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        country: async (_parent, args, context) => {
            try {
                return await context.services.country.getCountryByName(args.name);
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        countryStatus: (_parent, _args, context) => {
            return context.services.country.getStatus();
        },
    },
    Mutation: {
        storeCountries: async (_parent, _args, context) => {
            try {
                return await context.services.country.storeCountries();
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        addExchangeRates: async (_parent, _args, context) => {
            try {
                return await context.services.country.addExchangeRates();
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        deleteCountry: async (_parent, args, context) => {
            try {
                return await context.services.country.deleteCountry(args.name);
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
        generateCountryImage: async (_parent, _args, context) => {
            try {
                return await context.services.country.generateCountryImage();
            }
            catch (error) {
                throw mapServiceError(error);
            }
        },
    },
};
export default resolvers;
function toFilters(input) {
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
function toSortOption(sort) {
    if (!sort) {
        return undefined;
    }
    return {
        field: sort.field,
        direction: sort.direction ?? SortDirection.ASC,
    };
}
function nullableToUndefined(value) {
    return value === null || value === undefined ? undefined : value;
}
function mapServiceError(error) {
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
