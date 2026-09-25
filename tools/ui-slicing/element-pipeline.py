import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat

TOKEN_FILE = Path.home() / '.config/ui-slice-studio/modelscope-token.txt'
DETECT_URL = 'https://api-inference.modelscope.cn/v1/chat/completions'
DETECT_MODEL = 'Qwen/Qwen3.8-Flash-Next'
MAX_SIDE = 1280
MAX_IMAGES = 80
MAX_TEXTS = 40


def main() -> None:
    image_path = Path(sys.argv[1])
    out = Path(sys.argv[2])
    ocr_bin = Path(sys.argv[3])
    prompt_path = Path(sys.argv[4])
    out.mkdir(parents=True, exist_ok=True)
    token = TOKEN_FILE.read_text().strip()
    if not token:
        raise SystemExit('ModelScope token file is empty')
    with Image.open(image_path) as opened:
        image = opened.convert('RGB')
    width, height = image.size
    view, scale = preview(image)
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=2) as pool:
            qwen_job = pool.submit(qwen_layers, image_path, image, out, token)
            detect_job = pool.submit(detect, view, token, prompt_path.read_text())
            qwen = qwen_job.result()
            detected = [scale_up(item, scale) for item in detect_job.result()]
        (out / 'detected.json').write_text(json.dumps(detected, ensure_ascii=False))
        recognized = ocr(ocr_bin, image_path) if ocr_bin.is_file() else []
        texts = merge_text(detected, recognized)
        layers = assemble(image, qwen, detected, texts, out)
    finally:
        sys.stdout = saved
    sys.stdout.write(json.dumps({'width': width, 'height': height, 'scale': scale, 'layers': layers}))


LAYER_NAMES = ('背景', '远景', '场景', '界面', '角色', '控件', '前景', '装饰')


def qwen_layers(image_path: Path, image: Image.Image, out: Path, token: str) -> list[dict]:
    from gradio_client import Client, handle_file

    width, height = image.size
    client = Client(
        'https://studio-qwen-qwen-image-layered.api-inference.modelscope.net',
        headers={'Authorization': f'Bearer {token}'},
        download_files=str(out / 'remote'),
        httpx_kwargs={'timeout': 600},
    )
    print('connected', flush=True)
    result = client.predict(
        input_image=handle_file(str(image_path)),
        seed=0,
        randomize_seed=True,
        prompt='game ui screen',
        neg_prompt=' ',
        true_guidance_scale=4,
        num_inference_steps=50,
        layer=4,
        cfg_norm=True,
        use_en_prompt=True,
        api_name='/infer_1',
    )
    layers = []
    for index, item in enumerate(result[0]):
        remote = item['image'] if isinstance(item, dict) else item
        with Image.open(remote) as layer:
            fitted = layer.convert('RGBA').resize((width, height), Image.Resampling.LANCZOS)
            path = out / f'layer-{index}.png'
            fitted.save(path)
        layers.append(
            {
                'name': LAYER_NAMES[index] if index < len(LAYER_NAMES) else f'图层 {index + 1}',
                'kind': 'image',
                'x': 0,
                'y': 0,
                'width': width,
                'height': height,
                'z': index,
                'path': str(path),
                'text': '',
            }
        )
    return layers


def assemble(image: Image.Image, qwen: list[dict], detected: list[dict], texts: list[dict], out: Path) -> list[dict]:
    width, height = image.size
    layers = [qwen[0]]
    sprites = []
    for item in qwen[1:]:
        with Image.open(item['path']) as layer:
            sprites.extend(split_alpha(layer.convert('RGBA'), width, height))
    sprites.sort(key=lambda item: item['width'] * item['height'], reverse=True)
    sprites = [sprite for sprite in sprites if not mostly_text(sprite, texts)]
    for index, sprite in enumerate(sprites[:MAX_IMAGES]):
        box = {key: sprite[key] for key in ('x', 'y', 'width', 'height')}
        name = sprite_name(box, detected)
        knock_out_text(sprite['image'], box, texts)
        path = out / f'widget-{index}.png'
        sprite['image'].save(path)
        layers.append(
            {
                'name': name,
                'kind': 'image',
                'x': box['x'],
                'y': box['y'],
                'width': box['width'],
                'height': box['height'],
                'z': len(layers),
                'path': str(path),
                'text': '',
            }
        )
    for text in texts:
        box = clamp_box(text, width, height)
        if box['width'] < 2 or box['height'] < 2 or not text.get('text'):
            continue
        if box['width'] * box['height'] > width * height * 0.08:
            continue
        layers.append(
            {
                'name': text['text'][:40],
                'kind': 'text',
                'x': box['x'],
                'y': box['y'],
                'width': box['width'],
                'height': box['height'],
                'z': len(layers),
                'text': text['text'][:200],
                'fontSize': max(8, round(box['height'] * 0.8)),
                'fontFamily': 'Inter',
                'color': text_color(image, box),
            }
        )
    return layers


