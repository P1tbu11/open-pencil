import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { TreeItem, TreeRoot, TreeVirtualizer } from 'reka-ui'
import { expect, within } from 'storybook/test'
import { defineComponent, reactive, ref } from 'vue'

import { useInlineRename } from '@open-pencil/vue'
import type { LayerNode } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'

import { LAYER_TREE_ROW_HEIGHT } from './geometry'
import LayerTreeNodeRow from './LayerTreeNodeRow.vue'
import LayerTreeRenameRow from './LayerTreeRenameRow.vue'
import type { LayerRenameControls, LayerTreeChrome, LayerTreeItemActions } from './types'
import { provideLayerTreeUI } from './ui'

function noop() {
  return undefined
}

const LayerTreeStateMatrix = defineComponent({
  name: 'LayerTreeStateMatrix',
  props: {
    adjacent: { type: Boolean, default: false }
  },
  setup(props) {
    provideLayerTreeUI(() => undefined)

    const actions: LayerTreeItemActions = {
      select: noop,
      toggleExpand: noop,
      toggleVisibility: noop,
      toggleLock: noop,
      rename: noop
    }
    const renameControls: LayerRenameControls = {
      commit: noop,
      onKeydown: noop,
      focusInput: async (input) => {
        input.focus()
      }
    }

    function node(id: string, overrides: Partial<LayerNode> = {}): LayerNode {
      return {
        id,
        name: id,
        type: 'RECTANGLE',
        layoutMode: 'NONE',
        visible: true,
        locked: false,
        ...overrides
      }
    }

    function chrome(overrides: Partial<LayerTreeChrome> = {}): LayerTreeChrome {
      return {
        draggingId: null,
        instruction: null,
        instructionTargetId: null,
        focused: false,
        indent: 16,
        ...overrides
      }
    }

    const states = [
      { label: 'Normal', node: node('Normal'), selected: false, chrome: chrome() },
      {
        label: 'Selected focused',
        node: node('Selected focused'),
        selected: true,
        chrome: chrome({ focused: true })
      },
      { label: 'Hover neighbor', node: node('Hover neighbor'), selected: false, chrome: chrome() },
      {
        label: 'Selected unfocused',
        node: node('Selected unfocused'),
        selected: true,
        chrome: chrome()
      },
      {
        label: 'Hidden',
        node: node('Hidden', { visible: false }),
        selected: false,
        chrome: chrome()
      },
      {
        label: 'Locked',
        node: node('Locked', { locked: true }),
        selected: false,
        chrome: chrome()
      },
      {
        label: 'Component',
        node: node('Component', { type: 'COMPONENT' }),
        selected: false,
        chrome: chrome()
      },
      {
        label: 'Dragging',
        node: node('Dragging'),
        selected: false,
        chrome: chrome({ draggingId: 'Dragging' })
      },
      {
        label: 'Child drop',
        node: node('Child drop'),
        selected: false,
        chrome: chrome({
          instruction: { type: 'make-child' },
          instructionTargetId: 'Child drop'
        })
      },
      {
        label: 'Drop above',
        node: node('Drop above'),
        selected: false,
        chrome: chrome({
          instruction: { type: 'reorder-above' },
          instructionTargetId: 'Drop above'
        })
      },
      {
        label: 'Drop below',
        node: node('Drop below'),
        selected: false,
        chrome: chrome({
          instruction: { type: 'reorder-below' },
          instructionTargetId: 'Drop below'
        })
      }
    ]

    return {
      adjacent: () => props.adjacent,
      actions,
      chrome,
      node,
      renameControls,
      states
    }
  },
  template: `
    <div class="w-72 rounded-lg border border-border bg-panel p-2 shadow-lg">
      <div class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
        Layer Tree states
      </div>
      <div :class="adjacent() ? 'space-y-0' : 'space-y-1'">
        <div v-for="state in states" :key="state.label" :aria-label="state.label">
          <LayerTreeNodeRow
            :node="state.node"
            :level="1"
            has-children
            :selected="state.selected"
            pad-left="8px"
            :expanded="state.label === 'Normal'"
            :actions="actions"
            :chrome="state.chrome"
          />
        </div>
        <div aria-label="Rename">
          <LayerTreeRenameRow
            :node="node('Rename')"
            :has-children="false"
            pad-left="8px"
            :expanded="false"
            :actions="actions"
            :rename-controls="renameControls"
          />
        </div>
      </div>
    </div>
  `,
  components: { LayerTreeNodeRow, LayerTreeRenameRow }
})

