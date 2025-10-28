import type { CountryResponse } from './country.js';
import type { ServiceErrorCode } from '../lib/errors.js';

export interface OperationOutcome {
  success: boolean;
  message: string;
  errorCode?: ServiceErrorCode;
}

export interface StoreCountriesResult extends OperationOutcome {
  count: number;
  countries: CountryResponse[];
}

export interface AddExchangeRatesResult extends OperationOutcome {
  count: number;
  countries: CountryResponse[];
}

export interface DeleteCountryResult extends OperationOutcome {
  deletedCountry: CountryResponse | null;
}

export interface GenerateImageResult extends OperationOutcome {
  imagePath: string | null;
}
