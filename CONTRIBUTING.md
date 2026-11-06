# Contributing

Thanks for helping. A few rules keep the tool working in the browser and keep real people out of the repo.

## Keep netmap.py runnable in Pyodide

`src/netmap.py` runs inside Pyodide 0.27.7 in the viewer, so it can only use the standard library, pandas 2.2 and igraph 0.11. Don't add leidenalg, rapidfuzz, sklearn or anything else Pyodide doesn't ship.

## Before you open a pull request

```sh
python src/netmap.py --selftest
python src/validate.py run none
```

The second command rewrites `results/metrics.json` from the synthetic demo. Include the diff if your change moves a number.

If you touched the viewer (`web/`), also run the layout tests. They need Playwright, which is kept out of `requirements.txt` because that file is pinned to what Pyodide ships:

```sh
pip install playwright && python -m playwright install chromium
python tests/grid.py              # synthetic exports: 30, 300 and 3,000 people plus edge cases (always run it whole: it clears tests/out)
python tests/layout_test.py --axe # overlaps (labels, dots, labels on dots), pins name <= 20 people, results stay up, keyboard, axe
python tests/shots.py after       # screenshots and numbers of the main journey into tests/report/, to compare with a "before" run
python tests/palette_check.py     # circle colours: contrast, and colour-vision warnings
python tests/journey_test.py      # own-data journey end to end; fails if any request carries data (needs network for Pyodide)
```

`tests/layout_test.py` also prints the edge crossings in the Layers view; say in the pull request if your change moves them.

## No real data

Never put a real export, real names or real companies in issues, pull requests or tests. If you need data to reproduce something, generate it with `src/synth.py`.

## Good first issues

- A better role keyword map (the `ROLES` list in `netmap.py`)
- A weighted null model in `validate.py`
- An offline Pyodide bundle
- Date formats from exports in other languages
