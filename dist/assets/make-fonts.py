# Subsets of URW Base35 P052; see FONT-LICENSE.txt (AGPL-3 with Font exception).
# Generated using fontTools. Install fonttools, then run in this directory.
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
root = Path(__file__).parent
for source, output in [("P052-Roman.otf", "editorial-regular.woff"), ("P052-Italic.otf", "editorial-italic.woff")]:
    font = TTFont(root / source)
    options = subset.Options()
    options.flavor = "woff"
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=range(0x20, 0x180))
    sub.subset(font)
    font.flavor = "woff"
    font.save(root / output)
