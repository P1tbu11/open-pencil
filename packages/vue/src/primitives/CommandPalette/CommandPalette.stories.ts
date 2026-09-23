import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import { defineComponent, ref } from 'vue'

import CommandPaletteRoot from './CommandPaletteRoot.vue'
import type { CommandPaletteGroup } from './types'

const labels = {
  searchPlaceholder: 'Search commands…',
  searchLabel: 'Search commands',
  paletteLabel: 'Command palette',
  empty: 'No commands found.',
  back: 'Back'
}
const groups: CommandPaletteGroup[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { id: 'new', label: 'New document', shortcut: { keys: ['⌘', 'N'] } },
      { id: 'settings', label: 'Settings', shortcut: { keys: ['⌘', ','] } },
      {
        id: 'export',
        label: 'Export selection',
        children: [
          { id: 'export-png', label: 'Export selection as PNG' },
          { id: 'export-svg', label: 'Export selection as SVG' }
        ]
      }
    ]
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [{ id: 'undo', label: 'Undo', shortcut: { keys: ['⌘', 'Z'] } }]
  }
]

/** Headless searchable command list with nested groups. */
const CommandPaletteStates = defineComponent({
  name: 'CommandPaletteStates',
  components: { CommandPaletteRoot },
  setup() {
    const selectedLabels = ref<string[]>([])

    return {
      selected: ref(''),
      selectedLabels,
      groups,
      labels,
      ui: {
        root: 'w-[min(40rem,100%)] overflow-hidden rounded-xl border border-border bg-panel text-surface shadow-xl',
        search: 'h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none',
        content: 'max-h-96 overflow-y-auto p-2',
        label: 'px-2 py-1 text-[11px] text-muted',
        item: 'flex h-8 cursor-pointer items-center gap-2 rounded-md p-1 text-[13px] data-[highlighted]:bg-hover',
        itemIcon: 'flex size-6 shrink-0 items-center justify-center text-muted',
        itemLabel: 'min-w-0 flex-1 truncate',
        shortcut: 'flex items-center gap-1 text-xs text-muted',
        key: 'rounded border border-border bg-input px-1.5 py-1 font-mono leading-none'
      }
    }
  },
  template: `
    <div class="space-y-2">
      <CommandPaletteRoot
        v-model="selected"
        :groups="groups"
        :labels="labels"
        :ui="ui"
        @select="selectedLabels.push($event.label)"
      />
      <div v-if="selectedLabels.length" role="status" aria-label="Last selection">
        {{ selectedLabels.at(-1) }}
      </div>
    </div>
  `
})

const meta = {
  title: 'Vue SDK/Primitives/Command Palette',
  component: CommandPaletteStates,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Headless searchable command list built on Reka UI Listbox primitives.'
      }
    }
  }
} satisfies Meta<typeof CommandPaletteStates>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('searchbox', { name: 'Search commands' })

    await userEvent.click(input)
    await userEvent.type(input, 'setting')
    await expect(canvas.getByRole('option', { name: /Settings/ })).toBeVisible()
    await expect(canvas.queryByRole('option', { name: 'Undo' })).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('option', { name: /Settings/ }))
    await expect(canvas.getByRole('status', { name: 'Last selection' })).toHaveTextContent(
      'Settings'
    )

    await userEvent.clear(input)
    await userEvent.click(canvas.getByRole('option', { name: 'Export selection' }))
    await expect(canvas.getByText('Export selection as PNG')).toBeVisible()
    await userEvent.click(input)
    await userEvent.keyboard('{Backspace}')
    await expect(canvas.getByRole('option', { name: 'Export selection' })).toBeVisible()
  }
}
