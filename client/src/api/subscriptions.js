import { get, post, patch, del } from './client';

export const listSubscriptions = (month) =>
  get(month ? `/subscriptions?month=${month}` : '/subscriptions');

export const createSubscription = (sub) => post('/subscriptions', sub);

// Every change carries the month it takes effect from. A new price applies from
// that month on and the months before it keep what they actually cost, so the
// month being viewed has to travel with the request rather than being guessed
// at the far end.
export const updateSubscription = (id, changes, fromMonth) =>
  patch(`/subscriptions/${id}`, { ...changes, from_month: fromMonth });

export const stopSubscription = (id, fromMonth) =>
  post(`/subscriptions/${id}/stop`, { from_month: fromMonth });

export const resumeSubscription = (id, fromMonth) =>
  post(`/subscriptions/${id}/resume`, { from_month: fromMonth });

// Deleting is not stopping: it erases the item from every month it ever
// charged, for when it should never have been recorded at all.
export const deleteSubscription = (id) => del(`/subscriptions/${id}`);
