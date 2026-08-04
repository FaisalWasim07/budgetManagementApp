import { get, post } from './client';

export const getRates = () => get('/exchange-rates');
export const refreshRates = () => post('/exchange-rates/refresh', {});
