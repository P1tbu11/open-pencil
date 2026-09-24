import { reactive, shallowRef } from 'vue'

import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SliceProject } from './project'

const sessions = new WeakMap<SceneGraph, ReturnType<typeof createSession>>()

function createSession() {
  return {
    project: shallowRef<SliceProject>(),
    state: reactive({
      selectedId: '',
      frameId: '',
      drawing: false,
      mode: 'controlled',
      repairBackground: true,
      removeBackground: true,
      tolerance: 24,
      serviceUrl: 'http://127.0.0.1:1421',
      serviceToken: ''
    })
  }
}

export function sliceSession(graph: SceneGraph) {
  let session = sessions.get(graph)
  if (!session) {
    session = createSession()
    sessions.set(graph, session)
  }
  return session
}