def split_alpha(layer: Image.Image, width: int, height: int) -> list[dict]:
    import cv2
    import numpy as np

    pixels = np.array(layer)
    mask = (pixels[:, :, 3] > 24).astype(np.uint8)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    sprites = []
    for index in range(1, count):
        x, y, box_width, box_height, area = (int(value) for value in stats[index])
        if area < 300 or box_width < 8 or box_height < 8:
            continue
        if box_width > width * 0.9 and box_height < height * 0.2:
            continue
        crop = pixels[y : y + box_height, x : x + box_width].copy()
        crop[:, :, 3] = np.where(labels[y : y + box_height, x : x + box_width] == index, crop[:, :, 3], 0)
        sprites.append({'x': x, 'y': y, 'width': box_width, 'height': box_height, 'image': Image.fromarray(crop)})
    return sprites


def sprite_name(box: dict, detected: list[dict]) -> str:
    named = [item for item in detected if item.get('kind') != 'text' and item.get('name') and overlap(box, item) > 0.3]
    if not named:
        return '控件'
    named.sort(key=lambda item: overlap(box, item), reverse=True)
    return str(named[0]['name'])[:40]


def mostly_text(sprite: dict, texts: list[dict]) -> bool:
    area = sprite['width'] * sprite['height']
    covered = sum(intersection(sprite, text) for text in texts)
    return area > 0 and covered / area > 0.6


def knock_out_text(sprite: Image.Image, box: dict, texts: list[dict]) -> None:
    import numpy as np

    pixels = np.array(sprite)
    changed = False
    for text in texts:
        pad = max(2, round(text['height'] * 0.15))
        left = int(max(box['x'], text['x'] - pad))
        top = int(max(box['y'], text['y'] - pad))
        right = int(min(box['x'] + box['width'], text['x'] + text['width'] + pad))
        bottom = int(min(box['y'] + box['height'], text['y'] + text['height'] + pad))
        if right - left < 2 or bottom - top < 2:
            continue
        region = pixels[top - box['y'] : bottom - box['y'], left - box['x'] : right - box['x'], 3]
        if (region > 200).mean() > 0.7:
            continue
        region[:] = 0
        changed = True
    if changed:
        sprite.paste(Image.fromarray(pixels))


def erase_text(sprite: Image.Image, box: dict, texts: list[dict]) -> None:
    draw = ImageDraw.Draw(sprite)
    for text in texts:
        left = int(max(box['x'], text['x']))
        top = int(max(box['y'], text['y']))
        right = int(min(box['x'] + box['width'], text['x'] + text['width']))
        bottom = int(min(box['y'] + box['height'], text['y'] + text['height']))
        if right - left < 2 or bottom - top < 2:
            continue
        local = (left - int(box['x']), top - int(box['y']), right - int(box['x']), bottom - int(box['y']))
        color = nearby_color(sprite, local)
        if color is None:
            continue
        draw.rectangle(local, fill=color)


