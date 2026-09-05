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
// The host stops waiting at sixty seconds, so there is nothing to wait for
// after that: a request still open past it is one whose function has already
// been killed, and the connection is the only thing left alive. Given a little
// room over that ceiling, a slice that is never going to answer fails as a
// slice — which the reading already knows how to survive, retry once, and be
// honest about — instead of hanging the whole statement on a progress line
// that will never move again.
const HOST_GIVES_UP_AT = 75_000;

export const scanStatement = (text, accountId, model, effort) =>
  post(
    '/statements/scan',
    {
      text,
      account_id: accountId ?? null,
      model: model ?? null,
      effort: effort ?? null,
    },
    { timeoutMs: HOST_GIVES_UP_AT },
  );

// The arithmetic, over every slice at once. No model behind it, so it answers
// immediately — and it has to see the whole statement, because findings over a
// third of one are a third of the truth.
export const analyseStatement = (rows, statement) =>
  post('/statements/analyse', { rows, statement: statement ?? null });

// The written half of the report, and the second time a scan spends money — so
// it goes out when the button is pressed and not before. The rows go rather
// than the report: the figures the paragraph is written from are worked out on
// the server, from these, by the code that produced what is already on screen.
export const summariseStatement = (rows, statement, accountId, model, effort) =>
  post(
    '/statements/summary',
    {
      rows,
      statement: statement ?? null,
      account_id: accountId ?? null,
      model: model ?? null,
      effort: effort ?? null,
    },
    { timeoutMs: HOST_GIVES_UP_AT },
  );
