import { get } from './client';

export const getSummary = (month) => get(`/summary/${month}`);
// endMonth follows whichever month is on screen, so scrolling back to March
// shows the twelve months up to March rather than always to today.
export const getTrend = (months = 12, endMonth) =>
  get(`/summary/trend?months=${months}${endMonth ? `&endMonth=${endMonth}` : ''}`);
export const getCategories = (month) => get(`/summary/categories/${month}`);
