import { buildSchema } from 'graphql';

const typeDefs = `
  enum region {
    Africa
    Americas
    Antarctic
    Antarctic_Ocean
    Asia
    Europe
    Oceania
    Polar
  }

  enum sort {
    name_asc
    name_desc
    population_asc
    population_desc
    gdp_asc
    gdp_desc
  }

  type Currency {
    code: String
    name: String
    symbol: String
  }

  type Country {
    name: String
    capital: String
    region: String
    exchange_rate: Float
    estimated_gdp: Float
    population: Int
    flag: String
    currencies: [Currency]
    independent: Boolean
  }

  type CountryResponse {
    id: Int!
    name: String
    capital: String
    region: String
    population: Int
    currency_code: String
    exchange_rate: Float
    estimated_gdp: Float
    flag_url: String
    last_refreshed_at: String
  }

  type ErrorResponse {
    error: String!
    details: String
  }

  type StoreCountriesResult {
    success: Boolean!
    message: String!
    count: Int
    countries: [Country]
  }

  type AddExchangeRatesResult {
    success: Boolean!
    message: String!
    count: Int
    countries: [CountryResponse]
  }

  type DeleteCountryResult {
    success: Boolean!
    message: String!
    deletedCountry: CountryResponse
  }

  type CountryStatus {
    total_countries: Int!
    last_refreshed_at: String
  }

  type GenerateImageResult {
    success: Boolean!
    message: String!
    image_path: String
  }

  type Query {
    countries: [Country]
    getCountries(name: String, region: String, currency: String, sort: String): [CountryResponse]
    getCountryStatus: CountryStatus
    getCountryByName(name: String!): CountryResponse
  }

  type Mutation {
    storeCountries: StoreCountriesResult
    addExchangeRates: AddExchangeRatesResult
    deleteCountry(name: String!): DeleteCountryResult
    generateCountryImage: GenerateImageResult
  }
`;

const schema = buildSchema(typeDefs);

export { schema, typeDefs };
