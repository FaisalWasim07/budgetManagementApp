import { get, post, patch, del } from './client';

export const listAccounts = (personId) =>
  get(personId ? `/accounts?personId=${personId}` : '/accounts');

export const createAccount = (account) => post('/accounts', account);
export const updateAccount = (id, changes) => patch(`/accounts/${id}`, changes);
export const removeAccount = (id) => del(`/accounts/${id}`);
