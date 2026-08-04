import { get, post, patch, del } from './client';

export const listSubscriptions = (month) =>
  get(month ? `/subscriptions?month=${month}` : '/subscriptions');

export const createSubscription = (sub) => post('/subscriptions', sub);
export const updateSubscription = (id, changes) => patch(`/subscriptions/${id}`, changes);
export const deleteSubscription = (id) => del(`/subscriptions/${id}`);
