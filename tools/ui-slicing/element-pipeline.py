import functools
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
LAMA_MODEL = Path.home() / '.cache/ui-slice-studio/lama_fp32.onnx'
LAMA_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
LAMA_SIZE = 512
SALIENCY_MODEL = Path.home() / '.u2net/u2net.onnx'
SALIENCY_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx'


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
    import cv2
    import numpy as np

    width, height = image.size
    original = np.asarray(image, dtype=np.float32)
    generated = []
    for item in qwen:
        with Image.open(item['path']) as layer:
            generated.append(np.asarray(layer.convert('RGBA'), dtype=np.float32))
    alphas = [refine_alpha(layer[:, :, 3] / 255, original) for layer in generated[1:]]
    boxes = [clamp_box(item, width, height) for item in detected if item.get('kind') != 'text']
    original, strokes = erase_lettering(original, texts, boxes)
    settled = [
        settle_alpha(alpha, layer[:, :, 3] / 255, strokes, texts) for alpha, layer in zip(alphas, generated[1:])
    ]
    visible = [alpha for alpha in alphas]
    alphas = [alpha for alpha, _, _ in settled]
    erased = cv2.dilate(strokes, np.ones((5, 5), np.uint8), iterations=2) > 0
    covered = 1 - np.prod([1 - alpha for alpha in alphas], axis=0) if alphas else np.zeros((height, width))
    background = restore_background(original, generated[0][:, :, :3], covered).astype(np.float32)
    exposed = [box for box in boxes if covered[box['y'] : box['y'] + box['height'], box['x'] : box['x'] + box['width']].mean() < 0.3]
    whole = np.ones((height, width), bool)
    frame = {'x': 0, 'y': 0, 'width': width, 'height': height}
    sprites = carve_objects(background, np.ones((height, width)), covered, whole, frame, exposed)
    background_path = out / 'background.png'
    Image.fromarray(np.clip(background, 0, 255).astype(np.uint8)).save(background_path)
    layers = [{**qwen[0], 'path': str(background_path)}]
    beneath = generated[0][:, :, :3].copy()
    for index, alpha in enumerate(alphas):
        layer = generated[index + 1]
        above = 1 - np.prod([1 - upper for upper in alphas[index + 1 :]], axis=0) if index + 1 < len(alphas) else np.zeros_like(alpha)
        shaped = cv2.GaussianBlur(settled[index][1].astype(np.float32), (5, 5), 0)
        colors = source_colors(original, alpha, beneath, layer[:, :, :3], np.maximum(above, shaped))
        for circle in settled[index][2]:
            colors = ring_fill(colors, circle, erased | (visible[index] < 0.5))
        sprites.extend(split_alpha(colors, alpha, above, boxes))
        raw = layer[:, :, 3:4] / 255
        beneath = beneath * (1 - raw) + layer[:, :, :3] * raw
    sprites.sort(key=lambda item: item['width'] * item['height'], reverse=True)
    sprites = [sprite for sprite in drop_ghosts(sprites) if not mostly_text(sprite, texts)]
    for index, sprite in enumerate(sprites[:MAX_IMAGES]):
        box = {key: sprite[key] for key in ('x', 'y', 'width', 'height')}
        name = sprite_name(box, detected)
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


