import { get, post, put, del } from './client';

export const upsertMonthlyEntry = (entry) => put('/monthly-entries', entry);

export const listExpenseEntries = (accountId, month) =>
  get(`/expense-entries?accountId=${accountId}&month=${month}`);
export const createExpenseEntry = (entry) => post('/expense-entries', entry);
export const deleteExpenseEntry = (id) => del(`/expense-entries/${id}`);

export const listContributions = (accountId, month) =>
  get(`/contributions?accountId=${accountId}&month=${month}`);
export const createContribution = (entry) => post('/contributions', entry);
export const deleteContribution = (id) => del(`/contributions/${id}`);
