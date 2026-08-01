import type { DailyPoint } from "./summary";

/**
 * A single-series daily bar chart, in plain HTML and CSS.
 *
 * **No charting dependency, and no SVG either.** What a chart library would buy
 * here — scales, axes, legends, tooltips — is respectively: one `bigint` ratio, two
 * 1px rules, nothing (a single series needs no legend; the heading names it), and
 * a `title` attribute.
 *
 * CSS rather than SVG for one concrete reason: a responsive `<svg viewBox>` has to
 * either letterbox or stretch, and stretching (`preserveAspectRatio="none"`)
 * scales the marks with the plot — a bar authored at the 24px cap renders wider
 * than the cap on a wide screen, and its 4px corner radius comes out elliptical.
 * A flex row of `<div>`s is sized in real pixels at every viewport, so
 * `max-width: 24px`, `gap: 2px`, and a 4px top radius mean exactly what they say.
 * It is also less code than building path strings.
 *
 * ## Encoding choices
 *
 * **One colour for every bar** (`--chart-1`), never a darker-where-bigger ramp.
 * Bar height already encodes magnitude; a lightness ramp would spend the only free
 * channel restating it, and a ramp over days — a nominal axis with no inherent
 * order to a colour scale — is a documented anti-pattern.
 *
 * **A single series per chart, never two y-scales.** Transaction counts and money
 * volume live on separate charts, and volume gets one chart *per currency*, because
 * 100 JPY and 100 USD are not comparable magnitudes; a shared axis would invent a
 * relationship the data does not contain.
 *
 * ## Colour validation
 *
 * `--chart-1` was checked with the data-viz validator against both theme surfaces:
 * contrast passes ≥ 3:1 in light *and* dark. The validator also reports this hue
 * below its chroma floor and, in dark mode, marginally outside its lightness band.
 * Both of those checks are scoped to *categorical* palettes — where hues must be
 * told apart from one another — and this chart has exactly one series. The token's
 * chroma is additionally a deliberate, documented sRGB gamut ceiling in
 * `packages/ui/src/styles/globals.css`; raising it to satisfy an inapplicable check
 * would make the colour render differently per browser engine.
 *
 * ## Accessibility
 *
 * Identity is never carried by colour alone — there is one series, named by the
 * heading. Every bar carries a `title`, which is the native hover tooltip, and the
 * whole series is available as a real table behind a `<details>`. No JavaScript is
 * involved in either.
 */

/** Mark spec: bars are capped rather than filling their slot, so the band keeps some air. */
const MAX_BAR_WIDTH_PX = 24;

export interface BarChartProps {
  /** Accessible name for the plot. The heading above it usually says the same thing. */
  readonly title: string;
  readonly points: readonly DailyPoint[];
  /** Bar height as a percentage of the tallest bar. Kept out of this component so money stays `bigint`. */
  readonly heightOf: (point: DailyPoint) => number;
  /** Human-readable value for the tooltip and the table — already formatted, never computed here. */
  readonly formatValue: (point: DailyPoint) => string;
  /** Column heading for the table alternative. */
  readonly valueLabel: string;
  /** Shown instead of the plot when nothing in the window has a value. */
  readonly emptyMessage: string;
}

export function DailyBarChart({
  title,
  points,
  heightOf,
  formatValue,
  valueLabel,
  emptyMessage,
}: BarChartProps) {
  const hasAnyValue = points.some((point) => heightOf(point) > 0);

  if (!hasAnyValue) {
    return (
      <p className="rounded-none border border-dashed p-6 text-center text-muted-foreground text-sm">
        {emptyMessage}
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      {/*
        `role="img"` with a name, so assistive tech announces one plot rather than
        thirty anonymous boxes. The per-bar detail lives in the table below, which
        is a better surface for it than thirty announcements.
      */}
      <div
        className="relative flex h-32 items-end gap-0.5"
        role="img"
        aria-label={title}
      >
        {/*
          Hairline, solid, one step off the surface — never dashed. A baseline and a
          midline only: more rules across a 30-slot plot would compete with the
          marks they exist to serve.

          `z-0` against the slots' `z-10` is load-bearing, not decoration. An
          absolutely-positioned element paints *above* in-flow content by default,
          so without the explicit order these rules drew on top of the bars — a
          gridline slicing through every mark, which is the opposite of recessive.
          `pointer-events-none` keeps them from intercepting a bar's tooltip.
        */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 border-border border-t" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 border-border border-t" />

        {points.map((point) => {
          const heightPercent = heightOf(point);
          return (
            <div
              key={point.date}
              className="relative z-10 flex h-full flex-1 items-end justify-center"
              style={{ maxWidth: `${MAX_BAR_WIDTH_PX}px` }}
            >
              {/*
                A zero day draws nothing at all — a one-pixel stub would suggest
                some small amount of activity where there was none. The slot still
                occupies its place on the axis, which is what keeps the timeline
                honest.
              */}
              {heightPercent > 0 ? (
                <div
                  className="w-full rounded-t bg-chart-1 transition-opacity hover:opacity-70"
                  style={{ height: `${heightPercent}%` }}
                  title={`${point.date}: ${formatValue(point)}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/*
        Only the endpoints are labelled. A date under every one of thirty bars
        would collide, and labels are meant to be selective — the per-bar values
        live in the tooltip and the table instead.
      */}
      <figcaption className="flex justify-between text-muted-foreground text-xs">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </figcaption>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Show as table
        </summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 font-medium">
                  Day
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td className="py-0.5">{point.date}</td>
                  <td className="py-0.5 text-right font-mono tabular-nums">
                    {formatValue(point)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
