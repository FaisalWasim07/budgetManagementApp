import { get } from './client';

export const getSummary = (month) => get(`/summary/${month}`);
export const getTrend = (months = 12) => get(`/summary/trend?months=${months}`);
export const getCategories = (month) => get(`/summary/categories/${month}`);