def refine_alpha(alpha, original):
    import cv2
    import numpy as np

    guide = cv2.cvtColor(original.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    radius = max(2, round(max(original.shape[:2]) / 1024 * 3))
    size = (2 * radius + 1, 2 * radius + 1)
    mean = lambda value: cv2.boxFilter(value, -1, size)
    guide_mean, alpha_mean = mean(guide), mean(alpha.astype(np.float32))
    covariance = mean(guide * alpha) - guide_mean * alpha_mean
    variance = mean(guide * guide) - guide_mean * guide_mean
    slope = covariance / (variance + 1e-3)
    refined = mean(slope) * guide + mean(alpha_mean - slope * guide_mean)
    refined = np.clip(refined, 0, 1)
    refined[refined < 0.03] = 0
    refined[refined > 0.97] = 1
    return refined


def erase_lettering(original, texts: list[dict], blockers: list[dict]):
    import cv2
    import numpy as np

    height, width = original.shape[:2]
    pixels = np.dstack([original, np.full((height, width), 255, np.float32)]).astype(np.uint8)
    strokes = np.zeros((height, width), np.uint8)
    for text in texts:
        fit_text_box(pixels, text, blockers)
        pad = max(2, round(text['height'] * 0.15))
        left, top = max(0, int(text['x'] - pad)), max(0, int(text['y'] - pad))
        right = min(width, int(text['x'] + text['width'] + pad))
        bottom = min(height, int(text['y'] + text['height'] + pad))
        if right - left < 2 or bottom - top < 2:
            continue
        strokes[top:bottom, left:right] |= glyph_mask(pixels, left, top, right, bottom)
    if not strokes.any():
        return original, strokes
    radius = max(1, round(max(height, width) / 1024))
    source = np.ascontiguousarray(original.astype(np.uint8))
    rough = cv2.dilate(strokes, np.ones((3, 3), np.uint8), iterations=radius * 3)
    base = cv2.inpaint(source, rough * 255, 3 + radius, cv2.INPAINT_TELEA).astype(np.float32)
    base = cv2.GaussianBlur(base, (0, 0), 2 * radius)
    near = cv2.dilate(strokes, np.ones((3, 3), np.uint8), iterations=radius * 4) > 0
    changed = np.sqrt(((original - base) ** 2).sum(axis=2)) > 24
    residue = np.zeros((height, width), bool)
    for text in texts:
        pad = max(2, round(text['height'] * 0.15))
        left, top = max(0, int(text['x'] - pad)), max(0, int(text['y'] - pad))
        right = min(width, int(text['x'] + text['width'] + pad))
        bottom = min(height, int(text['y'] + text['height'] + pad))
        residue[top:bottom, left:right] |= changed[top:bottom, left:right] & near[top:bottom, left:right]
    strokes = strokes | residue.astype(np.uint8)
    strokes = cv2.dilate(strokes, np.ones((3, 3), np.uint8), iterations=radius + 1)
    cleaned = cv2.inpaint(source, strokes * 255, 3 + radius, cv2.INPAINT_TELEA)
    try:
        cleaned = lama_fill(cleaned, strokes, texts)
    except Exception as error:
        print(f'LaMa unavailable, keeping classic fill: {error}', file=sys.stderr)
    return cleaned.astype(np.float32), strokes


def fit_text_box(pixels, text: dict, blockers: list[dict]) -> None:
    import numpy as np

    height, width = pixels.shape[:2]
    left, top = max(0, int(text['x'])), max(0, int(text['y']))
    right, bottom = min(width, int(text['x'] + text['width'])), min(height, int(text['y'] + text['height']))
    if right - left < 2 or bottom - top < 2:
        return
    glyph = glyph_mask(pixels, left, top, right, bottom) > 0
    if glyph.sum() < 8:
        return
    ink = np.median(pixels[top:bottom, left:right, :3][glyph], axis=0)
    inked = np.sqrt(((pixels[:, :, :3].astype(np.float32) - ink) ** 2).sum(axis=2)) < 40
    size = bottom - top
    gap = max(2, round(size * 0.35))

    def grow(edge: int, step: int, limit: int, hits) -> int:
        misses = 0
        probe = edge
        while misses < gap and 0 <= probe + step < limit and abs(probe + step - edge) < size:
            probe += step
            if hits(probe) >= 2:
                edge, misses = probe, 0
            else:
                misses += 1
        return edge

    center_x, center_y = (left + right) / 2, (top + bottom) / 2
    blocked = np.zeros(width, bool)
    for item in blockers:
        inside = item['x'] <= center_x <= item['x'] + item['width'] and item['y'] <= center_y <= item['y'] + item['height']
        if inside or item['y'] >= bottom or item['y'] + item['height'] <= top:
            continue
        blocked[max(0, int(item['x'])) : int(item['x'] + item['width']) + 1] = True

    def column(x: int) -> int:
        if blocked[x]:
            return 0
        count = int(inked[top:bottom, x].sum())
        return count if count < size * 0.8 else 0

    grown_left = left if blocked[left] else grow(left, -1, width, column)
    grown_right = right if blocked[right - 1] else grow(right - 1, 1, width, column) + 1
    text.update(x=grown_left, width=grown_right - grown_left)


@functools.cache
def model_session(path: Path, url: str):
    import onnxruntime

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix('.part')
        urllib.request.urlretrieve(url, partial)
        partial.rename(path)
    return onnxruntime.InferenceSession(str(path), providers=['CPUExecutionProvider'])


def saliency_session():
    return model_session(SALIENCY_MODEL, SALIENCY_URL)


def lama_patch(pixels, hole):
    import cv2
    import numpy as np

    session = model_session(LAMA_MODEL, LAMA_URL)
    height, width = hole.shape
    image = cv2.resize(pixels, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_AREA)
    mask = cv2.dilate(cv2.resize(hole, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_NEAREST), np.ones((3, 3), np.uint8))
    output = session.run(
        None,
        {'image': (image.astype(np.float32) / 255).transpose(2, 0, 1)[None], 'mask': mask.astype(np.float32)[None, None]},
    )[0][0].transpose(1, 2, 0)
    output = cv2.resize(np.clip(output, 0, 255), (width, height), interpolation=cv2.INTER_CUBIC)
    blend = cv2.GaussianBlur(cv2.dilate(hole, np.ones((3, 3), np.uint8)).astype(np.float32), (5, 5), 0)[:, :, None]
    return (pixels * (1 - blend) + output * blend).astype(np.uint8)


def lama_fill(image, strokes, texts: list[dict]):
    import numpy as np

    height, width = strokes.shape
    result = image.copy()
    pending = strokes.copy()
    for text in sorted(texts, key=lambda item: item['width'] * item['height'], reverse=True):
        box = pending[max(0, int(text['y'])) : int(text['y'] + text['height']), max(0, int(text['x'])) : int(text['x'] + text['width'])]
        if not box.any():
            continue
        side = min(max(text['width'], text['height']) * 1.4 + text['height'], width, height)
        side = int(max(side, 64))
        left = int(np.clip(text['x'] + text['width'] / 2 - side / 2, 0, width - side))
        top = int(np.clip(text['y'] + text['height'] / 2 - side / 2, 0, height - side))
        hole = strokes[top : top + side, left : left + side]
        margin = side // 8
        pending[top + margin : top + side - margin, left + margin : left + side - margin] = 0
        result[top : top + side, left : left + side] = lama_patch(result[top : top + side, left : left + side], hole)
    return result


def settle_alpha(alpha, raw, strokes, texts: list[dict]):
    import cv2
    import numpy as np

    shaped = np.zeros(alpha.shape, bool)
    rounds = []
    if not strokes.any():
        return alpha, shaped, rounds
    level = np.ascontiguousarray((alpha * 255).astype(np.uint8))
    guessed = cv2.inpaint(level, strokes * 255, 3, cv2.INPAINT_TELEA).astype(np.float32) / 255
    around = cv2.dilate(strokes, np.ones((5, 5), np.uint8), iterations=2) > 0
    cleared = cv2.inpaint(level, around.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA).astype(np.float32) / 255
    settled = alpha.copy()
    height, width = alpha.shape
    for text in texts:
        pad = max(2, round(text['height'] * 0.3))
        left, top = max(0, int(text['x'] - pad)), max(0, int(text['y'] - pad))
        right = min(width, int(text['x'] + text['width'] + pad))
        bottom = min(height, int(text['y'] + text['height'] + pad))
        stroke = strokes[top:bottom, left:right] > 0
        if not stroke.any():
            continue
        ring = ~around[top:bottom, left:right]
        inside = raw[top:bottom, left:right]
        glyphs = ring.any() and inside[stroke].mean() - inside[ring].mean() > 0.2
        region = settled[top:bottom, left:right]
        if glyphs:
            fringe = around[top:bottom, left:right]
            region[fringe] = np.minimum(region, cleared[top:bottom, left:right])[fringe]
            for ellipse in round_silhouette(alpha, strokes, (left, top, right, bottom)):
                canvas = np.zeros(alpha.shape, np.uint8)
                cv2.ellipse(canvas, ellipse, 255, -1, cv2.LINE_AA)
                shape = canvas[top:bottom, left:right].astype(np.float32) / 255
                (cx, cy), (diameter, _), _ = ellipse
                below = (np.arange(top, bottom)[:, None] > cy) & (np.abs(np.arange(left, right)[None, :] - cx) < diameter / 2)
                region[:] = np.where(below, shape, np.maximum(region, shape))
                rounds.append(ellipse)
            continue
        edge = stroke & (inside - guessed[top:bottom, left:right] > 0.2)
        size = max(3, round(text['height'] * 0.2)) | 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        closed = cv2.morphologyEx(np.ascontiguousarray(alpha[top:bottom, left:right]), cv2.MORPH_CLOSE, kernel)
        region[stroke] = np.minimum(guessed[top:bottom, left:right], np.maximum(closed, region))[stroke]
        region[edge] = inside[edge]
        shaped[top:bottom, left:right] |= edge
    return settled, shaped, rounds


def round_silhouette(alpha, strokes, box: tuple[int, int, int, int]):
    import cv2
    import numpy as np

    left, top, right, bottom = box
    hidden = cv2.dilate(strokes, np.ones((5, 5), np.uint8), iterations=2)
    solid = ((alpha > 0.5) & (hidden == 0)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    touching = np.unique(labels[max(0, top - 4) : bottom + 4, max(0, left - 4) : right + 4])
    circles = []
    for label in touching[touching > 0]:
        x, y, w, h, area = (int(value) for value in stats[label])
        if area < 200 or w > (right - left) * 4 or h > (bottom - top) * 6:
            continue
        contour = cv2.findContours((labels == label).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
        points = max(contour, key=len).reshape(-1, 2)
        points = points[hidden[points[:, 1], points[:, 0]] == 0]
        near = cv2.dilate(hidden, np.ones((3, 3), np.uint8), iterations=2)
        points = points[near[points[:, 1], points[:, 0]] == 0]
        if len(points) < 20:
            continue
        inliers = points.astype(np.float64)
        for _ in range(5):
            system = np.column_stack([inliers[:, 0], inliers[:, 1], np.ones(len(inliers))])
            target = (inliers**2).sum(axis=1)
            (a, b, c), *_ = np.linalg.lstsq(system, target, rcond=None)
            cx, cy = a / 2, b / 2
            radius = float(np.sqrt(max(c + cx**2 + cy**2, 0)))
            if radius < 8:
                break
            error = np.abs(np.hypot(points[:, 0] - cx, points[:, 1] - cy) / radius - 1)
            kept = points[error < 0.04].astype(np.float64)
            if len(kept) < 20:
                break
            inliers = kept
        if radius < 8 or len(inliers) < len(points) * 0.45 or np.median(error[error < 0.04]) > 0.015:
            continue
        if cy + radius < top or radius > max(w, h) or radius * 2 < (bottom - top) * 1.5:
            continue
        circles.append(((float(cx), float(cy)), (2 * radius, 2 * radius), 0.0))
    return circles


def ring_fill(colors, circle, hidden):
    import cv2
    import numpy as np

    (cx, cy), (diameter, _), _ = circle
    radius = diameter / 2
    height, width = hidden.shape
    size = (max(8, round(radius)), max(32, round(2 * np.pi * radius)))
    flags = cv2.WARP_POLAR_LINEAR | cv2.INTER_LINEAR
    polar = cv2.warpPolar(colors.astype(np.float32), size, (cx, cy), radius, flags)
    blocked = cv2.warpPolar(hidden.astype(np.float32), size, (cx, cy), radius, flags) > 0.1
    angles = np.arange(size[1])
    for column in range(int(size[0] * 0.6), size[0]):
        missing = blocked[:, column]
        if not missing.any() or missing.all():
            continue
        known = angles[~missing]
        for channel in range(3):
            values = polar[~missing, column, channel]
            polar[missing, column, channel] = np.interp(angles[missing], known, values, period=size[1])
    back = cv2.warpPolar(polar, (width, height), (cx, cy), radius, flags | cv2.WARP_INVERSE_MAP)
    left, top = max(0, int(cx - radius)), max(0, int(cy - radius))
    right, bottom = min(width, int(cx + radius) + 1), min(height, int(cy + radius) + 1)
    yy, xx = np.mgrid[top:bottom, left:right]
    distance = np.hypot(xx - cx, yy - cy)
    target = (hidden[top:bottom, left:right] > 0) & (distance > radius * 0.6) & (distance < radius)
    filled = colors.copy()
    filled[top:bottom, left:right][target] = back[top:bottom, left:right][target]
    return filled


def restore_background(original, generated, covered):
    import cv2
    import numpy as np

    hidden = cv2.dilate((covered > 0.05).astype(np.uint8), np.ones((5, 5), np.uint8))
    weight = cv2.GaussianBlur(hidden.astype(np.float32), (9, 9), 0)[:, :, None]
    return np.clip(original * (1 - weight) + generated * weight, 0, 255).astype(np.uint8)


def source_colors(original, alpha, beneath, generated, above):
    import numpy as np

    opacity = np.maximum(alpha, 0.05)[:, :, None]
    foreground = (original - (1 - alpha[:, :, None]) * beneath) / opacity
    foreground = np.where(alpha[:, :, None] > 0.9, original, foreground)
    visible = 1 - above[:, :, None]
    return np.clip(foreground * visible + generated * (1 - visible), 0, 255)


def split_alpha(colors, alpha, above, boxes: list[dict]) -> list[dict]:
    import cv2
    import numpy as np

    from scipy import ndimage

    core = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels = cv2.connectedComponents(core, connectivity=8)
    distance, (rows, columns) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    labels = np.where((alpha > 0.1) & (distance <= 12), labels[rows, columns], labels)
    _, extra = cv2.connectedComponents(((alpha > 0.1) & (labels == 0)).astype(np.uint8), connectivity=8)
    labels = np.where(extra > 0, extra + count, labels)
    objects = ndimage.find_objects(labels)
    alpha = alpha.copy()
    sprites = []
    for index, window in enumerate(objects, start=1):
        if window is None:
            continue
        top, bottom, left, right = window[0].start, window[0].stop, window[1].start, window[1].stop
        region = labels == index
        area = int(region[window].sum())
        if area < 300 or right - left < 8 or bottom - top < 8:
            continue
        visible = alpha[region & (alpha > 0.1)]
        if (visible > 0.8).mean() < 0.2 and np.median(visible) < 0.3:
            continue
        component = {'x': left, 'y': top, 'width': right - left, 'height': bottom - top}
        hidden = cv2.dilate(((above[window] > 0.1) & region[window]).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=4)
        hidden &= region[window].astype(np.uint8)
        solid = ndimage.binary_fill_holes((alpha[window] > 0.5) & region[window])
        alpha[window] = np.where((hidden > 0) & solid, 1, alpha[window])
        fill_base(colors, alpha, window, hidden, raise_only=True)
        sprites.extend(carve_objects(colors, alpha, above, region, component, boxes))
        for part in split_by_boxes(region, alpha, component, boxes):
            sprites.append(sprite_from(colors, alpha, part))
    return [sprite for sprite in sprites if sprite]


def drop_ghosts(sprites: list[dict]) -> list[dict]:
    import numpy as np

    def solid(sprite: dict) -> bool:
        level = np.asarray(sprite['image'])[:, :, 3] / 255
        return (level[level > 0.1] > 0.8).mean() >= 0.2

    def iou(a: dict, b: dict) -> float:
        shared = intersection(a, b)
        return shared / max(1, a['width'] * a['height'] + b['width'] * b['height'] - shared)

    def covers(outer: dict, inner: dict) -> bool:
        larger = outer['width'] * outer['height'] > inner['width'] * inner['height'] * 2
        return iou(outer, inner) >= 0.5 or (larger and contains(outer, inner) > 0.8)

    solids = [sprite for sprite in sprites if solid(sprite)]
    return [sprite for sprite in sprites if sprite in solids or not any(covers(other, sprite) for other in solids)]


def carve_objects(colors, alpha, above, region, component: dict, boxes: list[dict]) -> list:
    import cv2
    import numpy as np

    area = component['width'] * component['height']
    candidates = [
        box
        for box in boxes
        if contains(component, box) > 0.85
        and 400 < box['width'] * box['height'] < area * 0.6
        and not clean_cut(region, alpha, box)
    ]
    candidates.sort(key=lambda box: box['width'] * box['height'], reverse=True)
    carved, parts = [], []
    for box in candidates:
        if any(overlap(box, other) > 0.3 for other in carved):
            continue
        top, left = box['y'], box['x']
        window = (slice(top, top + box['height']), slice(left, left + box['width']))
        try:
            saliency = salient_mask(colors[window])
        except Exception as error:
            print(f'Saliency unavailable, skipping object carving: {error}', file=sys.stderr)
            return parts
        inside = region[window]
        solid = (saliency > 0.5) & inside
        coverage = solid.sum() / max(1, inside.sum())
        if not 0.08 < coverage < 0.85:
            continue
        count, labels, stats, _ = cv2.connectedComponentsWithStats(solid.astype(np.uint8), connectivity=8)
        largest = stats[1:, cv2.CC_STAT_AREA].max() if count > 1 else 0
        keep = np.isin(labels, [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] > largest * 0.05])
        keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        weight = np.clip((saliency - 0.3) / 0.4, 0, 1) * keep * inside
        piece = np.zeros_like(region)
        piece[window] = weight > 0.02
        if above[window][weight > 0.5].mean() < 0.5:
            piece_alpha = np.zeros_like(alpha)
            piece_alpha[window] = alpha[window] * weight
            parts.append(sprite_from(colors, piece_alpha, piece))
        hole = cv2.dilate((weight > 0.02).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=3) & inside.astype(np.uint8)
        fill_base(colors, alpha, window, hole)
        carved.append(box)
    return parts


def salient_mask(pixels):
    import cv2
    import numpy as np

    session = saliency_session()
    source = cv2.resize(np.clip(pixels, 0, 255).astype(np.float32) / 255, (320, 320), interpolation=cv2.INTER_AREA)
    tensor = ((source - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)).transpose(2, 0, 1)[None].astype(np.float32)
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
    output = (output - output.min()) / max(float(output.max() - output.min()), 1e-6)
    return cv2.resize(output, (pixels.shape[1], pixels.shape[0]), interpolation=cv2.INTER_LINEAR)


def fill_base(colors, alpha, window, hole, raise_only: bool = False) -> None:
    import cv2
    import numpy as np

    if not hole.any():
        return
    pixels = np.ascontiguousarray(np.clip(colors[window], 0, 255).astype(np.uint8))
    filled = cv2.inpaint(pixels, hole * 255, 5, cv2.INPAINT_TELEA)
    height, width = hole.shape
    count, _, stats, _ = cv2.connectedComponentsWithStats(hole, connectivity=8)
    try:
        for index in range(1, count):
            x, y, w, h, _ = (int(value) for value in stats[index])
            side = min(max(w, h) * 3 // 2 + 16, width, height)
            if side < max(w, h):
                side = max(w, h)
            left = int(np.clip(x + w / 2 - side / 2, 0, max(0, width - side)))
            top = int(np.clip(y + h / 2 - side / 2, 0, max(0, height - side)))
            crop = (slice(top, top + side), slice(left, left + side))
            filled[crop] = lama_patch(filled[crop], hole[crop])
    except Exception as error:
        print(f'LaMa unavailable, keeping classic base fill: {error}', file=sys.stderr)
    colors[window] = np.where(hole[:, :, None] > 0, filled, colors[window])
    level = np.ascontiguousarray((alpha[window] * 255).astype(np.uint8))
    guessed = cv2.inpaint(level, hole * 255, 5, cv2.INPAINT_TELEA) / 255
    if raise_only:
        guessed = np.maximum(guessed, alpha[window])
    alpha[window] = np.where(hole > 0, guessed, alpha[window])


def split_by_boxes(region, alpha, component: dict, boxes: list[dict]) -> list:
    import numpy as np

    area = component['width'] * component['height']
    inside = [
        box
        for box in boxes
        if contains(component, box) > 0.85 and box['width'] * box['height'] < area * 0.8 and box['width'] * box['height'] > 200
    ]
    inside.sort(key=lambda box: box['width'] * box['height'], reverse=True)
    chosen = []
    for box in inside:
        if any(intersection(box, other) > 0 for other in chosen):
            continue
        if not clean_cut(region, alpha, box):
            continue
        chosen.append(box)
    rest = region.copy()
    parts = []
    for box in chosen:
        part = np.zeros_like(region)
        window = (slice(box['y'], box['y'] + box['height']), slice(box['x'], box['x'] + box['width']))
        part[window] = region[window]
        rest[window] = False
        parts.append(part)
    if rest.sum() > 300:
        parts.append(rest)
    return parts


def clean_cut(region, alpha, box: dict) -> bool:
    import numpy as np

    top, left = box['y'], box['x']
    bottom, right = top + box['height'] - 1, left + box['width'] - 1
    border = np.concatenate(
        [
            (alpha * region)[top, left : right + 1],
            (alpha * region)[bottom, left : right + 1],
            (alpha * region)[top : bottom + 1, left],
            (alpha * region)[top : bottom + 1, right],
        ]
    )
    return border.mean() < 0.15


def sprite_from(colors, alpha, part):
    import numpy as np

    ys, xs = np.nonzero(part & (alpha > 0.02))
    if len(xs) < 150:
        return None
    left, top, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    window = (slice(top, bottom), slice(left, right))
    pixels = np.dstack([colors[window], np.where(part[window], alpha[window], 0) * 255]).round().astype(np.uint8)
    return {'x': int(left), 'y': int(top), 'width': int(right - left), 'height': int(bottom - top), 'image': Image.fromarray(pixels, 'RGBA')}


def sprite_name(box: dict, detected: list[dict]) -> str:
    named = [item for item in detected if item.get('kind') != 'text' and item.get('name') and overlap(box, item) > 0.3]
    if not named:
        return '控件'
    union = lambda item: box['width'] * box['height'] + item['width'] * item['height'] - intersection(box, item)
    named.sort(key=lambda item: intersection(box, item) / max(1, union(item)), reverse=True)
    return str(named[0]['name'])[:40]


def mostly_text(sprite: dict, texts: list[dict]) -> bool:
    area = sprite['width'] * sprite['height']
    covered = sum(intersection(sprite, text) for text in texts)
    return area > 0 and covered / area > 0.6


def glyph_mask(pixels, left: int, top: int, right: int, bottom: int):
    import numpy as np

    region = pixels[top:bottom, left:right].astype(np.int32)
    ring = np.concatenate(
        [
            pixels[max(0, top - 3) : top, left:right].reshape(-1, 4),
            pixels[bottom : bottom + 3, left:right].reshape(-1, 4),
            pixels[top:bottom, max(0, left - 3) : left].reshape(-1, 4),
            pixels[top:bottom, right : right + 3].reshape(-1, 4),
        ]
    ).astype(np.int32)
    opaque = ring[ring[:, 3] > 200]
    visible = region[:, :, 3] > 24
    if len(opaque) < 8:
        return visible.astype(np.uint8)
    underlay = np.median(opaque[:, :3], axis=0)
    distance = np.sqrt(((region[:, :, :3] - underlay) ** 2).sum(axis=2))
    return (visible & (distance > 48)).astype(np.uint8)


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
    graphics = [item for item in detected if item['kind'] != 'text']
    for item in recognized:
        if not item['text'] or any(overlap(item, existing) > 0.2 for existing in texts):
            continue
        if len(item['text'].strip()) <= 1 and any(overlap(item, graphic) > 0.6 for graphic in graphics):
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