const LayerTreeVirtualized = defineComponent({
  name: 'LayerTreeVirtualized',
  components: {
    AppButton,
    LayerTreeNodeRow,
    LayerTreeRenameRow,
    TreeItem,
    TreeRoot,
    TreeVirtualizer
  },
  setup() {
    interface DemoNode extends LayerNode {
      children?: DemoNode[]
    }

    const items = reactive<DemoNode[]>(
      Array.from({ length: 100 }, (_, index) => ({
        id: `node-${index}`,
        name: `Layer ${index + 1}`,
        type: 'FRAME',
        layoutMode: 'NONE',
        visible: true,
        locked: false,
        children: [
          {
            id: `child-${index}`,
            name: `Child ${index + 1}`,
            type: 'RECTANGLE',
            layoutMode: 'NONE',
            visible: true,
            locked: false
          }
        ]
      }))
    )
    function resolveNode(id: unknown): DemoNode {
      const node = items
        .flatMap((item) => [item, ...(item.children ?? [])])
        .find((item) => item.id === id)
      if (!node) throw new Error('Unknown tree node')
      return node
    }

    const selected = ref<DemoNode[]>(items.slice(0, 1))
    const focused = ref(true)
    const rename = useInlineRename((id, name) => {
      resolveNode(id).name = name
    })
    const renameControls = {
      commit: rename.commit,
      onKeydown: rename.onKeydown,
      focusInput: rename.focusInput
    }
    function focusOut(event: FocusEvent) {
      if (
        event.currentTarget instanceof Node &&
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      )
        return
      focused.value = false
    }

    provideLayerTreeUI(() => undefined)

    return {
      focused,
      focusOut,
      items,
      LAYER_TREE_ROW_HEIGHT,
      rename,
      renameControls,
      resolveNode,
      selected
    }
  },
  template: `
    <TreeRoot
      v-model="selected"
      :items="items"
      :get-key="(item) => item.id"
      multiple
      class="h-80 w-72 overflow-y-auto bg-panel"
      aria-label="Layers"
      @focusin="focused = true"
      @focusout="focusOut"
    >
      <TreeVirtualizer
        v-slot="{ item }"
        :estimate-size="LAYER_TREE_ROW_HEIGHT"
        :text-content="(node) => node.name"
      >
        <TreeItem
          as-child
          v-bind="item.bind"
          v-slot="{ isSelected, isExpanded, handleToggle }"
          @toggle="
            (event) => {
              if (event.detail.originalEvent.type === 'click') event.preventDefault()
            }
          "
        >
          <LayerTreeRenameRow
            v-if="rename.editingId.value === item.value.id"
            :node="resolveNode(item.value.id)"
            :has-children="item.hasChildren"
            :pad-left="(item.level - 1) * 16 + 'px'"
            :expanded="isExpanded"
            :actions="{
              select: () => {},
              toggleExpand: handleToggle,
              toggleLock: () => {},
              toggleVisibility: () => {},
              rename: () => {}
            }"
            :rename-controls="renameControls"
          />
          <LayerTreeNodeRow
            v-else
            @rename-start="rename.start"
            :node="resolveNode(item.value.id)"
            :level="item.level"
            :has-children="item.hasChildren"
            :selected="isSelected"
            :expanded="isExpanded"
            :pad-left="(item.level - 1) * 16 + 'px'"
            :chrome="{
              focused,
              draggingId: null,
              instruction: null,
              instructionTargetId: null,
              indent: 16
            }"
            :actions="{
              select: () => {},
              toggleExpand: handleToggle,
              toggleLock: () => {
                item.value.locked = !item.value.locked
              },
              toggleVisibility: () => {
                item.value.visible = !item.value.visible
              },
              rename: () => {}
            }"
          />
        </TreeItem>
      </TreeVirtualizer>
    </TreeRoot>
    <AppButton class="mt-3">Outside tree</AppButton>
  `
})

const meta = {
  title: 'Editor/Layer Tree',
  component: LayerTreeStateMatrix,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Layer Tree theme states for selection focus, visibility, locking, dragging, drop instructions, and rename.'
      }
    }
  }
} satisfies Meta<{ adjacent?: boolean }>

export default meta
type Story = StoryObj<{ adjacent?: boolean }>

export const Virtualized: Story = {
  render: () => ({
    components: { LayerTreeVirtualized },
    template: '<LayerTreeVirtualized />'
  })
}

export const AdjacentRows: Story = { args: { adjacent: true } }

export const StateMatrix: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Selected focused').firstElementChild).toHaveAttribute(
      'data-focused'
    )
    await expect(canvas.getByLabelText('Selected unfocused').firstElementChild).toHaveAttribute(
      'data-selected'
    )
    await expect(canvas.getByLabelText('Hidden').firstElementChild).toHaveAttribute('data-hidden')
    await expect(canvas.getByLabelText('Dragging').firstElementChild).toHaveAttribute(
      'data-dragging'
    )
    await expect(canvas.getByLabelText('Child drop').firstElementChild).toHaveAttribute(
      'data-drop-position',
      'child'
    )
  }
}
