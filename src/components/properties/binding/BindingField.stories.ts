import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import { defineComponent, ref, type PropType } from 'vue'

import type { Variable } from '@open-pencil/scene-graph'
import type {
  BindingProvider,
  BindingState,
  BindingTarget,
  BoundEditPolicy
} from '@open-pencil/vue'
import {
  BindableValueRoot,
  NumberFieldInput,
  NumberFieldRoot,
  NumberFieldValue
} from '@open-pencil/vue'

import { BindingPill } from '@/components/ui/binding'

import VariableBindingPicker from './VariableBindingPicker.vue'

/** One binding-aware number field: quiet at rest, resolved value while editing. */
const BindingFieldItem = defineComponent({
  name: 'BindingFieldItem',
  components: {
    BindableValueRoot,
    BindingPill,
    NumberFieldInput,
    NumberFieldRoot,
    NumberFieldValue,
    VariableBindingPicker
  },
  props: {
    modelValue: { type: Number, required: true },
    provider: { type: Object as PropType<BindingProvider<number>>, required: true },
    targets: { type: Array as PropType<BindingTarget[]>, required: true },
    label: { type: String, required: true },
    policy: { type: String as PropType<BoundEditPolicy>, default: 'detach-on-edit' },
    disabled: { type: Boolean, default: false },
    derived: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  setup() {
    function tooltip(variableName: string, resolvedValue: unknown) {
      return typeof resolvedValue === 'number'
        ? `${variableName} · ${resolvedValue}px`
        : variableName
    }

    // Storybook compiles these templates at runtime, so pointer logic that needs
    // types lives in setup instead of a template expression.
    function onPointerDown(
      event: PointerEvent,
      editing: boolean,
      actions: { startScrub: (event: PointerEvent) => void }
    ) {
      if (editing) return
      const target = event.target
      if (target instanceof Element && target.closest('button')) return
      actions.startScrub(event)
    }

    return { onPointerDown, tooltip }
  },
  template: `
    <BindableValueRoot
      v-slot="binding"
      :provider="provider"
      :targets="targets"
      :value="modelValue"
      :policy="policy"
    >
      <NumberFieldRoot
        v-slot="{ attrs, editing, actions }"
        :model-value="modelValue"
        :aria-label="label"
        :disabled="disabled"
        @update:model-value="$emit('update:modelValue', $event)"
      >
        <div
          v-bind="{ ...attrs, ...binding.stateAttrs }"
          data-story-control
          class="group/binding flex h-6 min-w-0 items-center rounded border border-transparent bg-panel-field text-xs text-surface outline-none hover:bg-panel-field-hover focus-within:border-panel-focus data-[derived]:text-muted"
          :data-derived="derived ? '' : undefined"
          @pointerdown="onPointerDown($event, editing, actions)"
        >
          <NumberFieldInput class="min-w-0 flex-1 border-0 bg-transparent px-2 outline-none" />
          <NumberFieldValue class="flex min-w-0 flex-1 items-center overflow-hidden px-1">
            <template #default="display">
              <BindingPill
                v-if="binding.state === 'bound' && binding.variable"
                :label="binding.variable.name"
                :tooltip="tooltip(binding.variable.name, binding.resolvedValue)"
                :disabled="disabled"
                :derived="derived"
              />
              <span v-else-if="display.isMixed" class="min-w-0 flex-1 truncate px-1 text-muted">
                Mixed
              </span>
              <span v-else class="min-w-0 flex-1 truncate px-1">{{ display.value }}</span>
            </template>
          </NumberFieldValue>
          <VariableBindingPicker
            trigger-label="Apply variable"
            search-placeholder="Search variables"
            empty-label="No variables found"
            detach-label="Detach variable"
            create-label="Create number variable"
            create-name-placeholder="Variable name"
            create-submit-label="Create"
            :disabled="disabled"
            :derived="derived"
          />
        </div>
      </NumberFieldRoot>
    </BindableValueRoot>
  `
})

/** Every binding state side by side, backed by an in-memory provider. */
const BindingFieldStates = defineComponent({
  name: 'BindingFieldStates',
  components: { BindingFieldItem },
  setup() {
    const variables: Variable[] = [
      {
        id: 'space/sm',
        name: 'Space/sm',
        type: 'FLOAT',
        collectionId: 'demo',
        valuesByMode: { default: 8 },
        description: '',
        hiddenFromPublishing: false
      },
      {
        id: 'space/md',
        name: 'Space/md',
        type: 'FLOAT',
        collectionId: 'demo',
        valuesByMode: { default: 16 },
        description: '',
        hiddenFromPublishing: false
      },
      {
        id: 'space/lg',
        name: 'Space/lg',
        type: 'FLOAT',
        collectionId: 'demo',
        valuesByMode: { default: 24 },
        description: '',
        hiddenFromPublishing: false
      }
    ]

    const revision = ref(0)
    const bindings = ref<Record<string, string | undefined>>({
      'detach:width': 'space/md',
      'readonly:width': 'space/lg',
      'edit-variable:width': 'space/md',
      'mixed-a:width': 'space/sm',
      'mixed-b:width': 'space/lg',
      'disabled:width': 'space/md',
      'derived:width': 'space/sm'
    })
    const values = ref({
      unbound: 12,
      detach: 16,
      readonly: 24,
      editVariable: 16,
      mixed: 0,
      disabled: 16,
      derived: 8
    })

    function key(target: BindingTarget) {
      return `${target.nodeId}:${target.path}`
    }

    const provider: BindingProvider<number> = {
      revision,
      listVariables: () => variables,
      filterVariables: (term) =>
        variables.filter((variable) => variable.name.toLowerCase().includes(term.toLowerCase())),
      getBindingId: (target) => bindings.value[key(target)],
      getBound: (target) =>
        variables.find((variable) => variable.id === bindings.value[key(target)]),
      getState(targets): BindingState {
        const ids = new Set(targets.map((target) => bindings.value[key(target)]))
        if (ids.size > 1) return 'mixed'
        return ids.has(undefined) ? 'unbound' : 'bound'
      },
      resolve: (variableId) => {
        const value = variables.find((variable) => variable.id === variableId)?.valuesByMode.default
        return typeof value === 'number' ? value : undefined
      },
      bind(target, variableId) {
        bindings.value[key(target)] = variableId
        revision.value++
      },
      unbind(target) {
        bindings.value[key(target)] = undefined
        revision.value++
      },
      prepareEdit(variableId) {
        const variable = variables.find((item) => item.id === variableId)
        const value = variable?.valuesByMode.default
        if (!variable || typeof value !== 'number') return undefined
        return {
          key: variableId,
          value,
          set(next: number) {
            variable.valuesByMode.default = next
            revision.value++
          },
          restore() {
            variable.valuesByMode.default = value
            revision.value++
          }
        }
      },
      create(target, value, name) {
        const id = `created:${name}`
        variables.push({
          id,
          name,
          type: 'FLOAT',
          collectionId: 'demo',
          valuesByMode: { default: value },
          description: '',
          hiddenFromPublishing: false
        })
        bindings.value[key(target)] = id
        revision.value++
      }
    }

    return {
      provider,
      values,
      target: (nodeId: string): BindingTarget[] => [{ nodeId, path: 'width' }],
      mixedTargets: [
        { nodeId: 'mixed-a', path: 'width' },
        { nodeId: 'mixed-b', path: 'width' }
      ] satisfies BindingTarget[]
    }
  },
  template: `
    <div class="w-[320px] overflow-hidden rounded-lg border border-border bg-panel shadow-xl">
      <header class="border-b border-border px-3 py-2">
        <p class="text-xs font-semibold">Binding field states</p>
        <p class="mt-1 text-[11px] text-muted">Pill at rest, resolved value while editing</p>
      </header>

      <div class="grid grid-cols-2 gap-1.5 px-3">
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Unbound</span>
          <BindingFieldItem
            v-model="values.unbound"
            label="Unbound field"
            :provider="provider"
            :targets="target('unbound')"
          />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Detach on edit</span>
          <BindingFieldItem
            v-model="values.detach"
            label="Detach bound field"
            :provider="provider"
            :targets="target('detach')"
          />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Read only</span>
          <BindingFieldItem
            v-model="values.readonly"
            label="Readonly bound field"
            :provider="provider"
            :targets="target('readonly')"
            policy="readonly-when-bound"
          />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Edit variable</span>
          <BindingFieldItem
            v-model="values.editVariable"
            label="Edit variable field"
            :provider="provider"
            :targets="target('edit-variable')"
            policy="edit-variable"
          />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Mixed</span>
          <BindingFieldItem
            v-model="values.mixed"
            label="Mixed binding field"
            :provider="provider"
            :targets="mixedTargets"
          />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted">Disabled</span>
          <BindingFieldItem
            v-model="values.disabled"
            label="Disabled bound field"
            :provider="provider"
            :targets="target('disabled')"
            disabled
          />
        </label>
        <label class="col-span-2 space-y-1">
          <span class="text-[11px] text-muted">Derived by auto layout</span>
          <BindingFieldItem
            v-model="values.derived"
            label="Derived bound field"
            :provider="provider"
            :targets="target('derived')"
            derived
          />
        </label>
      </div>
    </div>
  `
})

const meta = {
  title: 'Editor/Properties/Binding Field',
  component: BindingFieldStates,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'App-private binding skins for quiet fields, variable identity pills, hover affordances, and the variable picker.'
      }
    }
  }
} satisfies Meta<typeof BindingFieldStates>

export default meta
type Story = StoryObj<typeof meta>

export const PickerActions: Story = {}

export const StateMatrix: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    const controls = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-story-control]'))

    for (const control of controls) await expect(control).toHaveStyle({ height: '26px' })

    const detachField = canvas.getByLabelText('Detach bound field')
    await expect(detachField).toHaveAttribute('data-bound')

    await userEvent.click(detachField)
    const detachInput = canvas.getByRole('spinbutton', { name: 'Detach bound field' })
    await expect(detachInput).toBeVisible()
    await expect(detachField).toHaveAttribute('data-bound')

    await userEvent.clear(detachInput)
    await userEvent.type(detachInput, '32')
    await expect(detachField).toHaveAttribute('data-unbound')
    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByLabelText('Detach bound field')).toHaveAttribute('data-bound')

    const unboundField = canvas.getByLabelText('Unbound field')
    const trigger = within(unboundField).getByRole('button', { name: 'Apply variable' })
    await userEvent.click(trigger)
    const search = page.getByPlaceholderText('Search variables')
    await expect(search).toBeVisible()
    await userEvent.type(search, 'lg')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByLabelText('Unbound field')).toHaveAttribute('data-bound')
  }
}
