import json
import sys
from pathlib import Path

from gradio_client import Client, handle_file
from PIL import Image

TOKEN_FILE = Path.home() / '.config/ui-slice-studio/modelscope-token.txt'
ENDPOINT = 'https://studio-qwen-qwen-image-layered.api-inference.modelscope.net'
LAYER_NAMES = ('背景', '界面底板', '角色与控件', '前景')


def main() -> None:
    image_path = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    token = TOKEN_FILE.read_text().strip()
    if not token:
        raise SystemExit('ModelScope token file is empty')
    with Image.open(image_path) as source:
        width, height = source.size
    saved_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        client = Client(
            ENDPOINT,
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
        gallery = result[0]
        layers = []
        for index, item in enumerate(gallery):
            remote = item['image'] if isinstance(item, dict) else item
            with Image.open(remote) as layer:
                fitted = layer.convert('RGBA').resize((width, height), Image.Resampling.LANCZOS)
                path = out / f'layer-{index}.png'
                fitted.save(path)
            layers.append(
                {
                    'name': LAYER_NAMES[index] if index < len(LAYER_NAMES) else f'图层 {index + 1}',
                    'path': str(path),
                }
            )
    finally:
        sys.stdout = saved_stdout
    sys.stdout.write(json.dumps({'width': width, 'height': height, 'layers': layers}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        raise SystemExit(1)
