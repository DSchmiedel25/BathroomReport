# BathroomReport location updater

This package gives you two separate GitHub Actions:

1. **Update Stewart's locations**
   - Pulls all official Stewart's store pages.
   - Writes `stewarts-locations.js`.
   - Writes `stewarts-pull-report.json`.

2. **Update Cumberland Farms locations**
   - Pulls Cumberland Farms separately.
   - Writes `cumberland-farms-locations.js`.
   - Writes `cumberland-farms-pull-report.json`.
   - Manual runs accept `ALL` or state abbreviations such as `MA VT NH ME`.

## Upload paths

Upload the files to your repository using these exact paths:

- `.github/workflows/update-stewarts-locations.yml`
- `.github/workflows/update-cumberland-farms-locations.yml`
- `scripts/pull_stewarts_locations.py`
- `scripts/pull_cumberland_farms_locations.py`

## GitHub setting

Repository → Settings → Actions → General → Workflow permissions:

- Select **Read and write permissions**
- Save

## Run from a phone

Repository → Actions → choose the workflow → **Run workflow**.

For Cumberland Farms:
- `ALL` pulls every state.
- `MA` pulls Massachusetts only.
- `MA VT NH ME` pulls those four states.

## Important

The workflows replace each chain's location file separately. They include safety checks so a bad or blocked crawl does not overwrite a large file with an obviously incomplete one.

Your `app.js` should continue skipping entries with missing/null coordinates rather than crashing.
