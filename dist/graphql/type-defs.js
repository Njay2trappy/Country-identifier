export const typeDefs = `#graphql
  enum Region {
    Africa
    Americas
    Antarctic
    Antarctic_Ocean
    Asia
    Europe
    Oceania
    Polar
  }

  enum CountrySortField {
    NAME
    POPULATION
    ESTIMATED_GDP
  }

  enum SortDirection {
    ASC
    DESC
  }

  enum ServiceErrorCode {
    VALIDATION
    NOT_FOUND
    EXTERNAL_API
    INTERNAL
  }

  type Currency {
    code: String
    name: String
    symbol: String
  }

  type Country {
    id: ID!
    name: String
    capital: String
    region: String
    population: Int
    currencyCode: String
    currencies: [Currency!]!
    exchangeRate: Float
    estimatedGdp: Float
    flagUrl: String
    lastRefreshedAt: String
    independent: Boolean
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type CountryEdge {
    cursor: String!
    node: Country!
  }

  type CountryConnection {
    totalCount: Int!
    edges: [CountryEdge!]!
    nodes: [Country!]!
    pageInfo: PageInfo!
  }

  input CountryFilterInput {
    name: String
    region: Region
    currency: String
  }

  input CountrySortInput {
    field: CountrySortField!
    direction: SortDirection! = ASC
  }

  type CountryStatus {
    totalCountries: Int!
    lastRefreshedAt: String
  }

  type StoreCountriesPayload {
    success: Boolean!
    message: String!
    count: Int!
    countries: [Country!]!
    errorCode: ServiceErrorCode
  }

  type AddExchangeRatesPayload {
    success: Boolean!
    message: String!
    count: Int!
    countries: [Country!]!
    errorCode: ServiceErrorCode
  }

  type DeleteCountryPayload {
    success: Boolean!
    message: String!
    deletedCountry: Country
    errorCode: ServiceErrorCode
  }

  type GenerateCountryImagePayload {
    success: Boolean!
    message: String!
    imagePath: String
    errorCode: ServiceErrorCode
  }

  type Query {
    countriesConnection(
      filter: CountryFilterInput
      sort: CountrySortInput
      first: Int
      last: Int
      after: String
      before: String
    ): CountryConnection!
    countries(filter: CountryFilterInput, sort: CountrySortInput): [Country!]!
    country(name: String!): Country
    countryStatus: CountryStatus!
  }

  type Mutation {
    storeCountries: StoreCountriesPayload!
    addExchangeRates: AddExchangeRatesPayload!
    deleteCountry(name: String!): DeleteCountryPayload!
    generateCountryImage: GenerateCountryImagePayload!
  }
`;
