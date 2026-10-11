export function RatioMark({ ratio }: { ratio: string }): React.JSX.Element {
  const [width, height] = ratio.split(':').map(Number)
  const valid = width > 0 && height > 0 && Number.isFinite(width + height)
  const direction = width === height ? '정사각형' : width > height ? '가로형' : '세로형'
  const scale = 24 / Math.max(width, height)
  return (
    <span className="px-ratio-mark" title={`가로 ${width} : 세로 ${height}`}>
      {valid && (
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <rect
            x={(28 - width * scale) / 2}
            y={(28 - height * scale) / 2}
            width={width * scale}
            height={height * scale}
            rx="2"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      )}
      <span>
        {ratio} <small>{valid ? direction : '비율 확인 필요'}</small>
      </span>
    </span>
  )
}
