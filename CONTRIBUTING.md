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

## No real data

Never put a real export, real names or real companies in issues, pull requests or tests. If you need data to reproduce something, generate it with `src/synth.py`.

## Good first issues

- A better role keyword map (the `ROLES` list in `netmap.py`)
- A weighted null model in `validate.py`
- Zip support in the viewer's drop mode
- An offline Pyodide bundle
- Date formats from exports in other languages
