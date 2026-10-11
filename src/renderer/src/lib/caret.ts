/**
 * textarea 내 커서(문자 인덱스)의 픽셀 좌표 측정 — 자동완성 팝업 위치용.
 * 동일 타이포의 숨김 미러에 마커 span을 넣어 offset을 읽는 표준 기법.
 */

const COPY_PROPS = [
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'tabSize'
] as const

export function caretCoords(
  textarea: HTMLTextAreaElement,
  position: number
): { left: number; top: number; height: number } {
  const div = document.createElement('div')
  const computed = getComputedStyle(textarea)
  for (const prop of COPY_PROPS) {
    div.style[prop] = computed[prop]
  }
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.left = '-9999px'
  div.style.top = '0'
  div.style.width = `${textarea.clientWidth}px`
  div.style.whiteSpace = 'pre-wrap'

  div.textContent = textarea.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(position, position + 1) || '​'
  div.appendChild(marker)

  document.body.appendChild(div)
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.6
  const coords = {
    left: marker.offsetLeft,
    top: marker.offsetTop,
    height: marker.offsetHeight || lineHeight
  }
  div.remove()
  return coords
}
