"""Writes the bars Julián marked into datos/plantilla.ods, cell by cell, keeping styles and dropdowns.

Usage: python3 -I tools/datos/escribir-hoja.py <sheet.ods> <values.json> <out.ods>  (write to a copy, check, then replace)
values.json: {"<dorsal>": {"velocidad": 7, "rasgo": "Leñador", ...}, ...}  (only the cells to write;
numbers 1-10 for the bars, text for the Rasgo column)
"""
import json, re, sys, unicodedata, zipfile

src, values_file, out = sys.argv[1:4]
values = {int(k): v for k, v in json.load(open(values_file, encoding='utf-8')).items()}

def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').strip()

KEYS = {'velocidad': 'velocidad', 'resistencia': 'resistencia', 'potencia': 'potencia', 'precision': 'precision', 'pase': 'pase',
        'habilidad': 'habilidad', 'defensa': 'defensa', 'agresividad': 'agresividad', 'reflejos': 'reflejos',
        'colocacion': 'colocacion', 'salida': 'salida', 'rasgo': 'rasgo'}
TEXT_KEYS = {'rasgo'}
CELL = re.compile(r'<table:(covered-)?table-cell\b([^>]*?)(/>|>(.*?)</table:(?:covered-)?table-cell>)', re.S)

def cells_of(row):
    """Logical cells of a row: list of (attrs, inner, covered), with repeats expanded up to 40 columns."""
    out = []
    for m in CELL.finditer(row):
        covered, attrs, inner = bool(m.group(1)), m.group(2), m.group(4)
        rep = re.search(r'\s*table:number-columns-repeated="(\d+)"', attrs)
        n = int(rep.group(1)) if rep else 1
        if rep and len(out) + n > 40:
            out.append((attrs, inner, covered))  # the long tail stays as it is
            continue
        clean = re.sub(r'\s*table:number-columns-repeated="\d+"', '', attrs)
        for _ in range(n):
            out.append((clean if rep else attrs, inner, covered))
    return out

def cell_xml(attrs, inner, covered):
    tag = 'table:covered-table-cell' if covered else 'table:table-cell'
    return f'<{tag}{attrs}/>' if inner is None else f'<{tag}{attrs}>{inner}</{tag}>'

def text(inner):
    return re.sub(r'<[^>]+>', '', inner or '').strip()

def text_cell(attrs, value):
    keep = re.sub(r'\s*(office:value-type|office:value|calcext:value-type|office:string-value)="[^"]*"', '', attrs)
    safe = value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return (f'{keep} office:value-type="string" calcext:value-type="string"', f'<text:p>{safe}</text:p>', False)

def number_cell(attrs, value):
    keep = re.sub(r'\s*(office:value-type|office:value|calcext:value-type|office:string-value)="[^"]*"', '', attrs)
    return (f'{keep} office:value-type="float" office:value="{value}" calcext:value-type="float"', f'<text:p>{value}</text:p>', False)

with zipfile.ZipFile(src) as z:
    items = [(info, z.read(info.filename)) for info in z.infolist()]
content = next(data for info, data in items if info.filename == 'content.xml').decode('utf-8')
start = content.index('table:name="Jugadores"')
end = content.index('</table:table>', start)
table = content[start:end]
rows = list(re.finditer(r'<table:table-row\b[^>]*>.*?</table:table-row>', table, re.S))
header = cells_of(rows[0].group(0))
col = {}
for i, (attrs, inner, covered) in enumerate(header):
    k = norm(text(inner))
    if k in KEYS: col[KEYS[k]] = i
    if k == 'dorsal': col['dorsal'] = i
missing = [k for k in KEYS if k not in col]
assert not missing, f'faltan columnas: {missing}'

written = {}
new_table = table
for m in reversed(rows[1:]):
    row = m.group(0)
    cells = cells_of(row)
    if len(cells) <= col['dorsal']: continue
    try:
        dorsal = int(float(text(cells[col['dorsal']][1])))
    except ValueError:
        continue
    if dorsal not in values: continue
    for key, value in values[dorsal].items():
        if key not in col: continue
        attrs, inner, covered = cells[col[key]]
        if key in TEXT_KEYS:
            if not isinstance(value, str) or not value: continue
            cells[col[key]] = text_cell(attrs, value)
        else:
            if not isinstance(value, int) or not 1 <= value <= 10: continue
            cells[col[key]] = number_cell(attrs, value)
        written.setdefault(dorsal, {})[key] = value
    open_tag = re.match(r'<table:table-row\b[^>]*>', row).group(0)
    new_row = open_tag + ''.join(cell_xml(*c) for c in cells) + '</table:table-row>'
    new_table = new_table[:m.start()] + new_row + new_table[m.end():]

content = content[:start] + new_table + content[end:]
with zipfile.ZipFile(out, 'w') as z:
    for info, data in items:
        if info.filename == 'content.xml': data = content.encode('utf-8')
        # ODF: "mimetype" first and uncompressed; the rest deflated.
        z.writestr(info, data, compress_type=zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED)
print(json.dumps({'jugadores': len(written), 'barras': sum(len(v) for v in written.values())}))
