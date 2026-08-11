import { get, post } from './client';

export const getAuthStatus = () => get('/auth/status');

export const setupFirstUser = (username, password) => post('/auth/setup', { username, password });

export const login = (username, password) => post('/auth/login', { username, password });

export const logout = () => post('/auth/logout');

export const listUsers = () => get('/auth/users');

export const createUser = (username, password) => post('/auth/users', { username, password });

export const changePassword = (currentPassword, newPassword) =>
  post('/auth/password', { current_password: currentPassword, new_password: newPassword });

export const setEmail = (email) => post('/auth/email', { email });
