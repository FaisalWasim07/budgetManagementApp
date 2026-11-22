# Working on bayt

## Shipping

Always ship finished work to `main` unless the request says otherwise.
Once a change is done and the API tests, browser tests and build pass,
push it to the working branch and fast-forward `main` to it
(`git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`).
Hold back only when told to, e.g. "don't ship", "just on dev" or "let me try it first".
