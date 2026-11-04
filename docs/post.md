LinkedIn lets you download your connections as a set of CSV files. I wanted to see where my network comes from, so I built a small tool that groups the export into circles and plays back how they grew.

Most of what I learned was about the export itself. It lists each contact's current company, title and the date you connected, but not who knows whom among your contacts. So any grouping is an inference from shared companies and from people you added within a few days of each other, and it can't show bridges or brokers between groups.

On a synthetic export with planted circles, the default settings recover them with an ARI of 0.61, averaged over 10 seeds. On real Facebook friend graphs, where those ties do exist, the same clustering scores a mean NMI of 0.68 across 10 networks. The check against my own hand labels is still pending, and the write-up lists what each number does and doesn't show.

The tool runs in your browser tab. You drop Connections.csv and Positions.csv on the page, and Python (Pyodide, loaded from a CDN) does the work locally. Your files are never uploaded. The public demo uses fictional people only.

Demo: https://arak00.github.io/network-circles/
Code and method write-up: https://github.com/Arak00/network-circles

[video]

#DataVisualization #OpenSource
