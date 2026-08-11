import { get, post, patch, del } from './client';

export const listHouseholds = () => get('/households');

export const createHousehold = (name, people) => post('/households', { name, people });

export const renameHousehold = (id, name) => patch(`/households/${id}`, { name });

export const listMembers = (id) => get(`/households/${id}/members`);

export const addMember = (id, body) => post(`/households/${id}/members`, body);

export const setMemberRole = (id, userId, role) =>
  patch(`/households/${id}/members/${userId}`, { role });

export const removeMember = (id, userId) => del(`/households/${id}/members/${userId}`);

export const resetMemberPassword = (id, userId, newPassword) =>
  post(`/households/${id}/members/${userId}/password`, { new_password: newPassword });

export const listInvites = (id) => get(`/households/${id}/invites`);

export const createInvite = (id, role) => post(`/households/${id}/invites`, { role });

export const revokeInvite = (id, code) => del(`/households/${id}/invites/${code}`);

export const acceptInvite = (code) => post('/households/accept', { code });
