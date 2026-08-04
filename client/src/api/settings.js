import { get, put } from './client';

export const getSettings = () => get('/settings');
export const updateSettings = (changes) => put('/settings', changes);
