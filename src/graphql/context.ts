import type { CountryService } from '../services/country-service.js';

export interface GraphQLContext {
  services: {
    country: CountryService;
  };
}
