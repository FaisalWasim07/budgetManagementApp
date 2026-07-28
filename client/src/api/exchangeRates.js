import { get, post } from './client';

export const getRate = (base, target) => get(`/exchange-rates/${base}/${target}`);
export const refreshRate = (base, target) => post('/exchange-rates/refresh', { base, target });
