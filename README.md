# Weightloss Ledger app

A small installable web app for logging food and weight from a phone. It has no server and no database of its own: it reads and writes the CSV files in a separate, private "ledger" GitHub repo through the GitHub API. This repo holds only the app's code.

- **Log food** by typing or dictating ("200 g 2% milk, 1 scoop protein powder, a bag of broccoli"). The app matches each item against the ledger's `data/reference.json` food list and shows the estimate before you log it. Anything it isn't sure of is saved with an `unverified` note so it can be checked later.
- **Running tally** for the day: calories, protein, carbs and fat, eaten versus left.
- **Logging streak** and a check each morning that yesterday's log is complete.
- **Weight** entry and a 60-day chart.

## Setup

1. Open the app's GitHub Pages URL on the phone.
2. Create a GitHub fine-grained personal access token: Settings → Developer settings → Fine-grained tokens. Give it access to **only the ledger repo**, with **Contents: Read and write**.
3. Paste the repo name and the token into the app's Settings. They are stored on that device only and sent only to `api.github.com`.
4. Add it to the home screen from the browser menu.

`?demo` on the URL runs the app on made-up data without a token.

## Files

```
index.html   The one screen
app.js       Screen and actions
core.js      CSV, food-text parsing, totals, streak, GitHub sync (no DOM)
test.js      node test.js <path to ledger repo>
sw.js        Caches the app shell
```

No build step and no dependencies.
