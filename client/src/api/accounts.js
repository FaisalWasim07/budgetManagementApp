import { get, post } from './client';

export const listAccounts = (personId) =>
  get(personId ? `/accounts?personId=${personId}` : '/accounts');

export const createAccount = (account) => post('/accounts', account);