def nearby_color(sprite: Image.Image, local: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
    samples = []
    left, top, right, bottom = local
    for y in range(max(0, top - 3), min(sprite.height, bottom + 3)):
        for x in range(max(0, left - 3), min(sprite.width, right + 3)):
            if left <= x < right and top <= y < bottom:
                continue
            pixel = sprite.getpixel((x, y))
            if isinstance(pixel, tuple) and len(pixel) == 4 and pixel[3] > 200:
                samples.append(pixel)
    if not samples:
        return None
    samples.sort(key=lambda pixel: pixel[0] + pixel[1] + pixel[2])
    mid = samples[len(samples) // 2]
    return (mid[0], mid[1], mid[2], 255)


def preview(image: Image.Image) -> tuple[Image.Image, float]:
    scale = min(1, MAX_SIDE / max(image.size))
    if scale == 1:
        return image, 1
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
    return resized, scale


def detect(image: Image.Image, token: str, prompt: str) -> list[dict]:
    buffer = image_bytes(image)
    payload = {
        'model': DETECT_MODEL,
        'messages': [
            {'role': 'system', 'content': prompt},
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': f'Original dimensions: {image.width} x {image.height} pixels.'},
                    {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + buffer}},
                ],
            },
        ],
    }
    request = urllib.request.Request(
        DETECT_URL,
        data=json.dumps(payload).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f'视觉识别失败 ({exc.code}): {detail}') from None
    content = body['choices'][0]['message']['content']
    parsed = json.loads(content.removeprefix('```json').removeprefix('```').removesuffix('```').strip())
    layers = parsed['layers'] if isinstance(parsed, dict) else parsed
    return [normalize(item, image.width, image.height) for item in layers if isinstance(item, dict)]


def image_bytes(image: Image.Image) -> str:
    import base64
    import io

    storage = io.BytesIO()
    image.save(storage, format='JPEG', quality=85)
    return base64.b64encode(storage.getvalue()).decode()


def normalize(item: dict, width: int, height: int) -> dict:
    box = {
        'name': str(item.get('name') or '图层')[:40],
        'kind': 'text' if item.get('kind') == 'text' else 'image',
        'x': number(item.get('x')),
        'y': number(item.get('y')),
        'width': number(item.get('width')),
        'height': number(item.get('height')),
        'text': str(item.get('text') or '').strip(),
    }
    return box


def ocr(binary: Path, image_path: Path) -> list[dict]:
    completed = subprocess.run([str(binary), str(image_path)], capture_output=True, text=True, timeout=60)
    if completed.returncode != 0:
        return []
    layers = json.loads(completed.stdout).get('layers', [])
    return [item for item in (ocr_box(layer) for layer in layers) if item]


def merge_text(detected: list[dict], recognized: list[dict]) -> list[dict]:
    texts = [item for item in detected if item['kind'] == 'text' and item['text']]
    for item in recognized:
        if not item['text'] or any(overlap(item, existing) > 0.2 for existing in texts):
            continue
        texts.append(item)
    return texts[:MAX_TEXTS]


