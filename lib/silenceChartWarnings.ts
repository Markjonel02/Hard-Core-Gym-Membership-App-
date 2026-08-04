/**
 * Silences the React DOM unknown-prop warnings that `react-native-gifted-charts` triggers on web.
 *
 * Root cause, traced through a live render rather than inferred:
 *
 * `LineChart` puts both `onPress` and `onPressOut` on the SVG `<Circle>` it draws for every data
 * point (react-native-gifted-charts/dist/LineChart/index.js:345-373). `react-native-svg`'s web
 * shim then does two things with those props, in `prepare()`
 * (react-native-svg/lib/module/web/utils/prepare.js):
 *
 *   1. `hasTouchableProperty(props)` is true because `onPress` is set, so it *adds* six gesture
 *      responder props — onStartShouldSetResponder, onResponderTerminationRequest,
 *      onResponderGrant, onResponderMove, onResponderRelease, onResponderTerminate.
 *   2. It destructures `onPress` out and re-emits it as `onClick`, but it never destructures
 *      `onPressIn`, `onPressOut`, or `onLongPress` — so those ride along in `...rest`.
 *
 * Everything in both groups lands on a real DOM `<circle>`, and React DOM logs
 * "Unknown event handler property `X`. It will be ignored." through console.error for each one.
 * Expo's LogBox escalates console.error into a full-screen overlay, so a single line chart
 * buries the console every time it renders.
 *
 * Nothing is broken. The handlers are inert here — we pass no `pointerConfig` and no press
 * handlers, and `focusEnabled` defaults to false, so the `onPressOut` body is a no-op guard —
 * and React itself says it ignores the props. It is also dev-only: production React DOM does
 * not run the unknown-prop check at all.
 *
 * There is no prop-level escape. The props are attached unconditionally inside the library, and
 * the one prop that would stop them rendering, `hideDataPoints`, would also remove the visible
 * dots from the chart. Fixing `prepare()` upstream is the real fix; this is the local one.
 *
 * The filter is deliberately narrow: it requires React's exact wording *and* one of the specific
 * prop names below. A broad "drop unknown-prop warnings" filter would also hide the same class
 * of warning coming from our own components, which is worth seeing.
 */

/**
 * The props that reach the DOM from a chart, in the two groups described above. Anything
 * outside this list still warns — including `onPress`, which the shim does strip.
 */
const LEAKED_CHART_PROPS = [
  // Added by react-native-svg's prepare() whenever a touchable prop is present.
  'onStartShouldSetResponder',
  'onStartShouldSetResponderCapture',
  'onMoveShouldSetResponder',
  'onMoveShouldSetResponderCapture',
  'onResponderGrant',
  'onResponderMove',
  'onResponderRelease',
  'onResponderTerminate',
  'onResponderTerminationRequest',
  'onResponderReject',
  'onResponderEnd',
  'onResponderStart',
  // Passed by the charts and *not* stripped by prepare(), unlike its sibling `onPress`.
  'onPressIn',
  'onPressOut',
  'onLongPress',
];

/**
 * React formats this as ("Unknown event handler property `%s`. …", propName) — the prop name
 * arrives as a separate argument, so the whole call has to be joined before matching.
 */
function isLeakedChartPropWarning(args: unknown[]): boolean {
  const text = args.map((arg) => (typeof arg === 'string' ? arg : '')).join(' ');
  if (!text.includes('Unknown event handler property')) return false;
  return LEAKED_CHART_PROPS.some((prop) => text.includes(prop));
}

let installed = false;

export function silenceChartResponderWarnings(): void {
  // Only in development: the warning does not exist in a production React DOM build, so
  // patching console there would be dead weight that only makes real errors easier to lose.
  if (!__DEV__ || installed) return;
  installed = true;

  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (isLeakedChartPropWarning(args)) return;
    original(...args);
  };
}
