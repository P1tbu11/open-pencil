import base64
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image

SPACE = 'Xiaolong-Wang/Ming-Image-0.1-Design-Layer'
DEEPINFRA_URL = 'https://api.deepinfra.com/v1/inference/inclusionAI/Ming-Image-0.1-Design-Layer'
DEEPINFRA_TOKEN = Path.home() / '.config/ui-slice-studio/deepinfra-token.txt'
MAX_LAYERS = 20
SMALL = 0.015


def layer_plan(boxes: list[dict], width: int, height: int) -> str:
    def where(box: dict) -> str:
        cx = (box['x'] + box['width'] / 2) / width
        cy = (box['y'] + box['height'] / 2) / height
        column = 'left' if cx < 0.33 else 'right' if cx > 0.67 else 'center'
        row = 'top' if cy < 0.33 else 'bottom' if cy > 0.67 else 'middle'
        return f'{row} {column}'

    def nested(box: dict) -> bool:
        return any(
            other is not box
            and other['width'] * other['height'] > box['width'] * box['height'] * 1.6
            and shared(other, box) > box['width'] * box['height'] * 0.85
            for other in boxes
        )

    large = [box for box in boxes if box['width'] * box['height'] >= width * height * SMALL]
    rows = []
    for box in sorted((box for box in boxes if box not in large), key=lambda box: box['y'] + box['height'] / 2):
        center = box['y'] + box['height'] / 2
        row = next((row for row in rows if abs(row['center'] - center) < max(box['height'], row['size']) * 0.5), None)
        if row:
            row['boxes'].append(box)
        else:
            rows.append({'center': center, 'size': box['height'], 'boxes': [box]})

    entries = [(f'the {name(box)} ({where(box)})', 0 if nested(box) else 1, box['width'] * box['height']) for box in large]
    for row in rows:
        members = row['boxes']
        if len(members) == 1:
            entries.append((f'the {name(members[0])} ({where(members[0])})', 0, members[0]['width'] * members[0]['height']))
        else:
            names = ', '.join(dict.fromkeys(name(box) for box in members))
            entries.append((f'the row of small items: {names} ({where(members[0])})', 0, sum(box['width'] * box['height'] for box in members)))
    entries.sort(key=lambda entry: (entry[1], entry[2]))
    budget = MAX_LAYERS - 2
    if len(entries) > budget:
        entries = entries[: budget - 1] + [('all remaining panels, icons and buttons', 1, 0)]
    lines = ['all text labels and numbers'] + [entry[0] for entry in entries] + ['the background scene behind everything, with no UI elements']
    body = ';\n'.join(f'layer {index}: {line}' for index, line in enumerate(lines, start=1))
    return f'Decompose this game UI screen into {len(lines)} layers, front to back:\n{body}.'


def name(box: dict) -> str:
    return str(box.get('name') or 'element')[:48]


def shared(a: dict, b: dict) -> float:
    left, top = max(a['x'], b['x']), max(a['y'], b['y'])
    right = min(a['x'] + a['width'], b['x'] + b['width'])
    bottom = min(a['y'] + a['height'], b['y'] + b['height'])
    return max(0, right - left) * max(0, bottom - top)


def decompose(image_path: Path, plan: str, out: Path) -> list[Image.Image]:
    if os.environ.get('UI_SLICE_LAYER_PROVIDER') == 'deepinfra':
        layers = deepinfra(image_path, plan)
    else:
        layers = space(image_path, plan, out)
    print(f'Ming returned {len(layers)} layers', file=sys.stderr)
    return list(reversed(layers))


def space(image_path: Path, plan: str, out: Path) -> list[Image.Image]:
    from gradio_client import Client, handle_file

    client = Client(SPACE, download_files=str(out / 'remote'), httpx_kwargs={'timeout': 900})
    _, gallery, _, _ = client.predict(image_path=handle_file(str(image_path)), prompt=plan, size='auto', api_name='/decompose')
    layers = []
    for item in gallery or []:
        with Image.open(item['image']) as layer:
            layers.append(layer.convert('RGBA'))
    return layers


def deepinfra(image_path: Path, plan: str) -> list[Image.Image]:
    with Image.open(image_path) as opened:
        buffer = io.BytesIO()
        opened.convert('RGB').save(buffer, 'PNG')
    payload = {'prompt': plan, 'image': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()}
    request = urllib.request.Request(
        DEEPINFRA_URL,
        data=json.dumps(payload).encode(),
        method='POST',
        headers={'Authorization': f'Bearer {DEEPINFRA_TOKEN.read_text().strip()}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        data = json.load(response)
    return [Image.open(io.BytesIO(base64.b64decode(item.split(',', 1)[1]))).convert('RGBA') for item in data.get('images') or []]
