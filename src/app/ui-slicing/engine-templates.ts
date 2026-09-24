import dedent from 'dedent'

export const unityImporter = dedent`
  // Copy this export folder under Assets, then use Tools > UI Slice > Import.
  using System;
  using System.IO;
  using UnityEditor;
  using UnityEngine;
  using UnityEngine.UI;

  public static class UiSliceImporter {
    [Serializable] class Layer {
      public string name, kind, text, color, asset;
      public float x, y, width, height, fontSize;
    }
    [Serializable] class Document {
      public string name;
      public float width, height;
      public Layer[] layers;
    }
    [MenuItem("Tools/UI Slice/Import manifest")]
    static void Import() {
      var path = EditorUtility.OpenFilePanel("UI Slice manifest", Application.dataPath, "json");
      if (string.IsNullOrEmpty(path)) return;
      var folder = FileUtil.GetProjectRelativePath(Path.GetDirectoryName(path));
      if (string.IsNullOrEmpty(folder) || !folder.StartsWith("Assets/")) {
        EditorUtility.DisplayDialog("UI Slice", "Copy the export folder inside Assets first.", "OK");
        return;
      }
      var doc = JsonUtility.FromJson<Document>(File.ReadAllText(path));
      var root = new GameObject(doc.name, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
      try {
        root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
        var scale = root.GetComponent<CanvasScaler>();
        scale.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scale.referenceResolution = new Vector2(doc.width, doc.height);
        foreach (var l in doc.layers) {
          var go = new GameObject(l.name, typeof(RectTransform));
          go.transform.SetParent(root.transform, false);
          var rect = go.GetComponent<RectTransform>();
          rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(0, 1);
          rect.anchoredPosition = new Vector2(l.x, -l.y);
          rect.sizeDelta = new Vector2(l.width, l.height);
          if (l.kind == "text") {
            var text = go.AddComponent<Text>();
            text.text = l.text;
            text.fontSize = Mathf.RoundToInt(l.fontSize);
            text.alignment = TextAnchor.UpperLeft;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
  #if UNITY_2022_2_OR_NEWER
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
  #else
            text.font = Resources.GetBuiltinResource<Font>("Arial.ttf");
  #endif
            Color colour;
            if (ColorUtility.TryParseHtmlString(l.color, out colour)) text.color = colour;
            text.raycastTarget = false;
          } else {
            var asset = folder + "/" + l.asset;
            var importer = AssetImporter.GetAtPath(asset) as TextureImporter;
            if (importer == null) throw new Exception("Image is missing: " + asset);
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.alphaIsTransparency = true;
            importer.SaveAndReimport();
            var image = go.AddComponent<Image>();
            image.sprite = AssetDatabase.LoadAssetAtPath<Sprite>(asset);
            image.raycastTarget = false;
          }
        }
        var prefab = AssetDatabase.GenerateUniqueAssetPath(folder + "/UI.prefab");
        PrefabUtility.SaveAsPrefabAsset(root, prefab);
        Selection.activeGameObject = root;
        Undo.RegisterCreatedObjectUndo(root, "Import UI slices");
      } catch {
        UnityEngine.Object.DestroyImmediate(root);
        throw;
      }
    }
  }
`

export const cocos3Importer = dedent`
  import { _decorator, Component, Node, UITransform, Label, Sprite, SpriteFrame, JsonAsset, resources, Color, Layers } from 'cc';
  const { ccclass, property, executeInEditMode } = _decorator;
  interface Layer { name: string; kind: string; x: number; y: number; width: number; height: number; asset?: string; text?: string; fontSize?: number; color?: string }
  interface Document { width: number; height: number; layers: Layer[] }
  @ccclass('UiSliceImporter')
  @executeInEditMode
  export class UiSliceImporter extends Component {
    @property({ displayName: 'Build UI layers' })
    get build() { return false; }
    set build(value: boolean) { if (value) this.buildLayers(); }
    private building = false;
    private buildLayers() {
      if (this.building) return;
      this.building = true;
      resources.load('ui-slice/manifest', JsonAsset, (error, asset) => {
        if (error) { console.error(error); this.building = false; return; }
        const doc = asset.json as Document;
        const root = new Node('UI Slices'); root.layer = Layers.Enum.UI_2D;
        root.parent = this.node; root.addComponent(UITransform).setContentSize(doc.width, doc.height);
        for (const layer of doc.layers) {
          const node = new Node(layer.name); node.layer = Layers.Enum.UI_2D; node.parent = root;
          const transform = node.addComponent(UITransform); transform.setContentSize(layer.width, layer.height);
          node.setPosition(layer.x + layer.width / 2 - doc.width / 2, doc.height / 2 - layer.y - layer.height / 2);
          if (layer.kind === 'text') {
            const label = node.addComponent(Label); label.string = layer.text || '';
            label.fontSize = layer.fontSize || 24; label.lineHeight = label.fontSize;
            label.horizontalAlign = Label.HorizontalAlign.LEFT; label.verticalAlign = Label.VerticalAlign.TOP;
            label.overflow = Label.Overflow.CLAMP; label.color = new Color(layer.color || '#ffffff');
          } else {
            const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('ui-slice/' + (layer.asset || '').replace(/\\.png$/, '') + '/spriteFrame', SpriteFrame, (err, frame) => {
              if (err) console.error(err); else if (sprite.isValid) sprite.spriteFrame = frame;
            });
          }
        }
        this.building = false;
      });
    }
  }
`

export const cocos2Importer = dedent`
  const { ccclass, property, executeInEditMode } = cc._decorator;
  @ccclass
  @executeInEditMode
  export default class UiSliceImporter extends cc.Component {
    @property({ displayName: 'Build UI layers' })
    get build(): boolean { return false; }
    set build(value: boolean) {
      if (!value) return;
      cc.resources.load('ui-slice/manifest', cc.JsonAsset, (error, asset: cc.JsonAsset) => {
        if (error) { cc.error(error); return; }
        const doc = asset.json;
        const root = new cc.Node('UI Slices'); root.parent = this.node; root.setContentSize(doc.width, doc.height);
        for (const layer of doc.layers) {
          const node = new cc.Node(layer.name); node.parent = root; node.setContentSize(layer.width, layer.height);
          node.setPosition(layer.x + layer.width / 2 - doc.width / 2, doc.height / 2 - layer.y - layer.height / 2);
          if (layer.kind === 'text') {
            const label = node.addComponent(cc.Label); label.string = layer.text || '';
            label.fontSize = layer.fontSize || 24; label.lineHeight = label.fontSize;
            label.horizontalAlign = cc.Label.HorizontalAlign.LEFT; label.verticalAlign = cc.Label.VerticalAlign.TOP;
            label.overflow = cc.Label.Overflow.CLAMP; node.color = new cc.Color().fromHEX(layer.color || '#ffffff');
          } else {
            const sprite = node.addComponent(cc.Sprite); sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            cc.resources.load('ui-slice/' + layer.asset.replace(/\\.png$/, ''), cc.SpriteFrame, (err, frame: cc.SpriteFrame) => {
              if (err) cc.error(err); else if (cc.isValid(sprite)) sprite.spriteFrame = frame;
            });
          }
        }
      });
    }
  }
`
