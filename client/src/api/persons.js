import { get, post, patch, del } from './client';

export const listPersons = () => get('/persons');
export const renamePerson = (id, name) => patch(`/persons/${id}`, { name });

export const createPerson = (name, options = {}) =>
  post('/persons', { name, with_account: options.withAccount !== false, currency: options.currency });

export const deletePerson = (id) => del(`/persons/${id}`);
