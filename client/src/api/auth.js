import { get, post, del } from './client';

export const getAuthStatus = () => get('/auth/status');

export const setupFirstUser = (username, password) => post('/auth/setup', { username, password });

export const login = (username, password) => post('/auth/login', { username, password });

export const logout = () => post('/auth/logout');

export const listUsers = () => get('/auth/users');

export const createUser = (username, password) => post('/auth/users', { username, password });

export const changePassword = (currentPassword, newPassword) =>
  post('/auth/password', { current_password: currentPassword, new_password: newPassword });

export const setEmail = (email) => post('/auth/email', { email });

// Passkeys. `login` answers with either a user or a challenge, and these are
// the two ways of settling that challenge.
export const loginWithPasskey = (challengeId, response) =>
  post('/auth/login/passkey', { challengeId, response });

export const loginWithRecoveryCode = (challengeId, code) =>
  post('/auth/login/recovery', { challengeId, code });

export const listPasskeys = () => get('/auth/passkeys');

export const startPasskeyRegistration = () => post('/auth/passkeys/start');

export const finishPasskeyRegistration = (challengeId, response, label) =>
  post('/auth/passkeys/finish', { challengeId, response, label });

export const removePasskey = (id, password) => del(`/auth/passkeys/${id}`, { password });

export const newRecoveryCodes = (password) => post('/auth/recovery-codes', { password });

// Proving it is still you, without signing in again. Used before the figures
// go on screen when this device is set to ask.
export const startVerify = () => post('/auth/verify/start');

export const finishVerify = (challengeId, response) =>
  post('/auth/verify/finish', { challengeId, response });
