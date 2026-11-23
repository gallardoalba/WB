/**
 * Puntos de una sparkline SVG a partir de una serie con huecos.
 *
 * Se dibuja en el servidor: no hay JavaScript de cliente ni librería de
 * gráficos. Los `null` se saltan y la línea une los valores finitos; con menos
 * de dos puntos no hay línea que dibujar.
 */
export function sparklinePoints(
  values: readonly (number | null)[],
  width = 100,
  height = 40,
): string {
  const finite: Array<{ index: number; value: number }> = [];
  values.forEach((value, index) => {
    if (value !== null && Number.isFinite(value)) finite.push({ index, value });
  });
  if (finite.length < 2) return "";

  const minX = finite[0]!.index;
  const maxX = finite[finite.length - 1]!.index;
  const spanX = maxX - minX || 1;
  const ys = finite.map((point) => point.value);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY;
  const flat = spanY === 0;

  return finite
    .map((point) => {
      const x = ((point.index - minX) / spanX) * width;
      const y = flat ? height / 2 : height - ((point.value - minY) / spanY) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
