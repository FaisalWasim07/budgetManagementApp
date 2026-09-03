import { get, post } from './client';

// Which models a statement may be read with, and what each costs. Asked for
// rather than held here: the list and its prices have one home, on the server,
// and this only ever renders what it is given.
export const getScanChoices = () => get('/statements/models');

// Sends the text pulled out of the statement, never the file and never the
// password. Nothing is stored at either end: the rows come back in the
// response and live in the screen until it closes.
//
// The model and effort are what was picked before reading started. They are a
// request, not an instruction — the server falls back to its own default for
// anything it does not recognise.
export const scanStatement = (text, accountId, model, effort) =>
  post('/statements/scan', {
    text,
    account_id: accountId ?? null,
    model: model ?? null,
    effort: effort ?? null,
  });

// The arithmetic, over every slice at once. No model behind it, so it answers
// immediately — and it has to see the whole statement, because findings over a
// third of one are a third of the truth.
export const analyseStatement = (rows, statement) =>
  post('/statements/analyse', { rows, statement: statement ?? null });
