import { get, patch } from './client';

export const listPersons = () => get('/persons');
export const renamePerson = (id, name) => patch(`/persons/${id}`, { name });
