import { strToU8, zipSync, type Zippable } from 'fflate'

import { unityImporter, cocos2Importer, cocos3Importer } from './engine-templates'
import { parseResult } from './schema'
import type { SliceResult } from './types'

export type EngineTarget = 'assets' | 'godot' | 'unity' | 'cocos3' | 'cocos2'

export function exportEngine(input: SliceResult, target: EngineTarget): Uint8Array {
  const result = parseResult(input)
  const files: Zippable = {}
  const layers = [...result.layers]
    .sort((a, b) => a.z - b.z)
    .map(({ bytes, ...layer }, i) => {
      const asset = `assets/layer-${i}.png`
      if (bytes) files[asset] = bytes
      return { ...layer, ...(bytes ? { asset } : {}) }
    })
  files['manifest.json'] = strToU8(JSON.stringify({ ...result, layers }, null, 2))
  if (target === 'godot') {
    const resources = layers.flatMap((layer, i) =>
      layer.asset
        ? [`[ext_resource type="Texture2D" path="res://${layer.asset}" id="tex${i}"]`]
        : []
    )
    const nodes = layers.map((layer, i) => {
      const color = layer.color ?? '#ffffff'
      const rgb = [1, 3, 5].map((p) => Number.parseInt(color.slice(p, p + 2), 16) / 255)
      const lines = [
        `[node name="Layer_${i}" type="${layer.kind === 'text' ? 'Label' : 'TextureRect'}" parent="."]`,
        `offset_left = ${layer.x}`,
        `offset_top = ${layer.y}`,
        `offset_right = ${layer.x + layer.width}`,
        `offset_bottom = ${layer.y + layer.height}`,
        'mouse_filter = 2',
        `metadata/layer_name = ${JSON.stringify(layer.name)}`
      ]
      if (layer.kind === 'text')
        lines.push(
          `text = ${JSON.stringify(layer.text)}`,
          `theme_override_font_sizes/font_size = ${Math.round(layer.fontSize ?? 24)}`,
          `theme_override_colors/font_color = Color(${rgb.join(', ')}, 1)`,
          'clip_text = true'
        )
      else lines.push(`texture = ExtResource("tex${i}")`, 'expand_mode = 1', 'stretch_mode = 0')
      return lines.join('\n')
    })
    files['ui.tscn'] = strToU8(
      [
        `[gd_scene load_steps=${resources.length + 1} format=3]`,
        ...resources,
        `[node name="UI" type="Control"]\nlayout_mode = 3\noffset_right = ${result.width}\noffset_bottom = ${result.height}`,
        ...nodes
      ].join('\n\n')
    )
    files['project.godot'] = strToU8(
      [
        'config_version=5',
        '[application]',
        'config/name="UI Slice"',
        'run/main_scene="res://ui.tscn"',
        '[display]',
        `window/size/viewport_width=${Math.round(result.width)}`,
        `window/size/viewport_height=${Math.round(result.height)}`,
        '[rendering]',
        'renderer/rendering_method="gl_compatibility"'
      ].join('\n')
    )
  }
  files['README.txt'] = strToU8(
    target === 'godot'
      ? 'Godot 4：导入 project.godot，打开 ui.tscn。图层是原生 TextureRect 和 Label。字体使用引擎默认字体，可在编辑器替换。已保留坐标、尺寸与层序；不包含交互逻辑。'
      : '素材包：manifest.json 使用左上角像素坐标，z 越大越靠前。图片在 assets；文字保留内容、字体名称、字号、颜色。字体文件需自行提供。'
  )
  if (target === 'unity') {
    files['Editor/UiSliceImporter.cs'] = strToU8(unityImporter)
    files['README.txt'] = strToU8(
      'Unity uGUI 导入适配（待 Unity 实机验收）：将整个目录放入项目 Assets 下的独立子目录，等待编译后打开 Tools > UI Slice > Import manifest，选择 manifest.json。生成可编辑 Canvas、Image、Text 和 UI.prefab。需安装 Unity UI 包；自定义字体请在导入后替换。'
    )
  }
  if (target === 'cocos2' || target === 'cocos3') {
    const prefix = 'assets/resources/ui-slice/'
    const packaged: Zippable = {}
    for (const [path, value] of Object.entries(files))
      if (path !== 'README.txt') packaged[prefix + path] = value
    packaged['assets/scripts/UiSliceImporter.ts'] = strToU8(
      target === 'cocos3' ? cocos3Importer : cocos2Importer
    )
    packaged['README.txt'] = strToU8(
      `Cocos Creator ${target === 'cocos3' ? '3.8' : '2.4'} 导入适配（待目标引擎实机验收）：把 assets 内容复制到空项目中。将 UiSliceImporter 组件挂到 Canvas 子节点，勾选 Build UI layers，等待图片加载后保存场景或拖为 Prefab。生成节点后可移除导入组件。PNG 需设为 Sprite Frame 类型；resources/ui-slice 目录请保留。使用默认字体，可自行替换。重复生成会新增一组节点。`
    )
    return zipSync(packaged)
  }
  return zipSync(files)
}