def local_boxes(image: Image.Image) -> list[dict]:
    import cv2
    import numpy as np

    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    edges = cv2.dilate(cv2.Canny(gray, 40, 140), np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    width, height = image.size
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if box_width < 20 or box_height < 20 or box_width > width * 0.92 or box_height > height * 0.92:
            continue
        box = {'name': f'元素 {len(boxes) + 1}', 'kind': 'image', 'x': x, 'y': y, 'width': box_width, 'height': box_height, 'text': ''}
        if any(overlap(box, existing) > 0.7 for existing in boxes):
            continue
        boxes.append(box)
    boxes.sort(key=lambda item: item['width'] * item['height'], reverse=True)
    return boxes[:MAX_IMAGES]


def image_boxes(detected: list[dict], texts: list[dict]) -> list[dict]:
    boxes = []
    for item in detected:
        if item['kind'] != 'image':
            continue
        area = item['width'] * item['height']
        if area < 16 or area <= 0:
            continue
        if any(overlap(item, text) > 0.6 for text in texts):
            continue
        if any(contains(larger, item) > 0.85 for larger in boxes):
            continue
        boxes.append(item)
    return boxes[:MAX_IMAGES]


def render(image: Image.Image, images: list[dict], texts: list[dict], out: Path) -> list[dict]:
    import cv2
    import numpy as np
    from rembg import new_session, remove

    width, height = image.size
    session = new_session('u2net')
    mask = Image.new('L', image.size, 0)
    draw = ImageDraw.Draw(mask)
    layers = []
    for index, box in enumerate(scale_box(image, images)):
        crop = image.crop((box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height']))
        cut = remove(crop, session=session).convert('RGBA')
        clear_text(cut, box, texts)
        path = out / f'image-{index}.png'
        cut.save(path)
        alpha = cut.getchannel('A').point(lambda value: 255 if value > 24 else 0)
        mask.paste(alpha, (box['x'], box['y']))
        layers.append({**box, 'kind': 'image', 'path': str(path), 'z': index + 1})
    for text in texts:
        box = clamp_box(text, width, height)
        if box['width'] < 2 or box['height'] < 2 or not text['text']:
            continue
        draw.rectangle((box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height']), fill=255)
        layers.append(
            {
                'name': text['text'][:40],
                'kind': 'text',
                'x': box['x'],
                'y': box['y'],
                'width': box['width'],
                'height': box['height'],
                'z': len(layers) + 1,
                'text': text['text'][:200],
                'fontSize': max(8, round(box['height'] * 0.8)),
                'fontFamily': 'Inter',
                'color': text_color(image, box),
            }
        )
    mask = mask.filter(ImageFilter.MaxFilter(7))
    filled = inpaint(image, mask, cv2, np)
    background = out / 'background.png'
    filled.save(background)
    return [
        {'name': '背景', 'kind': 'image', 'x': 0, 'y': 0, 'width': width, 'height': height, 'z': 0, 'path': str(background)},
        *layers,
    ]


def scale_box(image: Image.Image, boxes: list[dict]) -> list[dict]:
    return [clamp_box(box, image.width, image.height) for box in boxes]


def clamp_box(box: dict, width: int, height: int) -> dict:
    x = min(width - 1, max(0, round(box['x'])))
    y = min(height - 1, max(0, round(box['y'])))
    return {
        **box,
        'x': x,
        'y': y,
        'width': max(1, min(width - x, round(box['width']))),
        'height': max(1, min(height - y, round(box['height']))),
    }


def clear_text(sprite: Image.Image, box: dict, texts: list[dict]) -> None:
    draw = ImageDraw.Draw(sprite)
    for text in texts:
        left = max(box['x'], text['x'])
        top = max(box['y'], text['y'])
        right = min(box['x'] + box['width'], text['x'] + text['width'])
        bottom = min(box['y'] + box['height'], text['y'] + text['height'])
        if right - left < 2 or bottom - top < 2:
            continue
        local = (left - box['x'], top - box['y'], right - box['x'], bottom - box['y'])
        ring = sprite.crop((max(0, local[0] - 3), max(0, local[1] - 3), min(sprite.width, local[2] + 3), min(sprite.height, local[3] + 3)))
        stat = ImageStat.Stat(ring.convert('RGB'))
        color = tuple(round(channel) for channel in stat.median)
        draw.rectangle(local, fill=(*color, 255))


def text_color(image: Image.Image, box: dict) -> str:
    crop = image.crop((box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height'])).convert('RGB')
    stat = ImageStat.Stat(crop)
    median = stat.median
    chosen = median
    farthest = 0
    for pixel in crop.getdata():
        distance = sum(abs(pixel[channel] - median[channel]) for channel in range(3))
        if distance > farthest:
            farthest = distance
            chosen = pixel
    if farthest < 24:
        chosen = (255, 255, 255)
    return '#' + ''.join(f'{int(channel):02x}' for channel in chosen)


def inpaint(image: Image.Image, mask: Image.Image, cv2, np) -> Image.Image:
    source = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    holes = np.array(mask)
    filled = cv2.inpaint(source, holes, 4, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(filled, cv2.COLOR_BGR2RGB))


def overlap(a: dict, b: dict) -> float:
    area = a['width'] * a['height']
    if area <= 0:
        return 0
    return intersection(a, b) / area


def contains(outer: dict, inner: dict) -> float:
    area = inner['width'] * inner['height']
    if area <= 0:
        return 0
    return intersection(outer, inner) / area


def intersection(a: dict, b: dict) -> float:
    left = max(a['x'], b['x'])
    top = max(a['y'], b['y'])
    right = min(a['x'] + a['width'], b['x'] + b['width'])
    bottom = min(a['y'] + a['height'], b['y'] + b['height'])
    if right <= left or bottom <= top:
        return 0
    return (right - left) * (bottom - top)


def scale_up(box: dict, scale: float) -> dict:
    if scale == 1:
        return box
    return {
        **box,
        'x': box['x'] / scale,
        'y': box['y'] / scale,
        'width': box['width'] / scale,
        'height': box['height'] / scale,
    }


def ocr_box(item: dict) -> dict | None:
    text = str(item.get('text') or '').strip()
    if not text:
        return None
    return {
        'name': text[:40],
        'kind': 'text',
        'x': number(item.get('x')),
        'y': number(item.get('y')),
        'width': number(item.get('width')),
        'height': number(item.get('height')),
        'text': text,
    }


def number(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        raise SystemExit(1)
