export function ScoreBadge({ score }) {
  const color =
    score >= 75 ? 'bg-green-600 text-green-100' :
    score >= 50 ? 'bg-yellow-500 text-yellow-950' :
                  'bg-red-600 text-red-100'

  return (
    <span className={`inline-block w-10 text-center rounded px-1 py-0.5 text-xs font-bold tabular-nums ${color}`}>
      {score}
    </span>
  )
}
