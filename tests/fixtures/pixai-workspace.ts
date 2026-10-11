import { makeLibrary, type Library } from '../../src/shared/pixai/library'
import { makeSceneCard } from '../../src/shared/pixai/batch-reserve'

export function pixaiLibrary(): Library {
  const library: Library = {
    ...makeLibrary(),
    common: { prompt: 'quality', negativePrompt: 'blur' },
    presets: [
      {
        id: 'p1',
        name: '기본 모델',
        model: { id: '10', versionId: '100', name: '테스트 모델' },
        loras: [
          { id: '20', versionId: '200', name: '테스트 LoRA', weight: 0.5, triggerWords: 'trigger' }
        ]
      }
    ],
    characters: ['Alice', 'Bob', 'Cara'].map((name, index) => ({
      id: `c${index + 1}`,
      name,
      prompt: name.toLowerCase(),
      negativePrompt: '',
      defaultPresetId: 'p1'
    })),
    scenes: ['웃음', '손 흔듦', '분노'].map((name, index) => ({
      id: `s${index + 1}`,
      name,
      prompt: ['smile', 'wave', 'angry'][index],
      negativePrompt: ''
    }))
  }
  library.sceneCards = library.scenes.map((chunk, index) =>
    makeSceneCard(library, { id: `sc${index + 1}`, name: chunk.name, sceneIds: [chunk.id] })
  )
  return library
}
