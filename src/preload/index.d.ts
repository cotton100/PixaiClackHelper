import type { NaisApi } from './index'

declare global {
  interface Window {
    nais: NaisApi
  }
}
