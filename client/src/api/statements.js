import { post } from './client';

// Sends the text pulled out of the statement, never the file and never the
// password. Nothing is stored at either end: the rows come back in the
// response and live in the screen until it closes.
export const scanStatement = (text, accountId) =>
  post('/statements/scan', { text, account_id: accountId ?? null });

// The arithmetic, over every slice at once. No model behind it, so it answers
// immediately — and it has to see the whole statement, because findings over a
// third of one are a third of the truth.
export const analyseStatement = (rows, statement) =>
  post('/statements/analyse', { rows, statement: statement ?? null });
