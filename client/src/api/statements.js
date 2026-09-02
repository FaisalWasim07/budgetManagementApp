import { post } from './client';

// Sends the text pulled out of the statement, never the file and never the
// password. Nothing is stored at either end: the rows come back in the
// response and live in the screen until it closes.
export const scanStatement = (text, accountId) =>
  post('/statements/scan', { text, account_id: accountId ?? null });
