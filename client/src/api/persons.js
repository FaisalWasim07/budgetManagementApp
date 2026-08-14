import { get, post, patch, put, del } from './client';

export const listPersons = () => get('/persons');

// Which login a person is. Pass null to unset.
export const setPersonUser = (personId, userId) =>
  put(`/persons/${personId}/user`, { user_id: userId });
export const renamePerson = (id, name) => patch(`/persons/${id}`, { name });

export const createPerson = (name, options = {}) =>
  post('/persons', { name, with_account: options.withAccount !== false, currency: options.currency });

export const deletePerson = (id) => del(`/persons/${id}`);
