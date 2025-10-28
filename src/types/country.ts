export interface CountryCurrency {
  code: string | null;
  name: string | null;
  symbol: string | null;
}

export interface CountryRecord {
  id: number;
  name: string | null;
  capital: string | null;
  region: string | null;
  population: number | null;
  flag: string | null;
  currencies: CountryCurrency[];
  independent: boolean | null;
  exchangeRate: number | null;
  estimatedGdp: number | null;
  lastRefreshedAt: string | null;
}

export interface CountryResponse {
  id: number;
  name: string | null;
  capital: string | null;
  region: string | null;
  population: number | null;
  currencyCode: string | null;
  currencies: CountryCurrency[];
  exchangeRate: number | null;
  estimatedGdp: number | null;
  flagUrl: string | null;
  lastRefreshedAt: string | null;
  independent: boolean | null;
}

export interface CountryFilters {
  name?: string;
  region?: string;
  currency?: string;
}

export type ConnectionCursor = string;

export interface CountryConnectionEdge {
  cursor: ConnectionCursor;
  node: CountryResponse;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: ConnectionCursor | null;
  endCursor: ConnectionCursor | null;
}

export interface CountryConnection {
  edges: CountryConnectionEdge[];
  nodes: CountryResponse[];
  pageInfo: PageInfo;
  totalCount: number;
}

export enum CountrySortField {
  NAME = 'NAME',
  POPULATION = 'POPULATION',
  ESTIMATED_GDP = 'ESTIMATED_GDP',
}

export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

export interface CountrySortOption {
  field: CountrySortField;
  direction: SortDirection;
}

export interface CountryStatus {
  totalCountries: number;
  lastRefreshedAt: string | null;
}
