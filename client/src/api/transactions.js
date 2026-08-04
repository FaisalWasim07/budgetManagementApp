import { get, post, del } from './client';

export function listTransactions({ accountId, month, personId } = {}) {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  if (month) params.set('month', month);
  if (personId) params.set('personId', personId);
  return get(`/transactions?${params.toString()}`);
}

export const createTransaction = (tx) => post('/transactions', tx);
export const createTransfer = (transfer) => post('/transactions/transfer', transfer);
export const deleteTransaction = (id) => del(`/transactions/${id}`);
