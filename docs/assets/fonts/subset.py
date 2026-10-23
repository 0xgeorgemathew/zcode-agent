# Rebuilds the font subsets the README drawings embed, and metrics.json (advance
# widths, so the build scripts can measure text). Run once after changing the
# character set; the drawings themselves need only Node.
#   pip install fonttools brotli
#   python3 docs/assets/fonts/subset.py <dir with the IBM Plex .ttf files>
# Fonts: IBM Plex Sans, Sans Condensed and Mono (SIL OFL 1.1, see OFL.txt).
import json, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = {
    'plex-cond-bold': 'IBMPlexSansCondensed-Bold.ttf',
    'plex-sans': 'IBMPlexSans-Regular.ttf',
    'plex-sans-semibold': 'IBMPlexSans-SemiBold.ttf',
    'plex-mono': 'IBMPlexMono-Regular.ttf',
    'plex-mono-semibold': 'IBMPlexMono-SemiBold.ttf',
}
CHARS = [chr(c) for c in range(0x20, 0x7F)] + list('·…→←—–×✓')

here = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1]
metrics = {}
for name, file in FONTS.items():
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga']
    opts.hinting = False
    opts.desubroutinize = True
    font = subset.load_font(os.path.join(src, file), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in CHARS])
    sub.subset(font)
    subset.save_font(font, os.path.join(here, name + '.woff2'), opts)
    full = TTFont(os.path.join(src, file))
    cmap, hmtx = full.getBestCmap(), full['hmtx']
    metrics[name] = {
        'unitsPerEm': full['head'].unitsPerEm,
        'advance': {c: hmtx[cmap[ord(c)]][0] for c in CHARS if ord(c) in cmap},
    }
with open(os.path.join(here, 'metrics.json'), 'w') as f:
    json.dump(metrics, f, ensure_ascii=False, separators=(',', ':'))
